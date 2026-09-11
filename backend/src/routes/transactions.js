import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

// GET /api/transactions — list, optional filters: type, direction, item_id, project_id, from, to
router.get('/', async (req, res) => {
  const { type, direction, item_id, project_id, budget_period_id, from, to } = req.query;
  const conditions = [];
  const values = [];

  if (type) {
    values.push(type);
    conditions.push(`t.type = $${values.length}`);
  }
  if (direction) {
    values.push(direction);
    conditions.push(`t.direction = $${values.length}`);
  }
  if (item_id) {
    values.push(item_id);
    conditions.push(`t.item_id = $${values.length}`);
  }
  if (project_id) {
    values.push(project_id);
    conditions.push(`t.project_id = $${values.length}`);
  }
  if (budget_period_id) {
    values.push(budget_period_id);
    conditions.push(`t.budget_period_id = $${values.length}`);
  }
  if (from) {
    values.push(from);
    conditions.push(`t.date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`t.date <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT t.*, i.name AS item_name, p.name AS project_name, fs.name AS funding_source_name, bp.label AS budget_period_label
       FROM transactions t
       LEFT JOIN items i ON t.item_id = i.id
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN funding_sources fs ON t.funding_source_id = fs.id
       LEFT JOIN budget_periods bp ON t.budget_period_id = bp.id
       ${where}
       ORDER BY date DESC, created_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch transactions' });
  }
});

// GET /api/transactions/summary — aggregated spend for the financial charts.
// Returns totals by category AND a monthly time series, in one call, so the
// frontend never has to aggregate raw rows itself.
router.get('/summary', async (req, res) => {
  const { from, to, budget_period_id } = req.query;
  const conditions = [];
  const values = [];

  if (from) {
    values.push(from);
    conditions.push(`date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`date <= $${values.length}`);
  }
  if (budget_period_id) {
    values.push(budget_period_id);
    conditions.push(`budget_period_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Get totals by direction
    const totals = await pool.query(
      `SELECT direction, SUM(amount)::float AS total
       FROM transactions ${where}
       GROUP BY direction`,
      values
    );

    const incomeTotal = totals.rows.find(r => r.direction === 'income')?.total || 0;
    const expenseTotal = totals.rows.find(r => r.direction === 'expense')?.total || 0;
    const net = incomeTotal - expenseTotal;

    // Get by_category split by direction
    const byCategory = await pool.query(
      `SELECT direction, type, SUM(amount)::float AS total
       FROM transactions ${where}
       GROUP BY direction, type
       ORDER BY direction, total DESC`,
      values
    );

    const expenseByCategory = byCategory.rows.filter(r => r.direction === 'expense').map(r => ({ type: r.type, total: r.total }));
    const incomeByCategory = byCategory.rows.filter(r => r.direction === 'income').map(r => ({ type: r.type, total: r.total }));

    const byMonth = await pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month,
              direction,
              type,
              SUM(amount)::float AS total
       FROM transactions ${where}
       GROUP BY 1, direction, type
       ORDER BY 1 ASC`,
      values
    );

    const response = {
      totals: {
        income: incomeTotal,
        expense: expenseTotal,
        net: net,
      },
      by_category: {
        expense: expenseByCategory,
        income: incomeByCategory,
      },
      by_month: byMonth.rows,
    };

    // Add budget info if budget_period_id is provided. Spending is based on
    // transactions explicitly assigned to that period, while the period dates
    // are still used to validate new assignments.
    if (budget_period_id) {
      const budgetPeriod = await pool.query(
        'SELECT id, label, total_budget, start_date, end_date FROM budget_periods WHERE id = $1',
        [budget_period_id]
      );

      if (budgetPeriod.rows.length > 0) {
        const period = budgetPeriod.rows[0];
        const spentResult = await pool.query(
          `SELECT COALESCE(SUM(amount), 0)::float AS total
             FROM transactions
            WHERE budget_period_id = $1 AND direction = 'expense'`,
          [budget_period_id]
        );
        const spent = Number(spentResult.rows[0].total || 0);
        const totalBudget = Number(period.total_budget || 0);
        response.budget = {
          period_id: period.id,
          label: period.label,
          total_budget: totalBudget,
          spent,
          remaining: totalBudget - spent,
          start_date: period.start_date,
          end_date: period.end_date,
        };
      }
    }

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to compute summary' });
  }
});

// POST /api/transactions
router.post('/', async (req, res) => {
  const { type, direction, amount, date, vendor, notes, item_id, project_id, funding_source_id, budget_period_id } = req.body;

  if (!type || !direction || amount === undefined) {
    return res.status(400).json({ error: 'type, direction, and amount are required' });
  }

  // Validation 1: amount must be positive
  if (amount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0' });
  }

  // Validation 2: type must be valid for the given direction
  const expenseTypes = ['purchase', 'repair', 'replacement', 'project_expense', 'other'];
  const incomeTypes = ['donation', 'investment', 'grant', 'lab_allocation', 'other_income'];
  
  if (direction === 'expense' && !expenseTypes.includes(type)) {
    return res.status(400).json({ error: `'${type}' is not a valid type for an expense transaction` });
  }
  if (direction === 'income' && !incomeTypes.includes(type)) {
    return res.status(400).json({ error: `'${type}' is not a valid type for an income transaction` });
  }

  // Validation 3: funding_source_id is required for certain income types
  const requiresFundingSource = ['donation', 'investment', 'grant'];
  if (direction === 'income' && requiresFundingSource.includes(type) && !funding_source_id) {
    return res.status(400).json({ error: `funding_source_id is required for type '${type}'` });
  }

  // Validation 4: if funding_source_id is provided, it must exist
  if (funding_source_id) {
    const sourceCheck = await pool.query('SELECT id FROM funding_sources WHERE id = $1', [funding_source_id]);
    if (sourceCheck.rows.length === 0) {
      return res.status(400).json({ error: 'funding_source_id references a non-existent funding source' });
    }
  }

  if (direction === 'expense' && type === 'project_expense' && !project_id) {
    return res.status(400).json({ error: 'project_id is required for project_expense transactions' });
  }

  if (budget_period_id) {
    const period = await pool.query('SELECT id, start_date, end_date FROM budget_periods WHERE id = $1', [budget_period_id]);
    if (!period.rowCount) return res.status(400).json({ error: 'budget_period_id references a non-existent budget period' });
    const txDate = date || new Date().toISOString().slice(0, 10);
    const { start_date, end_date } = period.rows[0];
    if (start_date && txDate < String(start_date).slice(0, 10)) return res.status(400).json({ error: 'transaction date is before the selected budget period' });
    if (end_date && txDate > String(end_date).slice(0, 10)) return res.status(400).json({ error: 'transaction date is after the selected budget period' });
  } else if (date) {
    // Auto-assign only when exactly one budget period contains the date.
    const matching = await pool.query(`SELECT id FROM budget_periods WHERE (start_date IS NULL OR start_date <= $1::date) AND (end_date IS NULL OR end_date >= $1::date) ORDER BY start_date DESC NULLS LAST`, [date]);
    if (matching.rowCount === 1) {
      req.body.budget_period_id = matching.rows[0].id;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO transactions (type, direction, amount, date, vendor, notes, item_id, project_id, logged_by, funding_source_id, budget_period_id)
       VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [type, direction, amount, date ?? null, vendor ?? null, notes ?? null, item_id ?? null, project_id ?? null, req.user?.userId || null, funding_source_id ?? null, budget_period_id ?? req.body.budget_period_id ?? null]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'transaction', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create transaction' });
  }
});

// PUT /api/transactions/:id
router.put('/:id', async (req, res) => {
  const fields = ['type', 'direction', 'amount', 'date', 'vendor', 'notes', 'item_id', 'project_id', 'funding_source_id', 'budget_period_id'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (field in req.body) {
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // If type or direction is being updated, we need to validate the resulting combination
  if ('type' in req.body || 'direction' in req.body) {
    const newType = req.body.type;
    const newDirection = req.body.direction;
    
    // Fetch current values if not provided
    let currentType, currentDirection;
    if (!newType || !newDirection) {
      const current = await pool.query('SELECT type, direction FROM transactions WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      currentType = newType || current.rows[0].type;
      currentDirection = newDirection || current.rows[0].direction;
    } else {
      currentType = newType;
      currentDirection = newDirection;
    }

    const expenseTypes = ['purchase', 'repair', 'replacement', 'project_expense', 'other'];
    const incomeTypes = ['donation', 'investment', 'grant', 'lab_allocation', 'other_income'];
    
    if (currentDirection === 'expense' && !expenseTypes.includes(currentType)) {
      return res.status(400).json({ error: `'${currentType}' is not a valid type for an expense transaction` });
    }
    if (currentDirection === 'income' && !incomeTypes.includes(currentType)) {
      return res.status(400).json({ error: `'${currentType}' is not a valid type for an income transaction` });
    }
  }

  // Validate funding_source_id if being set
  if ('funding_source_id' in req.body && req.body.funding_source_id) {
    const sourceCheck = await pool.query('SELECT id FROM funding_sources WHERE id = $1', [req.body.funding_source_id]);
    if (sourceCheck.rows.length === 0) {
      return res.status(400).json({ error: 'funding_source_id references a non-existent funding source' });
    }
  }

  // Validate funding_source_id requirement if type/direction changes affect it
  if ('type' in req.body || 'direction' in req.body) {
    const newType = req.body.type;
    const newDirection = req.body.direction;
    const newFundingSourceId = req.body.funding_source_id;
    
    let currentType, currentDirection, currentFundingSourceId;
    if (!newType || !newDirection || newFundingSourceId === undefined) {
      const current = await pool.query('SELECT type, direction, funding_source_id FROM transactions WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      currentType = newType || current.rows[0].type;
      currentDirection = newDirection || current.rows[0].direction;
      currentFundingSourceId = newFundingSourceId !== undefined ? newFundingSourceId : current.rows[0].funding_source_id;
    } else {
      currentType = newType;
      currentDirection = newDirection;
      currentFundingSourceId = newFundingSourceId;
    }

    const requiresFundingSource = ['donation', 'investment', 'grant'];
    if (currentDirection === 'income' && requiresFundingSource.includes(currentType) && !currentFundingSourceId) {
      return res.status(400).json({ error: `funding_source_id is required for type '${currentType}'` });
    }
  }

  if (('type' in req.body || 'direction' in req.body || 'project_id' in req.body) && !(await pool.query('SELECT 1 FROM transactions WHERE id=$1',[req.params.id])).rowCount) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const effectiveDirection = req.body.direction ?? (await pool.query('SELECT direction FROM transactions WHERE id=$1',[req.params.id])).rows[0]?.direction;
  const effectiveType = req.body.type ?? (await pool.query('SELECT type FROM transactions WHERE id=$1',[req.params.id])).rows[0]?.type;
  const effectiveProjectId = req.body.project_id ?? (await pool.query('SELECT project_id FROM transactions WHERE id=$1',[req.params.id])).rows[0]?.project_id;
  if (effectiveDirection === 'expense' && effectiveType === 'project_expense' && !effectiveProjectId) {
    return res.status(400).json({ error: 'project_id is required for project_expense transactions' });
  }
  if (req.body.budget_period_id) {
    const period = await pool.query('SELECT start_date,end_date FROM budget_periods WHERE id=$1',[req.body.budget_period_id]);
    if (!period.rowCount) return res.status(400).json({ error: 'budget_period_id references a non-existent budget period' });
    const current = await pool.query('SELECT date FROM transactions WHERE id=$1',[req.params.id]);
    const txDate = req.body.date || current.rows[0]?.date;
    if (period.rows[0].start_date && txDate < String(period.rows[0].start_date).slice(0,10)) return res.status(400).json({ error: 'transaction date is before the selected budget period' });
    if (period.rows[0].end_date && txDate > String(period.rows[0].end_date).slice(0,10)) return res.status(400).json({ error: 'transaction date is after the selected budget period' });
  }

  values.push(req.params.id);

  try {
    const before = await pool.query('SELECT * FROM transactions WHERE id=$1',[req.params.id]);
    const result = await pool.query(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'transaction', entityId: req.params.id, oldValue: before.rows[0], newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update transaction' });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM transactions WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    await writeAuditLog({ req, action: 'DELETE', entityType: 'transaction', entityId: req.params.id, oldValue: result.rows[0] });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete transaction' });
  }
});

export default router;
