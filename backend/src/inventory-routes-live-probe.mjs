// Opt-in API probe against the existing PostgreSQL service; only unique test IDs are removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_INVENTORY_ROUTE_PROBE !== '1') throw new Error('Set LABOS_INVENTORY_ROUTE_PROBE=1');

const marker = `LABOS-INVENTORY-ROUTE-${randomUUID()}`;
const ids = [randomUUID(), randomUUID(), randomUUID()];
const resourceId = randomUUID();

try {
  const admin = await pool.query("SELECT id FROM users WHERE username='balika' AND role='admin' AND is_active=true");
  assert.equal(admin.rowCount, 1, 'active balika administrator is required');
  const token = jwt.sign({ userId: admin.rows[0].id }, config.jwtSecret, { expiresIn: '5m' });
  const request = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:4000/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  for (const [index, id] of ids.entries()) {
    await pool.query("INSERT INTO items(id,name,type,status) VALUES($1,$2,'tool','available')", [id, `${marker}-${index}`]);
  }
  await pool.query("INSERT INTO resources(id,name,kind,file_type,item_id) VALUES($1,$2,'folder','schematic_folder',$3)", [resourceId, marker, ids[0]]);
  const collision = await request('POST', '/sync/push', { device_id: randomUUID(), changes: [{
    change_id: randomUUID(), entity_type: 'resource', entity_id: resourceId, operation: 'create',
    payload: { record: { id: resourceId, name: `${marker}-different`, kind: 'folder', item_id: ids[0] } },
  }] });
  assert.equal(collision.status, 200);
  assert.equal(collision.body.results[0].error.code, 'RESOURCE_ALREADY_EXISTS');
  await pool.query('DELETE FROM resources WHERE id=$1', [resourceId]);
  assert.deepEqual(await request('POST', '/items/bulk-status', { ids: ids.slice(1), status: 'in_use' }), { status: 200, body: { updated: 2 } });
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM items WHERE id=ANY($1::uuid[]) AND status=$2', [ids.slice(1), 'in_use'])).rows[0].count, 2);
  assert.equal((await request('DELETE', `/items/${ids[0]}`)).status, 204);
  assert.deepEqual(await request('POST', '/items/bulk-delete', { ids: ids.slice(1) }), { status: 200, body: { deleted: 2 } });
  assert.equal((await pool.query('SELECT id FROM items WHERE id=ANY($1::uuid[])', [ids])).rowCount, 0);
  assert.equal((await pool.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])", [ids])).rowCount, 3);
  console.log('Inventory routes: bulk status, single delete, bulk delete and tombstones passed');
} finally {
  await pool.query("DELETE FROM audit_log WHERE entity_type='item' AND (entity_id=ANY($1::uuid[]) OR (action IN ('BULK_UPDATE','BULK_DELETE') AND metadata->'ids' ?| $2::text[]))", [ids, ids]);
  await pool.query("DELETE FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])", [ids]);
  await pool.query('DELETE FROM resources WHERE id=$1', [resourceId]);
  await pool.query('DELETE FROM items WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
}
