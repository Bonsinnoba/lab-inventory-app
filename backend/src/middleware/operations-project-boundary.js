import { pool } from '../db.js';
import { getProjectAccess } from './project-access.js';

/**
 * Operations uses project access to authorize mutations, not to hide ordinary
 * project data. Domain-level view permissions remain responsible for reads.
 */
export async function operationsProjectBoundary(req, res, next) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      let projectId = req.body?.project_id || req.body?.projectId;

      if (!projectId && req.params?.id) {
        const result = await pool.query(
          'SELECT project_id FROM project_resource_requirements WHERE id = $1',
          [req.params.id]
        );
        projectId = result.rows[0]?.project_id;
      }

      if (projectId) {
        const access = await getProjectAccess(projectId, req.user);
        if (access.access !== 'edit' && access.access !== 'admin') {
          return res.status(403).json({
            error: {
              code: 'PROJECT_ACCESS_REQUIRED',
              message: 'You do not have edit access to this project',
            },
          });
        }
      }
    }

    next();
  } catch (err) {
    console.error('Operations project boundary failed:', err);
    return res.status(500).json({
      error: {
        code: 'PROJECT_ACCESS_CHECK_FAILED',
        message: 'Unable to verify project permissions',
      },
    });
  }
}
