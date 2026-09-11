import { pool } from './db.js';

async function testRemainingBudget() {
  try {
    const budgetPeriodId = '8af43ed6-2517-4982-85b6-1281a1767c29';
    const fundingSourceId = '544d7222-7b28-489e-9d97-0ca93e0c2af0';

    // Get initial remaining
    const initialSummary = await pool.query(
      `SELECT COALESCE(SUM(amount)::float, 0) AS total 
       FROM transactions 
       WHERE direction = 'expense' 
       AND date >= '2026-01-01' AND date <= '2026-12-31'`
    );
    const initialSpent = initialSummary.rows[0].total;
    const initialRemaining = 10000 - initialSpent;
    console.log('Initial spent:', initialSpent);
    console.log('Initial remaining:', initialRemaining);

    // Add an expense
    const expenseResult = await pool.query(
      `INSERT INTO transactions (type, direction, amount, date) 
       VALUES ('purchase', 'expense', 100, CURRENT_DATE) 
       RETURNING id, amount`
    );
    console.log('Added expense:', expenseResult.rows[0]);

    // Check remaining after expense
    const afterExpenseSummary = await pool.query(
      `SELECT COALESCE(SUM(amount)::float, 0) AS total 
       FROM transactions 
       WHERE direction = 'expense' 
       AND date >= '2026-01-01' AND date <= '2026-12-31'`
    );
    const afterExpenseSpent = afterExpenseSummary.rows[0].total;
    const afterExpenseRemaining = 10000 - afterExpenseSpent;
    console.log('After expense - spent:', afterExpenseSpent);
    console.log('After expense - remaining:', afterExpenseRemaining);
    console.log('Remaining decreased by:', initialRemaining - afterExpenseRemaining);

    // Add an income
    const incomeResult = await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, funding_source_id) 
       VALUES ('donation', 'income', 500, CURRENT_DATE, $1) 
       RETURNING id, amount`,
      [fundingSourceId]
    );
    console.log('Added income:', incomeResult.rows[0]);

    // Check remaining after income (should NOT change)
    const afterIncomeSummary = await pool.query(
      `SELECT COALESCE(SUM(amount)::float, 0) AS total 
       FROM transactions 
       WHERE direction = 'expense' 
       AND date >= '2026-01-01' AND date <= '2026-12-31'`
    );
    const afterIncomeSpent = afterIncomeSummary.rows[0].total;
    const afterIncomeRemaining = 10000 - afterIncomeSpent;
    console.log('After income - spent:', afterIncomeSpent);
    console.log('After income - remaining:', afterIncomeRemaining);
    console.log('Remaining changed:', afterExpenseRemaining !== afterIncomeRemaining);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testRemainingBudget();
