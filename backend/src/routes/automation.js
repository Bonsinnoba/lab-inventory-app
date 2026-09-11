import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

async function dueRows(user) {
  const [maintenance, calibration, tasks] = await Promise.all([
    pool.query(`SELECT i.id,i.name,i.next_maintenance_date FROM items i WHERE i.next_maintenance_date IS NOT NULL AND i.next_maintenance_date <= current_date + 7 ORDER BY i.next_maintenance_date`),
    pool.query(`SELECT i.id,i.name,i.next_calibration_date FROM items i WHERE i.next_calibration_date IS NOT NULL AND i.next_calibration_date <= current_date + 30 ORDER BY i.next_calibration_date`),
    pool.query(`SELECT t.id,t.project_id,t.title,t.assignee_id,t.due_date,p.name AS project_name FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.due_date IS NOT NULL AND t.due_date <= current_date AND t.status NOT IN ('done','cancelled') AND ($1 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=$2)) ORDER BY t.due_date`, [user?.role, user?.userId]),
  ]);
  return { maintenance: maintenance.rows, calibration: calibration.rows, tasks: tasks.rows };
}

router.get('/due', async (req, res) => { try { res.json(await dueRows(req.user)); } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load automation due items' }); } });

router.post('/run', requireRole('admin'), async (req, res) => {
  try {
    const due = await dueRows(req.user);
    const recipients = await pool.query("SELECT id FROM users WHERE is_active=TRUE AND (role='admin' OR role IN ('researcher','technician'))");
    let created = 0;
    const notify = async (userId, type, title, body, entityType, entityId, key) => {
      const exists = await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND metadata->>'reminder_key'=$2", [userId, key]);
      if (exists.rowCount) return;
      await pool.query(`INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`, [userId,type,title,body,entityType,entityId,JSON.stringify({ reminder_key:key })]);
      created++;
    };
    for (const item of due.maintenance) for (const user of recipients.rows) await notify(user.id,'maintenance_due','Maintenance due',`${item.name} has maintenance due on ${item.next_maintenance_date}.`,'item',item.id,`maintenance:${item.id}:${item.next_maintenance_date}`);
    for (const item of due.calibration) for (const user of recipients.rows) await notify(user.id,'calibration_due','Calibration due',`${item.name} has calibration due on ${item.next_calibration_date}.`,'item',item.id,`calibration:${item.id}:${item.next_calibration_date}`);
    for (const task of due.tasks) { const targets = task.assignee_id ? [{ id: task.assignee_id }] : recipients.rows; for (const user of targets) await notify(user.id,'task_due','Task overdue',`${task.title} in ${task.project_name} is overdue.`,'project_task',task.id,`task:${task.id}:${task.due_date}`); }
    res.json({ created, due });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to run automation reminders' }); }
});

export default router;
