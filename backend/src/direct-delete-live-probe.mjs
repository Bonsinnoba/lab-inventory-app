// Opt-in probe for the existing PostgreSQL service. Only test-owned IDs are removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_DIRECT_DELETE_PROBE !== '1') throw new Error('Set LABOS_DIRECT_DELETE_PROBE=1');

const marker = `LABOS-DIRECT-DELETE-${randomUUID()}`;
const records = [
  { type: 'transaction', table: 'transactions', path: '/transactions', id: randomUUID() },
  { type: 'budget_period', table: 'budget_periods', path: '/budget-periods', id: randomUUID() },
  { type: 'funding_source', table: 'funding_sources', path: '/funding-sources', id: randomUUID() },
  { type: 'location', table: 'locations', path: '/locations', id: randomUUID() },
];

try {
  const admin = await pool.query("SELECT id FROM users WHERE username='balika' AND role='admin' AND is_active=true");
  assert.equal(admin.rowCount, 1, 'active balika administrator is required');
  const token = jwt.sign({ userId: admin.rows[0].id }, config.jwtSecret, { expiresIn: '5m' });
  await pool.query('INSERT INTO transactions(id,type,direction,amount,vendor) VALUES($1,$2,$3,$4,$5)', [records[0].id, 'other', 'expense', 1, marker]);
  await pool.query('INSERT INTO budget_periods(id,label,total_budget) VALUES($1,$2,$3)', [records[1].id, marker, 1]);
  await pool.query('INSERT INTO funding_sources(id,name,source_type) VALUES($1,$2,$3)', [records[2].id, marker, 'other']);
  await pool.query('INSERT INTO locations(id,name) VALUES($1,$2)', [records[3].id, marker]);

  const collision = await fetch('http://127.0.0.1:4000/api/sync/push', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: randomUUID(), changes: [{
      change_id: randomUUID(), entity_type: 'transaction', entity_id: records[0].id, operation: 'create',
      payload: { record: { id: records[0].id, type: 'other', direction: 'expense', amount: 2 } },
    }] }),
  });
  assert.equal(collision.status, 200);
  assert.equal((await collision.json()).results[0].error.code, 'FINANCE_ALREADY_EXISTS');

  for (const record of records) {
    const response = await fetch(`http://127.0.0.1:4000/api${record.path}/${record.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 204, `${record.type}: ${await response.text()}`);
    assert.equal((await pool.query(`SELECT id FROM ${record.table} WHERE id=$1`, [record.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT entity_id FROM sync_tombstones WHERE entity_type=$1 AND entity_id=$2', [record.type, record.id])).rowCount, 1);
  }
  const financePull = await fetch('http://127.0.0.1:4000/api/sync/finance/pull', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(financePull.status, 200);
  const financeBody = await financePull.json();
  for (const record of records.slice(0, 3)) assert.ok(financeBody.deleted[record.type].includes(record.id), `${record.type} tombstone absent from pull`);
  const locationPull = await fetch('http://127.0.0.1:4000/api/sync/locations/pull', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(locationPull.status, 200);
  const locationBody = await locationPull.json();
  assert.ok(locationBody.deleted_location_ids.includes(records[3].id), 'location tombstone absent from pull');
  console.log('Direct deletes: transaction, budget period, funding source and location tombstones passed');
} finally {
  for (const record of records) {
    await pool.query('DELETE FROM audit_log WHERE entity_type=$1 AND entity_id=$2', [record.type, record.id]);
    await pool.query('DELETE FROM sync_tombstones WHERE entity_type=$1 AND entity_id=$2', [record.type, record.id]);
    await pool.query(`DELETE FROM ${record.table} WHERE id=$1`, [record.id]);
  }
  await pool.end();
}
