import { pool } from '../db.js';
import { getProjectAccess } from './project-access.js';

export async function requireProjectEditForTransaction(req, res, next) {
  const projectId = req.body?.project_id;
  if (!projectId) return next();
  try {
    const access = await getProjectAccess(projectId, req.user);
    if (!['edit', 'admin'].includes(access.access)) return res.status(403).json({ error: { code: 'PROJECT_EDIT_REQUIRED', message: 'Project-linked transactions require edit access to the project' } });
    req.projectAccess = access.access;
    next();
  } catch (err) {
    console.error('Project transaction access check failed:', err);
    return res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
  }
}

export async function requireExistingTransactionProjectEdit(req, res, next) {
  try {
    const result = await pool.query('SELECT project_id FROM transactions WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
    // A project transfer requires edit access to both the existing and destination projects.
    // Checking only the destination permits moving a transaction out of a restricted project.
    const projectIds = [...new Set([result.rows[0].project_id, req.body?.project_id].filter(Boolean))];
    for (const projectId of projectIds) {
      const access = await getProjectAccess(projectId, req.user);
      if (!['edit', 'admin'].includes(access.access)) return res.status(403).json({ error: { code: 'PROJECT_EDIT_REQUIRED', message: 'Project-linked transactions require edit access to both the existing and destination projects' } });
    }
    req.projectAccess = projectIds.length ? 'edit' : null;
    next();
  } catch (err) {
    console.error('Existing transaction project access check failed:', err);
    return res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
  }
}

// Deleting an existing transaction must enforce its current project boundary,
// even though DELETE requests do not carry a project_id body.
export async function requireExistingTransactionProjectDelete(req, res, next) {
  try {
    const result = await pool.query('SELECT project_id FROM transactions WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
    if (!result.rows[0].project_id) return next();
    const access = await getProjectAccess(result.rows[0].project_id, req.user);
    if (!['edit', 'admin'].includes(access.access)) return res.status(403).json({ error: { code: 'PROJECT_EDIT_REQUIRED', message: 'Project-linked transactions require edit access to the project' } });
    next();
  } catch (err) {
    console.error('Transaction delete project access check failed:', err);
    res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
  }
}
