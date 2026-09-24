import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';

const router = Router();

router.get('/', hasPermission('audit.view'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const before = req.query.before || null;
  const values = [limit];
  let cursor = '';
  if (before) {
    values.push(before);
    cursor = `WHERE a.created_at < $${values.length}`;
  }

  try {
    const result = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id,
              a.old_value, a.new_value, a.metadata,
              a.ip_address, a.user_agent, a.created_at,
              a.actor_user_id, u.username AS actor_username
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${cursor}
       ORDER BY a.created_at DESC
       LIMIT $1`,
      values
    );
    res.json({ items: result.rows, next_before: result.rows.at(-1)?.created_at || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

export default router;
