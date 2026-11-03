import {projectWorkHttpMutation} from '../project-work-http.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { requireProjectAccess, requireProjectEditor } from '../middleware/project-access.js';
import { getResourceAccess, validateCanvasResource } from '../middleware/resource-access.js';
import { writeAuditLog } from '../middleware/audit.js';
import {getUserPermissions} from '../middleware/permissions.js';

const router = Router();

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;

// GET /api/projects/:projectId/canvas — consolidated fetch: blocks + connectors.
// Free-form model — no row-height table anymore, each block carries its own
// x/y/width/height.
router.get('/:projectId/canvas', requireProjectAccess, async (req, res) => {
  try {
    const blocksResult = await pool.query(
      `SELECT * FROM project_blocks WHERE project_id = $1 ORDER BY created_at ASC`,
      [req.params.projectId]
    );
    const connectorsResult = await pool.query(
      `SELECT * FROM project_connectors WHERE project_id = $1 ORDER BY created_at ASC`,
      [req.params.projectId]
    );

    const blocks=[],mayReadResources=(await getUserPermissions(req.user.userId,req.user.role)).has('resources.view');
    for(const block of blocksResult.rows){
      if(!block.resource_id || mayReadResources&&(await getResourceAccess(block.resource_id,req.user)).access!=='none')blocks.push(block);
    }
    const visibleBlockIds=new Set(blocks.map(block=>block.id));
    res.json({
      blocks,
      connectors: connectorsResult.rows.filter(connector=>visibleBlockIds.has(connector.source_block_id)&&visibleBlockIds.has(connector.target_block_id)),
      permissions: {
        access: req.projectAccess,
        member_role: req.projectMemberRole,
        can_edit: req.projectAccess === 'admin' || req.projectAccess === 'edit',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch canvas' });
  }
});

router.post('/:projectId/blocks', requireProjectEditor, projectWorkHttpMutation('block','create'));

export default router;
