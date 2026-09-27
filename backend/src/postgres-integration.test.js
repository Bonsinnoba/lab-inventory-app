import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './db.js';

if (process.env.LABOS_INTEGRATION_TEST_DB !== '1') {
  throw new Error('PostgreSQL integration tests require an isolated database and LABOS_INTEGRATION_TEST_DB=1');
}

test('migrated PostgreSQL schema supports finance and sync queries', async () => {
  try {
    const tables = {
      users: ['id','role','is_active'],
      projects: ['id','name','budget','owner_id','updated_at'],
      transactions: ['id','direction','amount','budget_period_id','funding_source_id','created_at'],
      sync_idempotency: ['change_id','payload_json','response_json'],
      sync_tombstones: ['entity_type','entity_id','deleted_at']
    };
    for (const [table, columns] of Object.entries(tables)) {
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [table]
      );
      const found = new Set(result.rows.map(row => row.column_name));
      for (const column of columns) assert.ok(found.has(column), table+'.'+column);
    }
    await pool.query("SELECT t.id,t.type,t.direction,t.amount,t.date,t.vendor,t.notes,t.item_id,t.project_id,t.logged_by,t.created_at,i.name AS item_name,p.name AS project_name FROM transactions t LEFT JOIN items i ON t.item_id=i.id LEFT JOIN projects p ON t.project_id=p.id WHERE t.direction='expense' LIMIT 1");
  } finally {
    await pool.end();
  }
});
