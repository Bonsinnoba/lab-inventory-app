import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

// GET /api/funding-sources — list with total_contributed
router.get('/', hasPermission('finance.view_sensitive'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fs.*,
              COALESCE(SUM(t.amount)::float, 0) AS total_contributed
       FROM funding_sources fs
       LEFT JOIN transactions t ON fs.id = t.funding_source_id AND t.direction = 'income'
       GROUP BY fs.id
       ORDER BY fs.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch funding sources' });
  }
});

// GET /api/funding-sources/:id — single source + transaction history
router.get('/:id', hasPermission('finance.view_sensitive'), async (req, res) => {
  try {
    const sourceResult = await pool.query(
      `SELECT fs.*,
              COALESCE(SUM(t.amount)::float, 0) AS total_contributed
       FROM funding_sources fs
       LEFT JOIN transactions t ON fs.id = t.funding_source_id AND t.direction = 'income'
       WHERE fs.id = $1
       GROUP BY fs.id`,
      [req.params.id]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Funding source not found' });
    }

    const transactionsResult = await pool.query(
      `SELECT * FROM transactions WHERE funding_source_id = $1 ORDER BY date DESC, created_at DESC`,
      [req.params.id]
    );

    res.json({
      ...sourceResult.rows[0],
      transactions: transactionsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch funding source' });
  }
});

// POST /api/funding-sources
router.post('/', hasPermission('finance.edit'), async (req, res) => {
  const { name, source_type, contact_info, notes } = req.body;

  if (!name || !source_type) {
    return res.status(400).json({ error: 'name and source_type are required' });
  }

  const validSourceTypes = ['donor', 'investor', 'grant_body', 'institutional', 'other'];
  if (!validSourceTypes.includes(source_type)) {
    return res.status(400).json({ error: `source_type must be one of: ${validSourceTypes.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO funding_sources (name, source_type, contact_info, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, source_type, contact_info ?? null, notes ?? null]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'funding_source', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Funding source already exists' });
    res.status(500).json({ error: err.message || 'Failed to create funding source' });
  }
});

// PUT /api/funding-sources/:id
router.put('/:id', hasPermission('finance.edit'), async (req, res) => {
  const fields = ['name', 'source_type', 'contact_info', 'notes'];
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

  if ('source_type' in req.body) {
    const validSourceTypes = ['donor', 'investor', 'grant_body', 'institutional', 'other'];
    if (!validSourceTypes.includes(req.body.source_type)) {
      return res.status(400).json({ error: `source_type must be one of: ${validSourceTypes.join(', ')}` });
    }
  }

  values.push(req.params.id);

  try {
    const current = await pool.query('SELECT * FROM funding_sources WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'Funding source not found' });
    const result = await pool.query(
      `UPDATE funding_sources SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'funding_source', entityId: req.params.id, oldValue: current.rows[0], newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Funding source already exists' });
    res.status(500).json({ error: err.message || 'Failed to update funding source' });
  }
});

// DELETE /api/funding-sources/:id
router.delete('/:id', hasPermission('finance.delete'), async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM funding_sources WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'Funding source not found' });
    await pool.query('DELETE FROM funding_sources WHERE id = $1', [req.params.id]);
    await writeAuditLog({ req, action: 'DELETE', entityType: 'funding_source', entityId: req.params.id, oldValue: current.rows[0] });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete funding source' });
  }
});

export default router;
