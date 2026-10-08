// Explicitly opted-in, namespaced fixtures for the native two-client test.
// Never targets a seed account or an existing application preference.
import { pool } from './db.js';
import { config } from './config.js';
import jwt from 'jsonwebtoken';
if (process.env.LABOS_PHASE2_PREFERENCES_PROBE !== '1') throw new Error('Test opt-in required');
const [action, id] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || '')) throw new Error('Fixture UUID required');
const username = 'LABOS-P2-PREF-CLIENT-' + id;
const c = await pool.connect();
try {
  await c.query('BEGIN');
  if (action === 'create') {
    await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','viewer')", [id, username]);
  } else {
    const row = await c.query('SELECT id FROM users WHERE id=$1 AND username=$2 FOR UPDATE', [id, username]);
    if (row.rowCount !== 1) throw new Error('Not this test fixture; refusing mutation');
    if (action === 'disable') await c.query('UPDATE users SET is_active=false WHERE id=$1', [id]);
    else if (action === 'cleanup') {
      await c.query("DELETE FROM sync_idempotency WHERE user_id=$1 AND entity_type='daily_preferences'", [id]);
      await c.query('DELETE FROM notifications WHERE user_id=$1', [id]);
      await c.query('DELETE FROM audit_log WHERE actor_user_id=$1', [id]);
      await c.query('DELETE FROM user_daily_use_preferences WHERE user_id=$1', [id]);
      await c.query('DELETE FROM users WHERE id=$1 AND username=$2', [id, username]);
    } else throw new Error('Unknown fixture action');
  }
  await c.query('COMMIT');
  // Captured by the native test runner, never logged by the app.
  console.log(JSON.stringify(action === 'create' ? { token: jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '15m' }) } : { ok: true }));
} catch (error) {
  await c.query('ROLLBACK'); throw error;
} finally { c.release(); await pool.end(); }
