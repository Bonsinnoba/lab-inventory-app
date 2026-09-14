import { Router } from 'express';
import { pool } from '../db.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { validateCanvasResource } from '../middleware/resource-access.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;

function validateContentMatchesType(block_type, text_content, resource_id) {
  if (block_type === 'text' && !text_content) {
    return 'text_content is required for text blocks';
  }
  if (block_type !== 'text' && !resource_id) {
    return 'resource_id is required for media blocks';
  }
  return null;
}

// PUT /api/blocks/:id — update position, size, and/or content. Every block
// resizes and repositions independently — no shared row, no overlap
// rejection, blocks may occupy the same space.
router.put('/:id', hasPermission('projects.edit'), async (req, res) => {
  const fields = ['block_type', 'text_content', 'resource_id', 'title', 'x', 'y', 'width', 'height'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (field in req.body) {
      let value = req.body[field];
      if (['x', 'y', 'width', 'height'].includes(field)) {
        value = Math.round(Number(value));
        if (!Number.isFinite(value)) return res.status(400).json({ error: { code: 'INVALID_GEOMETRY', message: `${field} must be a finite number` } });
      }
      values.push(value);
      updates.push(`${field} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const current = await pool.query('SELECT * FROM project_blocks WHERE id = $1', [req.params.id]);
  if (current.rows.length === 0) {
    return res.status(404).json({ error: 'Block not found' });
  }
  const currentBlock = current.rows[0];
  const access = await getProjectAccess(currentBlock.project_id, req.user);
  if (access.access === 'none') {
    return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
  }
  if (access.access === 'view') {
    return res.status(403).json({ error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } });
  }

  if ('width' in req.body && (!Number.isFinite(Number(req.body.width)) || Number(req.body.width) < MIN_WIDTH)) {
    return res.status(400).json({ error: `width must be >= ${MIN_WIDTH}` });
  }
  if ('height' in req.body && (!Number.isFinite(Number(req.body.height)) || Number(req.body.height) < MIN_HEIGHT)) {
    return res.status(400).json({ error: `height must be >= ${MIN_HEIGHT}` });
  }

  if ('block_type' in req.body || 'text_content' in req.body || 'resource_id' in req.body) {
    const newType = req.body.block_type ?? currentBlock.block_type;
    const newText = 'text_content' in req.body ? req.body.text_content : currentBlock.text_content;
    const newResource = 'resource_id' in req.body ? req.body.resource_id : currentBlock.resource_id;
    const contentError = validateContentMatchesType(newType, newText, newResource);
    if (contentError) {
      return res.status(400).json({ error: contentError });
    }
  }

  if ('resource_id' in req.body && req.body.resource_id) {
    const resourceCheck = await validateCanvasResource(req.body.resource_id, currentBlock.project_id, req.user);
    if (!resourceCheck.ok) return res.status(resourceCheck.status).json({ error: resourceCheck.error });
  }

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE project_blocks SET ${updates.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values
    );
    await writeAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'project_block',
      entityId: req.params.id,
      oldValue: currentBlock,
      newValue: result.rows[0],
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update block' });
  }
});

// DELETE /api/blocks/:id — connectors referencing this block cascade-delete
router.delete('/:id', hasPermission('projects.edit'), async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM project_blocks WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: { code: 'BLOCK_NOT_FOUND', message: 'Block not found' } });
    const currentBlock = current.rows[0];
    const access = await getProjectAccess(currentBlock.project_id, req.user);
    if (access.access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
    if (access.access === 'view') return res.status(403).json({ error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } });
    const result = await pool.query('DELETE FROM project_blocks WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    await writeAuditLog({
      req,
      action: 'DELETE',
      entityType: 'project_block',
      entityId: req.params.id,
      oldValue: currentBlock,
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete block' });
  }
});

export default router;
