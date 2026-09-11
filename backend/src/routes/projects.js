import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getProjectAccess, requireProjectEditor } from '../middleware/project-access.js';

const router = Router();

// GET /api/projects — list, each with its total linked spend
router.get('/', async (req, res) => {
  try {
    const values = [];
    const visibility = req.user.role === 'admin'
      ? ''
      : `WHERE p.owner_id = $1 OR EXISTS (
          SELECT 1 FROM project_members visible_pm
          WHERE visible_pm.project_id = p.id AND visible_pm.user_id = $1
        )`;
    if (req.user.role !== 'admin') values.push(req.user.userId);
    const result = await pool.query(`
      SELECT p.*, COALESCE(pfs.actual_expense, 0)::float AS total_spent,
             COALESCE(pfs.actual_expense, 0)::float AS actual_expense,
             COALESCE(pfs.project_income, 0)::float AS project_income,
             COALESCE(pfs.allocated_inventory_value, 0)::float AS allocated_inventory_value,
             CASE WHEN p.budget IS NULL THEN NULL ELSE (p.budget - COALESCE(pfs.actual_expense,0))::float END AS budget_remaining
      FROM projects p
      LEFT JOIN project_financial_summary pfs ON pfs.project_id = p.id
      ${visibility}
      ORDER BY p.created_at DESC
    `, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch projects' });
  }
});

// GET /api/projects/financial-summary — project budgets vs actuals.
router.get('/financial-summary', async (req, res) => {
  try {
    const values = [];
    const visibility = req.user.role === 'admin'
      ? ''
      : `WHERE pfs.project_id IN (
          SELECT p.id FROM projects p
          WHERE p.owner_id = $1 OR EXISTS (
            SELECT 1 FROM project_members visible_pm
            WHERE visible_pm.project_id = p.id AND visible_pm.user_id = $1
          )
        )`;
    if (req.user.role !== 'admin') values.push(req.user.userId);
    const result = await pool.query(`
      SELECT pfs.*,
             CASE WHEN pfs.budget IS NULL THEN NULL ELSE (pfs.budget - pfs.actual_expense)::float END AS budget_remaining,
             CASE WHEN pfs.budget IS NULL OR pfs.budget = 0 THEN NULL ELSE ROUND((pfs.actual_expense / pfs.budget * 100)::numeric, 1)::float END AS budget_used_percent
      FROM project_financial_summary pfs
      ${visibility}
      ORDER BY pfs.actual_expense DESC, pfs.name`, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch project financial summary' });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const access = await getProjectAccess(req.params.id, req.user);
    if (access.access === 'none') return res.status(404).json({ error: 'Project not found' });
    const project = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (project.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const transactions = await pool.query(
      `SELECT t.*, bp.label AS budget_period_label
         FROM transactions t LEFT JOIN budget_periods bp ON bp.id=t.budget_period_id
        WHERE t.project_id = $1 ORDER BY t.date DESC, t.created_at DESC`,
      [req.params.id]
    );
    const finance = await pool.query('SELECT * FROM project_financial_summary WHERE project_id = $1', [req.params.id]);

    res.json({ ...project.rows[0], transactions: transactions.rows, financials: finance.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch project' });
  }
});

// POST /api/projects
router.post('/', async (req, res) => {
  const { name, status, budget, description = '', priority = 'normal', start_date = null, due_date = null } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects (name, status, budget, description, priority, start_date, due_date, owner_id) VALUES ($1, COALESCE($2, 'active'), $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, status ?? null, budget ?? null, description, priority, start_date, due_date, req.user?.userId || null]
    );
    if (req.user?.userId) {
      await pool.query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1,$2,'lead') ON CONFLICT DO NOTHING`, [result.rows[0].id, req.user.userId]);
    }
    await writeAuditLog({ req, action: 'CREATE', entityType: 'project', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create project' });
  }
});

// PUT /api/projects/:id
router.put('/:id', requireProjectEditor, async (req, res) => {
  const fields = ['name', 'status', 'budget', 'description', 'priority', 'start_date', 'due_date'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (field in req.body) {
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
  }

  // Ownership is an administrative boundary, not a normal project-edit field.
  // Only administrators may transfer ownership; never let a project lead
  // silently take or give ownership through the generic update endpoint.
  if ('owner_id' in req.body) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: { code: 'OWNER_CHANGE_ADMIN_REQUIRED', message: 'Only administrators can change project ownership' } });
    values.push(req.body.owner_id || null);
    updates.push(`owner_id = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  if ('name' in req.body && !String(req.body.name || '').trim()) return res.status(400).json({ error: 'name cannot be empty' });
  if ('status' in req.body && !['active','completed','on_hold','cancelled'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid project status' });
  if ('priority' in req.body && !['low','normal','high','critical'].includes(req.body.priority)) return res.status(400).json({ error: 'Invalid project priority' });

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'project', entityId: req.params.id, newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update project' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await writeAuditLog({ req, action: 'DELETE', entityType: 'project', entityId: req.params.id, metadata: { project_id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete project' });
  }
});

export default router;
