import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { getUserPermissions } from './permissions.js';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  // Browser media elements (<img>, <video>, <audio>, iframe resources) cannot
  // reliably attach an Authorization header. Local resource media URLs may
  // therefore carry the normal authenticated session token in the query
  // string. This is intentionally limited to the media-serving endpoints.
  const queryTokenAllowed =
    req.path.endsWith('/download') ||
    req.path.endsWith('/media') ||
    req.path.endsWith('/thumbnail');
  if (!token && queryTokenAllowed && typeof req.query.access_token === 'string') {
    token = req.query.access_token;
  }

  if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.purpose === 'resource-download' && !req.path.endsWith('/download')) {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN_PURPOSE', message: 'Invalid token purpose' } });
    }

    // The database is authoritative for current role/active status. This
    // means disabling a user or changing their role takes effect immediately,
    // even if an old JWT has not expired yet.
    const result = await pool.query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (!result.rowCount || !result.rows[0].is_active) {
      return res.status(401).json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled or no longer exists' } });
    }

    const user = result.rows[0];
    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
      ...(decoded.purpose ? { purpose: decoded.purpose } : {}),
      ...(decoded.resourceId ? { resourceId: decoded.resourceId } : {}),
    };
    next();
  } catch (err) {
    console.error('Authentication error:', err.message);
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });

    // Project membership management is delegated by permission, but remains
    // scoped to projects the caller can actually edit/manage.
    const projectMemberRoute = req.path.endsWith('/member-candidates') ||
      (req.path.includes('/members') && !req.path.includes('/tasks') && !req.path.includes('/experiments'));
    if (projectMemberRoute && allowedRoles.includes('admin')) {
      try {
        const permissions = await getUserPermissions(req.user.userId, req.user.role);
        if (!permissions.has('projects.manage_members')) {
          return res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Permission required: projects.manage_members', permission: 'projects.manage_members' } });
        }

        const projectId = req.params.projectId || req.params.id;
        const project = await pool.query(`
          SELECT p.owner_id, pm.member_role
          FROM projects p
          LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
          WHERE p.id = $1`, [projectId, req.user.userId]);
        if (!project.rowCount) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' } });

        const row = project.rows[0];
        const canManageProject = req.user.role === 'admin' ||
          row.owner_id === req.user.userId ||
          row.member_role === 'lead' ||
          row.member_role === 'member';
        if (!canManageProject) {
          return res.status(403).json({ error: { code: 'PROJECT_EDITOR_REQUIRED', message: 'You must be a project editor to manage members' } });
        }

        req.permissions = permissions;
        return next();
      } catch (err) {
        return next(err);
      }
    }

    if (allowedRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
  };
}