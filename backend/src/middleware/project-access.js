import { pool } from '../db.js';
import { getUserPermissions, hasPermission } from './permissions.js';
import { canReadEntity } from './visibility.js';

export function effectiveProjectAccess({ ownerId, memberRole, visibility, grantLevel, userId, role, canEdit }) {
  if (role === 'admin') return { access: 'admin', memberRole: 'admin' };
  const membership = ownerId === userId ? 'lead' : memberRole || null;
  const editor = role !== 'viewer' && canEdit &&
    (ownerId === userId || memberRole === 'lead' || memberRole === 'member') &&
    (visibility !== 'restricted' || grantLevel === 'edit');
  return { access: editor ? 'edit' : 'view', memberRole: membership };
}

/** Return the project permission for the current user.
 * Every active user can read ordinary project data. Project membership and
 * projects.edit still govern modifications; financial access is separate.
 */
export async function getProjectAccess(projectId, user) {
  if (!user?.userId) return { access: 'none', memberRole: null };

  const userResult = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [user.userId]);
  if (!userResult.rowCount || !userResult.rows[0].is_active) return { access: 'none', memberRole: null };
  const role = userResult.rows[0].role;
  const permissions = await getUserPermissions(user.userId, role);
  // Ordinary project reads are laboratory-wide; no projects.view grant is needed.

  const result = await pool.query(`
    SELECT p.owner_id, p.visibility, pm.member_role, g.access_level AS grant_level
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
    LEFT JOIN record_access_grants g ON g.entity_type = 'project' AND g.entity_id = p.id AND g.user_id = $2
    WHERE p.id = $1`, [projectId, user.userId]);

  if (!result.rowCount) return { access: 'none', memberRole: null };
  const row = result.rows[0];
  if (role === 'admin') return { access: 'admin', memberRole: 'admin' };
  const readable = await canReadEntity({
    entityType: 'project',
    entityId: projectId,
    visibility: row.visibility,
    projectId,
    user: { ...user, role },
  });
  if (!readable) return { access: 'none', memberRole: null };
  return effectiveProjectAccess({
    ownerId: row.owner_id, memberRole: row.member_role, visibility: row.visibility,
    grantLevel: row.grant_level, userId: user.userId, role,
    canEdit: permissions.has('projects.edit'),
  });
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
