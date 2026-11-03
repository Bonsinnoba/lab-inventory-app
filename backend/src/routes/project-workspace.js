import {projectWorkHttpMutation} from '../project-work-http.js';
import { Router } from 'express';
import {projectAccessHttpMutation} from '../project-access-http.js';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireProjectAccess, requireProjectEditor } from '../middleware/project-access.js';
import { getResourceAccess } from '../middleware/resource-access.js';
import { visibilityReadSql } from '../middleware/visibility.js';

const router = Router();

async function projectExists(id) {
  const result = await pool.query('SELECT id FROM projects WHERE id = $1', [id]);
  return result.rowCount > 0;
}

async function visibleAttachments(rows,user){const visible=[];for(const row of rows){if((await getResourceAccess(row.resource_id,user)).access!=='none')visible.push(row);}return visible;}

// GET /api/projects/:id/workspace — everything needed for the project workspace.
router.get('/:id/workspace', requireProjectAccess, async (req, res) => {
  const id = req.params.id;
  try {
    if (!(await projectExists(id))) return res.status(404).json({ error: 'Project not found' });
    const [members, tasks, experiments, items, notes, resources, activity] = await Promise.all([
      pool.query(`SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
                  FROM project_members pm JOIN users u ON u.id = pm.user_id
                  WHERE pm.project_id = $1 ORDER BY CASE pm.member_role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.username`, [id]),
      pool.query(`SELECT t.*, u.username AS assignee_username, c.username AS creator_username
                  FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN users c ON c.id=t.created_by
                  WHERE t.project_id=$1 ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'blocked' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
                  t.due_date NULLS LAST, t.created_at DESC`, [id]),
      pool.query(`SELECT e.*, u.username AS performer_username FROM project_experiments e LEFT JOIN users u ON u.id=e.performed_by
                  WHERE e.project_id=$1 ORDER BY e.updated_at DESC`, [id]),
      pool.query(`SELECT pi.*, i.name, i.type, i.status AS item_status, i.current_quantity, i.unit, i.sku, l.name AS location_name
                  FROM project_items pi JOIN items i ON i.id=pi.item_id LEFT JOIN locations l ON l.id=i.location_id
                  WHERE pi.project_id=$1 ORDER BY i.name`, [id]),
      pool.query(`SELECT n.id,n.title,n.body,n.tags,n.author_id,n.created_at,n.updated_at FROM notes n WHERE n.project_id=$1 AND ${visibilityReadSql({alias:'n',entityType:'note',userIdParameter:'$2',roleParameter:'$3'})} ORDER BY n.updated_at DESC`, [id,req.user.userId,req.user.role]),
      pool.query(`SELECT id,name,kind,file_type,original_filename,category,description,tags,created_at,updated_at FROM resources WHERE project_id=$1 ORDER BY updated_at DESC`, [id]),
      req.user.role==='admin' ? pool.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.username AS actor_username
                  FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
                  WHERE (a.entity_type='project' AND a.entity_id::text=$1) OR a.metadata->>'project_id'=$1
                  ORDER BY a.created_at DESC LIMIT 100`, [id]) : Promise.resolve({rows:[]}),
    ]);
    const visibleResources=[];
    for(const resource of resources.rows){const access=await getResourceAccess(resource.id,req.user);if(access.access!=='none')visibleResources.push(resource);}
    res.json({ members: members.rows, tasks: tasks.rows, experiments: experiments.rows, items: items.rows,
      notes: notes.rows, resources: visibleResources, activity: activity.rows,
      permissions: { access: req.projectAccess, member_role: req.projectMemberRole, can_edit: req.projectAccess === 'admin' || req.projectAccess === 'edit' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load project workspace' });
  }
});

router.get('/:id/member-candidates', requireRole('admin'), async (req, res) => {
  try {
    if (!(await projectExists(req.params.id))) return res.status(404).json({ error: 'Project not found' });
    const result = await pool.query(`SELECT id, username, role FROM users WHERE is_active = TRUE ORDER BY username`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to load users' }); }
});

router.post('/:id/members', requireRole('admin'), projectAccessHttpMutation('member','set'));
router.delete('/:id/members/:userId', requireRole('admin'), projectAccessHttpMutation('member','delete'));

router.post('/:id/tasks', requireProjectEditor, projectWorkHttpMutation('task','create'));
router.patch('/:id/tasks/:taskId', requireProjectEditor, projectWorkHttpMutation('task','update'));
router.delete('/:id/tasks/:taskId', requireProjectEditor, projectWorkHttpMutation('task','delete'));
router.post('/:id/experiments', requireProjectEditor, projectWorkHttpMutation('experiment','create'));
router.patch('/:id/experiments/:experimentId', requireProjectEditor, projectWorkHttpMutation('experiment','update'));
router.post('/:id/experiments/:experimentId/repeat', requireProjectEditor, projectWorkHttpMutation('experiment','repeat'));
router.delete('/:id/experiments/:experimentId', requireProjectEditor, projectWorkHttpMutation('experiment','delete'));

router.get('/:id/experiments/:experimentId/history', requireProjectAccess, async (req, res) => {
  try {
    const exists = await pool.query('SELECT 1 FROM project_experiments WHERE id=$1 AND project_id=$2', [req.params.experimentId, req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Experiment not found' });
    const result = await pool.query(`SELECT a.id, a.action, a.old_value, a.new_value, a.metadata, a.created_at, u.username AS actor_username
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
      WHERE a.entity_type='project_experiment' AND a.entity_id=$1
      ORDER BY a.created_at DESC`, [req.params.experimentId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch experiment history' });
  }
});


router.get('/:id/tasks/:taskId/experiments', requireProjectAccess, async (req,res)=>{
  try {
    const r=await pool.query(`SELECT te.*, e.title, e.status, e.hypothesis, e.result, e.conclusion FROM project_task_experiments te JOIN project_tasks t ON t.id=te.task_id AND t.project_id=$2 JOIN project_experiments e ON e.id=te.experiment_id AND e.project_id=$2 WHERE te.task_id=$1 ORDER BY te.created_at DESC`,[req.params.taskId,req.params.id]);
    res.json(r.rows);
  } catch(err){console.error(err);res.status(500).json({error:'Failed to fetch task experiments'});}
});
router.post('/:id/tasks/:taskId/experiments', requireProjectEditor, projectWorkHttpMutation('link','create'));
router.delete('/:id/tasks/:taskId/experiments/:experimentId', requireProjectEditor, projectWorkHttpMutation('link','delete'));

router.get('/:id/experiments/:experimentId/measurements', requireProjectAccess, async(req,res)=>{
  try{const r=await pool.query(`SELECT m.*,u.username AS recorder_username FROM project_experiment_measurements m LEFT JOIN users u ON u.id=m.recorded_by WHERE m.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=m.experiment_id AND e.project_id=$2) ORDER BY m.observed_at NULLS LAST,m.created_at`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch measurements'});}
});
router.post('/:id/experiments/:experimentId/measurements', requireProjectEditor, projectWorkHttpMutation('measurement','create'));
router.patch('/:id/experiments/:experimentId/measurements/:measurementId', requireProjectEditor, projectWorkHttpMutation('measurement','update'));
router.delete('/:id/experiments/:experimentId/measurements/:measurementId', requireProjectEditor, projectWorkHttpMutation('measurement','delete'));

router.get('/:id/experiments/:experimentId/observations', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT o.*,u.username AS recorder_username FROM project_experiment_observations o LEFT JOIN users u ON u.id=o.recorded_by WHERE o.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=o.experiment_id AND e.project_id=$2) ORDER BY o.observed_at NULLS LAST,o.created_at`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch observations'});}});
router.post('/:id/experiments/:experimentId/observations', requireProjectEditor, projectWorkHttpMutation('observation','create'));
router.delete('/:id/experiments/:experimentId/observations/:observationId', requireProjectEditor, projectWorkHttpMutation('observation','delete'));


router.get('/:id/tasks/:taskId/attachments', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT a.*,r.name,r.original_filename,r.kind,r.file_type FROM project_work_attachments a JOIN resources r ON r.id=a.resource_id WHERE a.task_id=$1 AND EXISTS(SELECT 1 FROM project_tasks t WHERE t.id=a.task_id AND t.project_id=$2) ORDER BY a.created_at DESC`,[req.params.taskId,req.params.id]);res.json(await visibleAttachments(r.rows,req.user));}catch(err){res.status(500).json({error:'Failed to fetch task attachments'});}});
router.post('/:id/tasks/:taskId/attachments', requireProjectEditor, projectWorkHttpMutation('task_attachment','create'));
router.delete('/:id/tasks/:taskId/attachments/:attachmentId', requireProjectEditor, projectWorkHttpMutation('task_attachment','delete'));
router.get('/:id/experiments/:experimentId/attachments', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT a.*,r.name,r.original_filename,r.kind,r.file_type FROM project_work_attachments a JOIN resources r ON r.id=a.resource_id WHERE a.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=a.experiment_id AND e.project_id=$2) ORDER BY a.created_at DESC`,[req.params.experimentId,req.params.id]);res.json(await visibleAttachments(r.rows,req.user));}catch(err){res.status(500).json({error:'Failed to fetch experiment attachments'});}});
router.post('/:id/experiments/:experimentId/attachments', requireProjectEditor, projectWorkHttpMutation('experiment_attachment','create'));
router.delete('/:id/experiments/:experimentId/attachments/:attachmentId', requireProjectEditor, projectWorkHttpMutation('experiment_attachment','delete'));

router.get('/:id/experiments/:experimentId/revisions', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT r.*,u.username AS actor_username FROM project_experiment_revisions r LEFT JOIN users u ON u.id=r.actor_id WHERE r.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=r.experiment_id AND e.project_id=$2) ORDER BY r.revision_no DESC`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch experiment revisions'});}});

router.post('/:id/items', requireProjectEditor, projectWorkHttpMutation('item','create'));
router.delete('/:id/items/:itemId', requireProjectEditor, projectWorkHttpMutation('item','delete'));

router.get('/:id/bom', requireProjectAccess, async (req, res) => {
  try {
    const result = await pool.query(`SELECT b.*, pi.name AS preferred_item_name, pi.current_quantity AS preferred_item_quantity,
      ai.name AS alternative_item_name, ai.current_quantity AS alternative_item_quantity
      FROM project_bom_items b LEFT JOIN items pi ON pi.id=b.preferred_item_id LEFT JOIN items ai ON ai.id=b.alternative_item_id
      WHERE b.project_id=$1 ORDER BY b.created_at`, [req.params.id]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch project BOM' }); }
});

router.post('/:id/bom', requireProjectEditor, projectWorkHttpMutation('bom','create'));
router.patch('/:id/bom/:bomId', requireProjectEditor, projectWorkHttpMutation('bom','update'));
router.delete('/:id/bom/:bomId', requireProjectEditor, projectWorkHttpMutation('bom','delete'));

export default router;
