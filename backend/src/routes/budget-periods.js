import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

// GET /api/budget-periods — list, ordered by start_date descending
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM budget_periods ORDER BY start_date DESC NULLS LAST, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch budget periods' });
  }
});

// GET /api/budget-periods/current — returns period containing today's date, or null
router.get('/current', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM budget_periods 
       WHERE (start_date IS NULL OR start_date <= CURRENT_DATE) 
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY start_date DESC NULLS LAST
       LIMIT 1`
    );
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch current budget period' });
  }
});

// GET /api/budget-periods/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM budget_periods WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget period not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch budget period' });
  }
});

// POST /api/budget-periods
router.post('/', async (req, res) => {
  const { label, total_budget, start_date, end_date, notes } = req.body;

  if (!label || total_budget === undefined) {
    return res.status(400).json({ error: 'label and total_budget are required' });
  }

  if (total_budget < 0) {
    return res.status(400).json({ error: 'total_budget must be >= 0' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO budget_periods (label, total_budget, start_date, end_date, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [label, total_budget, start_date ?? null, end_date ?? null, notes ?? null]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'budget_period', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create budget period' });
  }
});

// PUT /api/budget-periods/:id
router.put('/:id', async (req, res) => {
  const fields = ['label', 'total_budget', 'start_date', 'end_date', 'notes'];
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

  // Validate total_budget if being updated
  if ('total_budget' in req.body && req.body.total_budget < 0) {
    return res.status(400).json({ error: 'total_budget must be >= 0' });
  }

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE budget_periods SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget period not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update budget period' });
  }
});

// DELETE /api/budget-periods/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM budget_periods WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget period not found' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete budget period' });
  }
});

export default router;
