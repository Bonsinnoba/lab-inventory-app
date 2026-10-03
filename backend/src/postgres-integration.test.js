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
      projects: ['id','name','budget','owner_id','updated_at','visibility'],
      notes: ['id','title','project_id','author_id','visibility'],
      resources: ['id','name','project_id','visibility'],
      record_access_grants: ['entity_type','entity_id','user_id','access_level','created_by'],
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
    // Verify rollback using a real application table without persisting test data.
    const client = await pool.connect();
    let projectId;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        "INSERT INTO projects(name,status,budget) VALUES ($1,'planning',$2) RETURNING id",
        ['Phase 2 rollback probe', 12.50]
      );
      projectId = inserted.rows[0].id;
      assert.equal((await client.query('SELECT 1 FROM projects WHERE id=$1',[projectId])).rowCount,1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    assert.equal((await pool.query('SELECT 1 FROM projects WHERE id=$1',[projectId])).rowCount,0,
      'Rolled-back project must not persist');
    // Database constraints must reject invalid finance and stock references.
    const constrained = await pool.connect();
    try {
      await constrained.query('BEGIN');
      await constrained.query('SAVEPOINT invalid_direction');
      await assert.rejects(
        constrained.query("INSERT INTO transactions(type,direction,amount) VALUES ('purchase','invalid',10)"),
        error => error.code === '23514'
      );
      await constrained.query('ROLLBACK TO SAVEPOINT invalid_direction');
      await constrained.query('SAVEPOINT invalid_project');
      await assert.rejects(
        constrained.query("INSERT INTO transactions(type,direction,amount,project_id) VALUES ('purchase','expense',10,'00000000-0000-0000-0000-000000000001')"),
        error => error.code === '23503'
      );
      await constrained.query('ROLLBACK TO SAVEPOINT invalid_project');
      await constrained.query('ROLLBACK');
    } finally {
      constrained.release();
    }
    // Check two independent database sessions respect transaction-scoped locks.
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await first.query('SELECT pg_advisory_xact_lock(190926, 2)');
      const blocked = await second.query('SELECT pg_try_advisory_xact_lock(190926, 2) AS acquired');
      assert.equal(blocked.rows[0].acquired,false,'Concurrent session must not acquire held lock');
      await first.query('COMMIT');
      const released = await second.query('SELECT pg_try_advisory_xact_lock(190926, 2) AS acquired');
      assert.equal(released.rows[0].acquired,true,'Lock must be released after commit');
      await second.query('SELECT pg_advisory_unlock(190926, 2)');
    } finally {
      await first.query('ROLLBACK').catch(()=>{});
      first.release();
      second.release();
    }
  } finally {
    await pool.end();
  }
});
