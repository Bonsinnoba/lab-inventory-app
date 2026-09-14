import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';

const router = Router();

router.get('/overview', hasPermission('reports.view'), async (req, res) => {
  try {
    const projectFilter = req.user.role === 'admin' ? '' : 'WHERE p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1)';
    const projectValues = req.user.role === 'admin' ? [] : [req.user.userId];
    const resourceFilter = req.user.role === 'admin' ? '' : 'WHERE r.project_id IS NULL OR r.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$1 OR pm.user_id=$1)';
    const [projects, inventory, tasks, experiments, resources, activity] = await Promise.all([
      pool.query(`SELECT p.status, COUNT(*)::int AS count FROM projects p ${projectFilter} GROUP BY p.status ORDER BY p.status`, projectValues),
      pool.query(`SELECT type, status, COUNT(*)::int AS count, COALESCE(SUM(current_quantity),0)::float AS quantity FROM items GROUP BY type,status ORDER BY type,status`),
      pool.query(`SELECT t.status, COUNT(*)::int AS count FROM project_tasks t JOIN projects p ON p.id=t.project_id ${projectFilter} GROUP BY t.status ORDER BY t.status`, projectValues),
      pool.query(`SELECT e.status, COUNT(*)::int AS count FROM project_experiments e JOIN projects p ON p.id=e.project_id ${projectFilter} GROUP BY e.status ORDER BY e.status`, projectValues),
      pool.query(`SELECT r.kind, COUNT(*)::int AS count FROM resources r ${resourceFilter} GROUP BY r.kind ORDER BY r.kind`, projectValues),
      pool.query(`SELECT action, COUNT(*)::int AS count FROM audit_log WHERE created_at >= now() - interval '30 days' GROUP BY action ORDER BY count DESC`),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ projects: projects.rows, inventory: inventory.rows, tasks: tasks.rows, experiments: experiments.rows, resources: resources.rows, activity: activity.rows, generated_at: new Date().toISOString() });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to generate reports overview' }); }
});

export default router;
