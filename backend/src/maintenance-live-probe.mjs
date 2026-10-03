// Run inside the existing API container, against its configured PostgreSQL DB.
// The only lasting effects are the normal CREATE/UPDATE/DELETE audit entries.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';
import { getUserPermissions } from './middleware/permissions.js';

if (process.env.LABOS_LIVE_MAINTENANCE_PROBE !== '1') {
  throw new Error('Set LABOS_LIVE_MAINTENANCE_PROBE=1 to run against the configured database');
}

const marker = `LABOS-MAINT-HTTP-PROBE-${randomUUID()}`;
let itemId;
let recordId;

async function request(userId, method, path, body) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:4000/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const item = await pool.query("SELECT id FROM items WHERE sku='LABOS-DEMO-20261003-017'");
  const admin = await pool.query("SELECT id FROM users WHERE username='balika' AND is_active=true");
  assert.equal(item.rowCount, 1, 'seed item 17 must exist');
  assert.equal(admin.rowCount, 1, 'active balika test account must exist');
  itemId = item.rows[0].id;
  const userId = admin.rows[0].id;
  const path = `/items/${itemId}/maintenance`;

  assert.equal((await request(userId, 'GET', path)).status, 200);
  assert.equal((await request(userId, 'POST', path, { maintenance_type: 'invalid', notes: marker })).status, 400);

  const created = await request(userId, 'POST', path, {
    maintenance_type: 'inspection', status: 'scheduled',
    scheduled_date: '2026-10-20', notes: marker, cost: 4.5,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  recordId = created.body.id;
  assert.equal(created.body.item_id, itemId);
  assert.equal(created.body.notes, marker);

  const updated = await request(userId, 'PATCH', `${path}/${recordId}`, {
    status: 'completed', completed_date: '2026-10-21', cost: 5,
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.status, 'completed');
  assert.equal(updated.body.performed_by, userId);
  assert.ok((await request(userId, 'GET', path)).body.some(record => record.id === recordId));

  const member = await pool.query("SELECT id,role FROM users WHERE username='testuser' AND is_active=true");
  if (member.rowCount) {
    const permissions = await getUserPermissions(member.rows[0].id, member.rows[0].role);
    if (!permissions.has('inventory.edit')) {
      assert.equal((await request(member.rows[0].id, 'POST', path, {
        maintenance_type: 'inspection', notes: marker,
      })).status, 403);
    }
  }

  const deleted = await request(userId, 'DELETE', `${path}/${recordId}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await request(userId, 'DELETE', `${path}/${recordId}`)).status, 404);
  assert.ok(!(await request(userId, 'GET', path)).body.some(record => record.id === recordId));
  console.log('maintenance live probe: create, validate, update, read, permission, delete, repeat-delete passed');
} finally {
  if (itemId) {
    await pool.query('DELETE FROM maintenance_records WHERE item_id=$1 AND notes=$2', [itemId, marker]);
  }
  await pool.end();
}
