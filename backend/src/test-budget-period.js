import { pool } from './db.js';

async function createTestBudgetPeriod() {
  try {
    const result = await pool.query(
      "INSERT INTO budget_periods (label, total_budget, start_date, end_date) VALUES ('FY2026', 10000, '2026-01-01', '2026-12-31') RETURNING id"
    );
    console.log('Created budget period:', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

createTestBudgetPeriod();
