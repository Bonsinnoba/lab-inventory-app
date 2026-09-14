import { Router } from 'express';
import { pool } from '../db.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { hasPermission } from '../middleware/permissions.js';

const router = Router();

async function visibleProjectIds(user) {
  if (user?.role === 'admin') return null;
  const r = await pool.query(
    `SELECT p.id FROM projects p
     WHERE p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1)`,
    [user.userId]
  );
  return r.rows.map(x => x.id);
}

router.get('/notifications', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  try {
    const r = await pool.query(
      `SELECT id,type,title,body,entity_type,entity_id,metadata,read_at,created_at
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.userId, limit]
    );
    const unread = await pool.query(`SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user.userId]);
    res.json({ items: r.rows, unread: unread.rows[0].count });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load notifications' }); }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    const r = await pool.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.user.userId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Notification not found' });
    res.json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update notification' }); }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await pool.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [req.user.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update notifications' }); }
});

router.get('/dashboard', hasPermission('projects.view'), async (req, res) => {
  try {
    const ids = await visibleProjectIds(req.user);
    const projectFilter = ids ? `AND p.id = ANY($1::uuid[])` : '';
    const args = ids ? [ids] : [];
    const [projects, overdue, due, recent] = await Promise.all([
      pool.query(`SELECT p.id,p.name,p.status,p.priority,p.due_date,
        COUNT(DISTINCT t.id)::int AS task_count,
        COUNT(DISTINCT CASE WHEN t.status NOT IN ('done','cancelled') THEN t.id END)::int AS open_tasks,
        COUNT(DISTINCT e.id)::int AS experiment_count
        FROM projects p
        LEFT JOIN project_tasks t ON t.project_id=p.id
        LEFT JOIN project_experiments e ON e.project_id=p.id
        WHERE p.status='active' ${projectFilter}
        GROUP BY p.id ORDER BY CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,p.due_date NULLS LAST,p.name`,
        args),
      pool.query(`SELECT t.id,t.project_id,t.title,t.due_date,p.name AS project_name
        FROM project_tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.due_date < current_date AND t.status NOT IN ('done','cancelled') ${projectFilter}
        ORDER BY t.due_date LIMIT 20`, args),
      pool.query(`SELECT t.id,t.project_id,t.title,t.due_date,p.name AS project_name
        FROM project_tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.due_date BETWEEN current_date AND current_date+7 AND t.status NOT IN ('done','cancelled') ${projectFilter}
        ORDER BY t.due_date LIMIT 20`, args),
      pool.query(`SELECT 'task' AS type,t.id,t.title,t.created_at,t.project_id,p.name AS project_name
        FROM project_tasks t JOIN projects p ON p.id=t.project_id
        WHERE 1=1 ${projectFilter}
        UNION ALL
        SELECT 'experiment',e.id,e.title,e.created_at,e.project_id,p.name
        FROM project_experiments e JOIN projects p ON p.id=e.project_id
        WHERE 1=1 ${projectFilter}
        ORDER BY created_at DESC LIMIT 12`, args)
    ]);
    let lowStock = { rows: [] };
    if (req.permissions?.has('inventory.view')) {
      lowStock = await pool.query(`SELECT id,name,current_quantity,initial_quantity,unit,status FROM items
        WHERE status = 'low_stock' OR (initial_quantity > 0 AND current_quantity <= (initial_quantity * 0.2))
        ORDER BY current_quantity ASC LIMIT 12`);
    }
    const health = projects.rows.map(p => {
      const overdueCount = overdue.rows.filter(t => t.project_id === p.id).length;
      const score = Math.max(0, Math.min(100, 100 - overdueCount * 18 - (p.priority === 'critical' ? 5 : 0)));
      return { ...p, health_score: score, health: score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'attention' };
    });
    res.json({
      metrics: {
        active_projects: health.length,
        overdue_tasks: overdue.rows.length,
        due_next_7_days: due.rows.length,
        low_stock: lowStock.rows.length
      },
      projects: health, overdue: overdue.rows, due: due.rows, recent: recent.rows, low_stock: lowStock.rows
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to load command center' }); }
});

router.get('/project-health/:id', hasPermission('projects.view'), async (req, res) => {
  try {
    const access = await getProjectAccess(req.params.id, req.user);
    if (access.access === 'none') return res.status(404).json({ error: 'Project not found' });
    const [tasks, experiments, findings, results, bom, comments] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status NOT IN ('done','cancelled'))::int AS open,
        count(*) FILTER (WHERE due_date < current_date AND status NOT IN ('done','cancelled'))::int AS overdue
        FROM project_tasks WHERE project_id=$1`, [req.params.id]),
      pool.query(`SELECT count(*)::int AS total FROM project_experiments WHERE project_id=$1`, [req.params.id]),
      pool.query(`SELECT count(*)::int AS total FROM lab_findings WHERE project_id=$1`, [req.params.id]),
      pool.query(`SELECT count(*)::int AS total FROM lab_results WHERE project_id=$1`, [req.params.id]),
      pool.query(`SELECT count(*)::int AS total FROM project_bom_items WHERE project_id=$1`, [req.params.id]),
      pool.query(`SELECT count(*)::int AS total FROM project_comments WHERE project_id=$1`, [req.params.id])
    ]);
    const t = tasks.rows[0], total = Math.max(1, t.total);
    const score = Math.max(0, Math.min(100, Math.round(100 - (t.overdue / total) * 55)));
    res.json({ score, status: score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'attention',
      tasks:t, experiments:experiments.rows[0], findings:findings.rows[0], results:results.rows[0], bom:bom.rows[0], comments:comments.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load project health' }); }
});

router.get('/activity', hasPermission('projects.view'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  try {
    const ids = await visibleProjectIds(req.user);
    const filter = ids ? `WHERE project_id = ANY($2::uuid[])` : '';
    const args = ids ? [limit, ids] : [limit];
    const r = await pool.query(
      `SELECT type,id,title,created_at,project_id,project_name FROM (
        SELECT 'task' AS type,t.id,t.title,t.created_at,t.project_id,p.name AS project_name FROM project_tasks t JOIN projects p ON p.id=t.project_id
        UNION ALL SELECT 'experiment',e.id,e.title,e.created_at,e.project_id,p.name FROM project_experiments e JOIN projects p ON p.id=e.project_id
        UNION ALL SELECT 'comment',c.id,'Project comment',c.created_at,c.project_id,p.name FROM project_comments c JOIN projects p ON p.id=c.project_id
      ) x ${filter} ORDER BY created_at DESC LIMIT $1`, args);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load activity' }); }
});

export default router;
