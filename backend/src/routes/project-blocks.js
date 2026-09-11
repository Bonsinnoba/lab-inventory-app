import { Router } from 'express';
import { pool } from '../db.js';
import { requireProjectAccess, requireProjectEditor } from '../middleware/project-access.js';
import { validateCanvasResource } from '../middleware/resource-access.js';
import { writeAuditLog } from '../middleware/audit.js';

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

    res.json({
      blocks: blocksResult.rows,
      connectors: connectorsResult.rows,
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

function validateContentMatchesType(block_type, text_content, resource_id) {
  if (block_type === 'text' && !text_content) {
    return 'text_content is required for text blocks';
  }
  if (block_type !== 'text' && !resource_id) {
    return 'resource_id is required for media blocks';
  }
  return null;
}

// POST /api/projects/:projectId/blocks — free positioning, no overlap check,
// no row/column snapping. (x, y) is top-left corner in canvas pixels.
router.post('/:projectId/blocks', requireProjectEditor, async (req, res) => {
  const { block_type, text_content, resource_id, title, x, y, width, height } = req.body;

  if (!block_type) {
    return res.status(400).json({ error: 'block_type is required' });
  }

  const contentError = validateContentMatchesType(block_type, text_content, resource_id);
  if (contentError) {
    return res.status(400).json({ error: contentError });
  }

  const finalWidth = Math.round(Number(width ?? 320));
  const finalHeight = Math.round(Number(height ?? 200));
  const finalX = Math.round(Number(x ?? 0));
  const finalY = Math.round(Number(y ?? 0));
  if (![finalX, finalY, finalWidth, finalHeight].every(Number.isFinite)) {
    return res.status(400).json({ error: { code: 'INVALID_GEOMETRY', message: 'Canvas geometry must contain finite numbers' } });
  }
  if (finalWidth < MIN_WIDTH || finalHeight < MIN_HEIGHT) {
    return res.status(400).json({
      error: `width must be >= ${MIN_WIDTH} and height must be >= ${MIN_HEIGHT}`,
    });
  }

  try {
    if (resource_id) {
      const resourceCheck = await validateCanvasResource(resource_id, req.params.projectId, req.user);
      if (!resourceCheck.ok) return res.status(resourceCheck.status).json({ error: resourceCheck.error });
    }

    const result = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, resource_id, title, x, y, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.params.projectId,
        block_type,
        text_content ?? null,
        resource_id ?? null,
        title?.trim() || null,
        finalX,
        finalY,
        finalWidth,
        finalHeight,
      ]
    );
    await writeAuditLog({
      req,
      action: 'CREATE',
      entityType: 'project_block',
      entityId: result.rows[0].id,
      newValue: result.rows[0],
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create block' });
  }
});

export default router;
