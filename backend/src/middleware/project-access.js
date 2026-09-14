import { pool } from '../db.js';
import { hasPermission } from './permissions.js';

/** Return the project permission for the current user.
 * admin => admin; owner/member lead/member => edit; observer => view; none => none.
 */
export async function getProjectAccess(projectId, user) {
  if (!user?.userId) return { access: 'none', memberRole: null };
  if (user.role === 'admin') return { access: 'admin', memberRole: 'admin' };

  const result = await pool.query(`
    SELECT p.owner_id, pm.member_role
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
    WHERE p.id = $1`, [projectId, user.userId]);

  if (!result.rowCount) return { access: 'none', memberRole: null };
  const row = result.rows[0];
  if (user.role === 'viewer') {
    if (row.owner_id === user.userId || row.member_role) return { access: 'view', memberRole: row.member_role || 'observer' };
    return { access: 'none', memberRole: null };
  }
  if (row.owner_id === user.userId) return { access: 'edit', memberRole: 'lead' };
  if (row.member_role === 'lead' || row.member_role === 'member') return { access: 'edit', memberRole: row.member_role };
  if (row.member_role === 'observer') return { access: 'view', memberRole: 'observer' };
  return { access: 'none', memberRole: null };
}

export async function requireProjectAccess(req, res, next) {
  return hasPermission('projects.view')(req, res, async () => {
    try {
      const projectId = req.params.projectId || req.params.id;
      const { access, memberRole } = await getProjectAccess(projectId, req.user);
      if (access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
      req.projectAccess = access;
      req.projectMemberRole = memberRole;
      next();
    } catch (err) {
      console.error('Project access check failed:', err);
      res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
    }
  });
}

export async function requireProjectEditor(req, res, next) {
  return hasPermission('projects.edit')(req, res, async () => {
    try {
      const projectId = req.params.projectId || req.params.id;
      const { access, memberRole } = await getProjectAccess(projectId, req.user);
      if (access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
      if (access === 'view') return res.status(403).json({ error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } });
      req.projectAccess = access;
      req.projectMemberRole = memberRole;
      next();
    } catch (err) {
      console.error('Project editor check failed:', err);
      res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
    }
  });
}
