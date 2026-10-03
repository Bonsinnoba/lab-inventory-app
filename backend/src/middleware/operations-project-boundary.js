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

      const requirementId=req.params?.id || /^\/requirements\/([0-9a-f-]+)\/?$/i.exec(req.path)?.[1];
      if (requirementId) {
        const result = await pool.query(
          'SELECT project_id FROM project_resource_requirements WHERE id = $1',
          [requirementId]
        );
        projectId = result.rows[0]?.project_id;
        if(!projectId)return res.status(404).json({error:'Requirement not found'});
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
