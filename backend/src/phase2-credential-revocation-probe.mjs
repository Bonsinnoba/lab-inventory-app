// Real PostgreSQL; no mock database and no modifications to existing accounts.
// Run in the configured API environment with LABOS_CREDENTIAL_PROBE=1.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import resourcesRouter from './routes/resources.js';
import { authenticateToken } from './middleware/auth.js';
import { hasPermission } from './middleware/permissions.js';

if (process.env.LABOS_CREDENTIAL_PROBE !== '1') throw Error('Explicit credential probe opt-in required');
const ids = [randomUUID(), randomUUID()];
const resource = randomUUID();
const marker = `p2-rev-${randomUUID()}`;
const names = [marker + '-admin', marker + '-member'];
// Generated credentials belong only to these disposable fixtures; never logged.
const passwords = [randomUUID(), randomUUID(), randomUUID()];
let server;
let base;
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
async function http(method, path, body, token) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, body: await res.json() };
}
async function login(index, password) {
  const result = await http('POST', '/auth/login', { username: names[index], password });
  assert.equal(result.status, 200, 'Fixture login failed');
  return result.body.token;
}
const version = async () => (await pool.query('SELECT credential_version FROM users WHERE id=$1', [ids[1]])).rows[0].credential_version;
async function denied(token, code = 'SESSION_REVOKED') {
  const result = await http('GET', '/auth/me', undefined, token);
  check(result.status === 401 && result.body.error.code === code, 'Old credentials must be denied');
}
async function accessToken(token) {
  const result = await http('GET', `/resources/${resource}/access-url`, undefined, token);
  assert.equal(result.status, 200, 'Access URL should be available to fixture member');
  return new URL(result.body.url).searchParams.get('access_token');
}

try {
  // Apply the additive migration and its tracking row atomically; repeatability
  // is tested below without resetting any account version.
  const migration = await readFile(new URL('./migrations/20261009_credential_versions.sql', import.meta.url), 'utf8');
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query('BEGIN');
    await migrationClient.query(migration);
    await migrationClient.query("INSERT INTO schema_migrations(version) VALUES('20261009_credential_versions') ON CONFLICT DO NOTHING");
    await migrationClient.query('COMMIT');
  } catch (err) { await migrationClient.query('ROLLBACK'); throw err; }
  finally { migrationClient.release(); }

  for (const [index, id] of ids.entries()) {
    await pool.query('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$4)',
      [id, names[index], await bcrypt.hash(passwords[0], 12), index === 0 ? 'admin' : 'member']);
  }
  await pool.query("INSERT INTO resources(id,name,kind,file_type,uploaded_by) VALUES($1,$2,'file','other',$3)", [resource, marker, ids[1]]);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/resources', authenticateToken, hasPermission('resources.view'), resourcesRouter);
  // Same real middleware, no file bytes needed to validate a query JWT baseline.
  app.get('/api/probe/download', authenticateToken, (req, res) => res.json({ accepted: true }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}/api`;

  const admin = await login(0, passwords[0]);
  const initial = await login(1, passwords[0]);
  check(jwt.verify(initial, config.jwtSecret).credentialVersion === 0, 'Login must sign the stored credential version');
  const legacy = jwt.sign({ userId: ids[1] }, config.jwtSecret, { expiresIn: '5m' });
  check((await http('GET', '/auth/me', undefined, legacy)).status === 200, 'Existing version-zero tokens retain access before revocation');
  const media = await accessToken(initial);
  check(jwt.verify(media, config.jwtSecret).credentialVersion === 0, 'Media token carries credential version');
  check((await http('GET', `/probe/download?access_token=${encodeURIComponent(media)}`)).status === 200, 'Query media token works before reset');

  check((await http('POST', `/auth/users/${ids[0]}/password`, { new_password: passwords[1] }, initial)).status === 403, 'Ordinary member cannot reset an administrator');
  check((await http('PATCH', '/auth/me/password', { current_password: 'wrong-fixture-password', new_password: passwords[1] }, initial)).status === 400, 'Incorrect current password cannot change credentials');
  check(await version() === 0, 'Rejected mutations leave version unchanged');

  const reset = await http('POST', `/auth/users/${ids[1]}/password`, { new_password: passwords[1] }, admin);
  check(reset.status === 200 && reset.body.reauthentication_required === true, 'Admin reset requests reauthentication');
  check(await version() === 1, 'Password reset advances version exactly once');
  await denied(initial); await denied(legacy);
  const revokedMedia = await http('GET', `/resources/${resource}/download?access_token=${encodeURIComponent(media)}`);
  check(revokedMedia.status === 401 && revokedMedia.body.error.code === 'SESSION_REVOKED', 'Actual resource download rejects old query token before file access');
  check((await http('POST', '/auth/login', { username: names[1], password: passwords[0] })).status === 401, 'Old password no longer signs in');
  const afterReset = await login(1, passwords[1]);
  check(jwt.verify(afterReset, config.jwtSecret).credentialVersion === 1, 'New password receives version one');
  check(jwt.verify(await accessToken(afterReset), config.jwtSecret).credentialVersion === 1, 'New media token receives version one');

  const changed = await http('PATCH', '/auth/me/password', { current_password: passwords[1], new_password: passwords[2] }, afterReset);
  check(changed.status === 200 && changed.body.reauthentication_required === true, 'Self change requests reauthentication');
  check(await version() === 2, 'Self change advances version');
  await denied(afterReset);
  const afterChange = await login(1, passwords[2]);
  check((await http('GET', '/auth/me', undefined, afterChange)).status === 200, 'Fresh token works after self change');

  check((await http('PATCH', `/auth/users/${ids[1]}`, { is_active: false }, admin)).status === 200, 'Disable fixture');
  check(await version() === 3, 'Disable advances credential version');
  await denied(afterChange, 'ACCOUNT_DISABLED');
  check((await http('PATCH', `/auth/users/${ids[1]}`, { is_active: true }, admin)).status === 200, 'Re-enable fixture');
  check(await version() === 3, 'Re-enable does not roll back credential version');
  await denied(afterChange);
  const reenabled = await login(1, passwords[2]);
  check((await http('GET', '/auth/me', undefined, reenabled)).status === 200, 'Fresh sign-in works after re-enable');
  await http('PATCH', '/auth/me/profile', { display_name: marker }, reenabled);
  check(await version() === 3, 'Profile edits and last-login updates do not revoke sessions');
  check((await pool.query("SELECT 1 FROM audit_log WHERE entity_type='user_password' AND entity_id=$1", [ids[1]])).rowCount === 2, 'Both successful password changes have required audit rows');

  const transaction = await pool.connect();
  try {
    await transaction.query('BEGIN');
    await transaction.query('UPDATE users SET password_hash=$1 WHERE id=$2', ['rollback-fixture-only', ids[1]]);
    check((await transaction.query('SELECT credential_version FROM users WHERE id=$1', [ids[1]])).rows[0].credential_version === 4, 'Direct SQL password writes cannot bypass revocation');
    await transaction.query('ROLLBACK');
  } finally { transaction.release(); }
  check(await version() === 3, 'Password/version changes roll back together');
  await pool.query('UPDATE users SET credential_version=0 WHERE id=$1', [ids[1]]);
  check(await version() === 3, 'Accidental version downgrade cannot restore revoked tokens');
  await pool.query(migration);
  check(await version() === 3, 'Repeated migration preserves existing revocation state');
  check((await http('GET', '/auth/me', undefined, admin)).status === 200, 'Other accounts are unaffected by target revocation');
  console.log(`PASS ${checks} real-PostgreSQL credential assertions: reset/change, legacy/media tokens, disable/re-enable, denied writes, audit, rollback, migration replay, account isolation.`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  try {
    await pool.query('DELETE FROM resources WHERE id=$1 AND name=$2', [resource, marker]);
    await pool.query('DELETE FROM sync_tombstones WHERE entity_id=$1', [resource]);
    await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[]) OR entity_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND username=ANY($2::text[])', [ids, names]);
    console.log('Cleaned exact probe-owned resources, audit rows and users; existing accounts/data retained.');
  } finally { await pool.end(); }
}
