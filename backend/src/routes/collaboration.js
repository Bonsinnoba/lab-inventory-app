import { readableNotifications } from '../middleware/notification-visibility.js';
import { commentHttpMutation } from '../comment-sync.js';
import { notificationReadHttp } from '../notification-sync.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getProjectAccess } from '../middleware/project-access.js';

const router = Router();

// A complete authorized read model, distinct from the paginated presentation
// endpoint below. No event is authored by this read and no outbox is required.
router.get('/activity/snapshot', hasPermission('audit.view'), async (_req, res) => {
  try {
    // Capture before the query, so an older slow response cannot acquire a
    // newer timestamp merely by finishing after a more recent snapshot.
    const snapshotAt = new Date().toISOString();
    const result = await pool.query(`SELECT a.id, a.action, a.entity_type, a.entity_id,
      a.metadata, a.created_at, u.username AS actor_username
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
      ORDER BY a.created_at DESC, a.id DESC`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({records:result.rows,snapshot_complete:true,snapshot_at:snapshotAt});
  } catch (err) { console.error(err); res.status(500).json({error:'Failed to synchronize activity'}); }
});

router.get('/activity', hasPermission('audit.view'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const before = req.query.before || null;
  const values = [limit];
  let cursor = '';
  if (before) { values.push(before); cursor = `WHERE a.created_at < $2`; }
  try {
    const result = await pool.query(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, u.username AS actor_username FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ${cursor} ORDER BY a.created_at DESC LIMIT $1`, values);
    res.json({ items: result.rows, next_before: result.rows.at(-1)?.created_at || null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch activity' }); }
});

router.get('/notifications', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  try {
    const visible=await readableNotifications(req.user);
    res.json({items:visible.slice(0,limit),unread_count:visible.filter(row=>!row.read_at).length});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

router.patch('/notifications/:id/read',notificationReadHttp);
router.post('/notifications/read-all',notificationReadHttp);

async function canAccessProject(projectId, userId, role, edit=false) {
  const access=await getProjectAccess(projectId,{userId,role});
  return edit ? ['edit','admin'].includes(access.access) : access.access!=='none';
}

router.get('/projects/:projectId/comments', hasPermission('projects.view'), async (req, res) => {
  try {
    if (!(await canAccessProject(req.params.projectId, req.user.userId, req.user.role))) return res.status(403).json({ error: 'Project access required' });
    const result = await pool.query(`SELECT c.id,c.project_id,c.author_id,c.body,c.created_at,c.updated_at,u.username AS author_username FROM project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.project_id=$1 ORDER BY c.created_at ASC`, [req.params.projectId]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch project comments' }); }
});

router.post('/projects/:projectId/comments',hasPermission('projects.edit'),commentHttpMutation('create'));
router.delete('/projects/:projectId/comments/:commentId',hasPermission('projects.edit'),commentHttpMutation('delete'));

export default router;
