import { pool } from './db.js';

async function createTestFundingSource() {
  try {
    const result = await pool.query(
      "INSERT INTO funding_sources (name, source_type) VALUES ('Test Donor', 'donor') RETURNING id"
    );
    console.log('Created funding source:', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

createTestFundingSource();
