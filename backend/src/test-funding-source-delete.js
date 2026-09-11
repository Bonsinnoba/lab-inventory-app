import { pool } from './db.js';

async function testFundingSourceDelete() {
  try {
    const fundingSourceId = '544d7222-7b28-489e-9d97-0ca93e0c2af0';

    // Check transactions linked to the funding source before delete
    const beforeDelete = await pool.query(
      'SELECT id, funding_source_id FROM transactions WHERE funding_source_id = $1',
      [fundingSourceId]
    );
    console.log('Transactions before delete:', beforeDelete.rows.length, beforeDelete.rows);

    // Delete the funding source
    const deleteResult = await pool.query(
      'DELETE FROM funding_sources WHERE id = $1 RETURNING id',
      [fundingSourceId]
    );
    console.log('Deleted funding source:', deleteResult.rows[0]);

    // Check transactions after delete - should still exist but with funding_source_id = null
    const afterDelete = await pool.query(
      'SELECT id, funding_source_id FROM transactions WHERE id = ANY($1)',
      [beforeDelete.rows.map(r => r.id)]
    );
    console.log('Transactions after delete:', afterDelete.rows.length, afterDelete.rows);

    // Verify funding_source_id is now null
    const allNull = afterDelete.rows.every(r => r.funding_source_id === null);
    console.log('All funding_source_id set to null:', allNull);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testFundingSourceDelete();
