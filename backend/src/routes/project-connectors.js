import { Router } from 'express';
import { pool } from '../db.js';
import { requireProjectEditor } from '../middleware/project-access.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

// POST /api/projects/:projectId/connectors
router.post('/:projectId/connectors', requireProjectEditor, async (req, res) => {
  const { source_block_id, target_block_id, label } = req.body;

  if (!source_block_id || !target_block_id) {
    return res.status(400).json({ error: 'source_block_id and target_block_id are required' });
  }

  // Validate both blocks belong to the same project
  const sourceCheck = await pool.query(
    'SELECT id, project_id FROM project_blocks WHERE id = $1',
    [source_block_id]
  );
  if (sourceCheck.rows.length === 0) {
    return res.status(400).json({ error: 'source_block_id does not exist' });
  }

  const targetCheck = await pool.query(
    'SELECT id, project_id FROM project_blocks WHERE id = $1',
    [target_block_id]
  );
  if (targetCheck.rows.length === 0) {
    return res.status(400).json({ error: 'target_block_id does not exist' });
  }

  if (sourceCheck.rows[0].project_id !== req.params.projectId) {
    return res.status(400).json({ error: 'source_block_id belongs to a different project' });
  }

  if (targetCheck.rows[0].project_id !== req.params.projectId) {
    return res.status(400).json({ error: 'target_block_id belongs to a different project' });
  }

  if (source_block_id === target_block_id) {
    return res.status(400).json({ error: 'source_block_id and target_block_id cannot be the same' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO project_connectors (project_id, source_block_id, target_block_id, label)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.projectId, source_block_id, target_block_id, label ?? null]
    );
    await writeAuditLog({
      req,
      action: 'CREATE',
      entityType: 'project_connector',
      entityId: result.rows[0].id,
      newValue: result.rows[0],
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create connector' });
  }
});

export default router;
