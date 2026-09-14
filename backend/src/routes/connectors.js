import { Router } from 'express';
import { pool } from '../db.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

// DELETE /api/connectors/:id
router.delete('/:id', hasPermission('projects.edit'), async (req, res) => {
  try {
    const current = await pool.query('SELECT project_id FROM project_connectors WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: { code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found' } });
    const access = await getProjectAccess(current.rows[0].project_id, req.user);
    if (access.access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
    if (access.access === 'view') return res.status(403).json({ error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } });
    const result = await pool.query('DELETE FROM project_connectors WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connector not found' });
    }
    await writeAuditLog({
      req,
      action: 'DELETE',
      entityType: 'project_connector',
      entityId: req.params.id,
      oldValue: current.rows[0],
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete connector' });
  }
});

export default router;
