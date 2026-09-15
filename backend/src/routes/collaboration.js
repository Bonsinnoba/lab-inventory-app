import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

router.get('/activity', hasPermission('reports.view'), async (req, res) => {
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
    const result = await pool.query(`SELECT id,type,title,body,entity_type,entity_id,metadata,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [req.user.userId, limit]);
    const unread = await pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.userId]);
    res.json({ items: result.rows, unread_count: unread.rows[0].count });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const result = await pool.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at`, [req.params.id, req.user.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Notification not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to mark notification read' }); }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    const result = await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND read_at IS NULL', [req.user.userId]);
    res.json({ updated: result.rowCount });
  } catch (err) { res.status(500).json({ error: 'Failed to mark notifications read' }); }
});

async function canAccessProject(projectId, userId, role) {
  if (role === 'admin') return true;
  const result = await pool.query(`SELECT 1 FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2 WHERE p.id=$1 AND (p.owner_id=$2 OR pm.user_id=$2)`, [projectId, userId]);
  return result.rowCount > 0;
}

router.get('/projects/:projectId/comments', hasPermission('projects.view'), async (req, res) => {
  try {
    if (!(await canAccessProject(req.params.projectId, req.user.userId, req.user.role))) return res.status(403).json({ error: 'Project access required' });
    const result = await pool.query(`SELECT c.id,c.project_id,c.author_id,c.body,c.created_at,c.updated_at,u.username AS author_username FROM project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.project_id=$1 ORDER BY c.created_at ASC`, [req.params.projectId]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch project comments' }); }
});

router.post('/projects/:projectId/comments', hasPermission('projects.edit'), async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (body.length > 5000) return res.status(400).json({ error: 'comment is too long' });
  try {
    if (!(await canAccessProject(req.params.projectId, req.user.userId, req.user.role))) return res.status(403).json({ error: 'Project access required' });
    const result = await pool.query(`INSERT INTO project_comments(project_id,author_id,body) VALUES($1,$2,$3) RETURNING id,project_id,author_id,body,created_at,updated_at`, [req.params.projectId, req.user.userId, body]);
    await writeAuditLog({ req, action:'CREATE', entityType:'project_comment', entityId:result.rows[0].id, metadata:{ project_id:req.params.projectId } });
    const row = await pool.query(`SELECT c.*,u.username AS author_username FROM project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.id=$1`, [result.rows[0].id]);
    const members = await pool.query(`SELECT user_id FROM project_members WHERE project_id=$1 AND user_id<>$2`, [req.params.projectId, req.user.userId]);
    for (const member of members.rows) await pool.query(`INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata) VALUES($1,'project_comment','New project comment',$2,'project_comment',$3,$4)`, [member.user_id, `${req.user.username} commented on a project.`, result.rows[0].id, JSON.stringify({project_id:req.params.projectId})]);
    res.status(201).json(row.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error:'Failed to create project comment' }); }
});

router.delete('/projects/:projectId/comments/:commentId', hasPermission('projects.edit'), async (req, res) => {
  try {
    if (!(await canAccessProject(req.params.projectId, req.user.userId, req.user.role))) return res.status(403).json({ error:'Project access required' });
    const current = await pool.query('SELECT author_id FROM project_comments WHERE id=$1 AND project_id=$2', [req.params.commentId, req.params.projectId]);
    if (!current.rowCount) return res.status(404).json({ error:'Comment not found' });
    if (req.user.role !== 'admin' && current.rows[0].author_id !== req.user.userId) return res.status(403).json({ error:'Only the author or an administrator can delete this comment' });
    await pool.query('DELETE FROM project_comments WHERE id=$1 AND project_id=$2', [req.params.commentId, req.params.projectId]);
    await writeAuditLog({ req, action:'DELETE', entityType:'project_comment', entityId:req.params.commentId, metadata:{project_id:req.params.projectId} });
    res.status(204).send();
  } catch (err) { res.status(500).json({ error:'Failed to delete project comment' }); }
});

export default router;
