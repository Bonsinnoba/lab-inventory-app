import { pool } from '../db.js';
import { getProjectAccess } from './project-access.js';

/**
 * Keep Operations' project-scoped requirements and BOM intelligence inside the
 * projects the current user can actually access. Route-level permissions still
 * decide whether the operation is allowed; this middleware enforces the project
 * boundary underneath those global permissions.
 */
export async function operationsProjectBoundary(req, res, next) {
  try {
    const access = await getProjectAccess;
    const projectPermissions = await pool.query(
      `SELECT p.id
       FROM projects p
       WHERE p.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $1
          )`,
      [req.user.userId]
    );
    const allowedProjectIds = new Set(projectPermissions.rows.map((row) => String(row.id)));

    if (req.user.role === 'admin') {
      allowedProjectIds.add('*');
    }

    const requireProjectEdit = async (projectId) => {
      if (!projectId) return true;
      if (allowedProjectIds.has('*')) return true;
      const result = await access(projectId, req.user);
      return result.access === 'edit' || result.access === 'admin';
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      let projectId = req.body?.project_id || req.body?.projectId;
      if (!projectId && req.params?.id) {
        const result = await pool.query('SELECT project_id FROM project_resource_requirements WHERE id = $1', [req.params.id]);
        projectId = result.rows[0]?.project_id;
      }
      if (projectId && !(await requireProjectEdit(projectId))) {
        return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have edit access to this project' } });
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const filterRows = (rows) => Array.isArray(rows)
        ? rows.filter((row) => !row?.project_id || allowedProjectIds.has('*') || allowedProjectIds.has(String(row.project_id)))
        : rows;

      if (Array.isArray(payload)) return originalJson(filterRows(payload));
      if (!payload || typeof payload !== 'object') return originalJson(payload);

      const safe = { ...payload };
      if (Array.isArray(safe.requirements)) safe.requirements = filterRows(safe.requirements);
      if (Array.isArray(safe.missing_bom)) safe.missing_bom = filterRows(safe.missing_bom);
      if (Array.isArray(safe.project_requirements)) safe.project_requirements = filterRows(safe.project_requirements);
      return originalJson(safe);
    };

    next();
  } catch (err) {
    console.error('Operations project boundary failed:', err);
    return res.status(500).json({ error: { code: 'PROJECT_ACCESS_CHECK_FAILED', message: 'Unable to verify project permissions' } });
  }
}
