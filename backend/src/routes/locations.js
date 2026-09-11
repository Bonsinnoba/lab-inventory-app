import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, COUNT(i.id)::int AS item_count
      FROM locations l
      LEFT JOIN items i ON i.location_id = l.id
      GROUP BY l.id
      ORDER BY l.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Location not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

router.post('/', async (req, res) => {
  const { name, parent_id = null } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const result = await pool.query(
      'INSERT INTO locations (name, parent_id) VALUES ($1, $2) RETURNING *',
      [name.trim(), parent_id]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'location', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

router.put('/:id', async (req, res) => {
  const { name, parent_id } = req.body;
  if (name === undefined && parent_id === undefined) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const before = await pool.query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (!before.rowCount) return res.status(404).json({ error: 'Location not found' });
    const result = await pool.query(
      'UPDATE locations SET name = COALESCE($1, name), parent_id = $2 WHERE id = $3 RETURNING *',
      [name?.trim() || null, parent_id ?? before.rows[0].parent_id, req.params.id]
    );
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'location', entityId: req.params.id, oldValue: before.rows[0], newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const before = await pool.query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (!before.rowCount) return res.status(404).json({ error: 'Location not found' });
    const result = await pool.query('DELETE FROM locations WHERE id = $1 RETURNING id', [req.params.id]);
    await writeAuditLog({ req, action: 'DELETE', entityType: 'location', entityId: req.params.id, oldValue: before.rows[0] });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

export default router;
