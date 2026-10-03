import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission, getUserPermissions } from '../middleware/permissions.js';
import { filterReadableRows } from '../middleware/read-visibility.js';

const router = Router();

router.get('/overview', hasPermission('reports.view'), async (req, res) => {
  try {
    const permissions = await getUserPermissions(req.user.userId, req.user.role);
    const canViewAudit = req.user.role === 'admin' && permissions.has('audit.view');
    const [projects, inventory, tasks, experiments, resources, activity] = await Promise.all([
      pool.query('SELECT id,status FROM projects'),
      pool.query(`SELECT type, status, COUNT(*)::int AS count, COALESCE(SUM(current_quantity),0)::float AS quantity FROM items GROUP BY type,status ORDER BY type,status`),
      pool.query('SELECT id,project_id,status FROM project_tasks'),
      pool.query('SELECT id,project_id,status FROM project_experiments'),
      pool.query('SELECT id,kind FROM resources'),
      canViewAudit ? pool.query(`SELECT action, COUNT(*)::int AS count FROM audit_log WHERE created_at >= now() - interval '30 days' GROUP BY action ORDER BY count DESC`) : Promise.resolve({ rows: [] }),
    ]);
    const countBy = (rows,key) => Array.from(rows.reduce((counts,row)=>counts.set(row[key],(counts.get(row[key])||0)+1),new Map()),([value,count])=>({[key]:value,count})).sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
    const [visibleProjects,visibleTasks,visibleExperiments,visibleResources]=await Promise.all([
      filterReadableRows('projects',projects.rows,req.user), filterReadableRows('tasks',tasks.rows,req.user),
      filterReadableRows('experiments',experiments.rows,req.user), filterReadableRows('resources',resources.rows,req.user)
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ projects: countBy(visibleProjects,'status'), inventory: inventory.rows, tasks: countBy(visibleTasks,'status'), experiments: countBy(visibleExperiments,'status'), resources: countBy(visibleResources,'kind'), activity: activity.rows, generated_at: new Date().toISOString() });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to generate reports overview' }); }
});

export default router;
