import { pool } from './db.js';

async function verifyTotalContributed() {
  try {
    const fundingSourceId = '544d7222-7b28-489e-9d97-0ca93e0c2af0';
    
    // Get API response value
    const apiResult = await pool.query(
      `SELECT fs.*,
              COALESCE(SUM(t.amount)::float, 0) AS total_contributed
       FROM funding_sources fs
       LEFT JOIN transactions t ON fs.id = t.funding_source_id AND t.direction = 'income'
       WHERE fs.id = $1
       GROUP BY fs.id`,
      [fundingSourceId]
    );
    
    // Get direct SQL sum
    const directSum = await pool.query(
      `SELECT SUM(amount)::float as total FROM transactions WHERE funding_source_id = $1 AND direction = 'income'`,
      [fundingSourceId]
    );
    
    console.log('API total_contributed:', apiResult.rows[0].total_contributed);
    console.log('Direct SQL SUM:', directSum.rows[0].total);
    console.log('Match:', apiResult.rows[0].total_contributed === directSum.rows[0].total);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

verifyTotalContributed();
