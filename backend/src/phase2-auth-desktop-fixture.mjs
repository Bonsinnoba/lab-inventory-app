// Disposable account for owner-assisted native UI revocation acceptance.
// Existing user accounts are never selected or changed by this helper.
import { pool } from './db.js';
import bcrypt from 'bcrypt';
if (process.env.LABOS_AUTH_DESKTOP_PROBE !== '1') throw Error('Explicit desktop-auth fixture opt-in required');
const [action, id] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || '')) throw Error('Fixture UUID required');
const username = 'p2-auth-' + id.slice(0, 8);
const password = 'LabOS-Probe-' + id;
const client = await pool.connect();
try {
  await client.query('BEGIN');
  let result;
  if (action === 'create') {
    await client.query("INSERT INTO users(id,username,password_hash,role,display_name) VALUES($1,$2,$3,'member',$4)",
      [id, username, await bcrypt.hash(password, 12), 'Disposable Phase 2 auth test']);
    result = { id, username, password };
  } else {
    const target = await client.query('SELECT id,is_active,credential_version FROM users WHERE id=$1 AND username=$2 FOR UPDATE', [id, username]);
    if (!target.rowCount) throw Error('Not this fixture; refusing mutation');
    if (action === 'disable') {
      result = (await client.query('UPDATE users SET is_active=FALSE WHERE id=$1 RETURNING id,is_active,credential_version', [id])).rows[0];
    } else if (action === 'status') {
      result = target.rows[0];
    } else if (action === 'cleanup') {
      await client.query('DELETE FROM audit_log WHERE actor_user_id=$1', [id]);
      await client.query('DELETE FROM users WHERE id=$1 AND username=$2', [id, username]);
      result = { removed_fixture: id };
    } else throw Error('Unknown fixture action');
  }
  await client.query('COMMIT');
  console.log(JSON.stringify(result));
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
