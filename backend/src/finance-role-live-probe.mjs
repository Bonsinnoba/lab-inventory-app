// Opt-in PostgreSQL permission/replay probe. It cleans only its own UUIDs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_FINANCE_ROLE_PROBE !== '1') throw new Error('Set LABOS_FINANCE_ROLE_PROBE=1');

const marker = `LABOS-FINANCE-ROLE-${randomUUID()}`;
const ids = { user: randomUUID(), income: randomUUID(), expense: randomUUID(), item: randomUUID(), movement: randomUUID() };
const changes = { income: randomUUID(), expense: randomUUID(), movement: randomUUID() };
const deviceId = randomUUID();

async function push(userId, entityType, entityId, changeId, payload) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch('http://127.0.0.1:4000/api/sync/push', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, changes: [{ change_id: changeId, entity_type: entityType, entity_id: entityId, operation: 'create', payload }] }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).results[0];
}

try {
  const admin = await pool.query("SELECT id FROM users WHERE username='balika' AND role='admin' AND is_active=true");
  assert.equal(admin.rowCount, 1, 'active balika administrator is required');
  await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'probe-not-a-login','viewer')", [ids.user, marker]);
  for (const permission of ['finance.view', 'finance.view_sensitive', 'finance.create_income']) {
    await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,$2,'grant')", [ids.user, permission]);
  }
  const income = { id: ids.income, type: 'lab_allocation', direction: 'income', amount: 1, vendor: marker };
  const incomeResult = await push(ids.user, 'transaction', ids.income, changes.income, { record: income });
  assert.equal(incomeResult.status, 'synced', JSON.stringify(incomeResult));
  assert.equal((await push(ids.user, 'transaction', ids.income, changes.income, { record: income })).status, 'synced', 'same change_id replay must succeed');
  const storedIncome = await pool.query('SELECT amount,logged_by FROM transactions WHERE id=$1', [ids.income]);
  assert.equal(storedIncome.rowCount, 1);
  assert.equal(storedIncome.rows[0].logged_by, ids.user, 'server author must be authenticated outbox owner');
  const expense = { id: ids.expense, type: 'other', direction: 'expense', amount: 1, vendor: marker };
  assert.equal((await push(ids.user, 'transaction', ids.expense, changes.expense, { record: expense })).error.code, 'PERMISSION_DENIED');
  assert.equal((await pool.query('SELECT id FROM transactions WHERE id=$1', [ids.expense])).rowCount, 0);

  await pool.query("INSERT INTO items(id,name,type) VALUES($1,$2,'tool')", [ids.item, marker]);
  await pool.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after) VALUES($1,$2,'receive',1,0,1)", [ids.movement, ids.item]);
  const movement = { id: ids.movement, item_id: ids.item, movement_type: 'receive', quantity: 1 };
  assert.equal((await push(admin.rows[0].id, 'item_movement', ids.item, changes.movement, movement)).error.code, 'MOVEMENT_ALREADY_EXISTS');
  console.log('Finance role and replay: income-only grant, same-change retry, expense denial, movement collision passed');
} finally {
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])', [[changes.income, changes.expense, changes.movement]]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1 OR (entity_type=$2 AND entity_id=$3)', [ids.user, 'item_movement', ids.movement]);
  await pool.query('DELETE FROM item_movements WHERE id=$1', [ids.movement]);
  await pool.query('DELETE FROM items WHERE id=$1 AND name=$2', [ids.item, marker]);
  await pool.query('DELETE FROM transactions WHERE id=ANY($1::uuid[])', [[ids.income, ids.expense]]);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1', [ids.user]);
  await pool.query('DELETE FROM users WHERE id=$1 AND username=$2', [ids.user, marker]);
  await pool.end();
}
