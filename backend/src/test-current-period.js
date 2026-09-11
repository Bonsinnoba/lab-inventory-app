import { pool } from './db.js';

async function testCurrentPeriod() {
  try {
    // Test with current date (should return the FY2026 period since today is 2026-08-11)
    const currentResult = await pool.query(
      `SELECT * FROM budget_periods 
       WHERE (start_date IS NULL OR start_date <= CURRENT_DATE) 
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY start_date DESC NULLS LAST
       LIMIT 1`
    );
    console.log('Current period (today is 2026-08-11):', currentResult.rows[0] || 'null');

    // Test with a date outside the period (e.g., 2025-01-01)
    const outsideResult = await pool.query(
      `SELECT * FROM budget_periods 
       WHERE (start_date IS NULL OR start_date <= '2025-01-01'::date) 
       AND (end_date IS NULL OR end_date >= '2025-01-01'::date)
       ORDER BY start_date DESC NULLS LAST
       LIMIT 1`
    );
    console.log('Period for 2025-01-01 (outside FY2026):', outsideResult.rows[0] || 'null');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testCurrentPeriod();
