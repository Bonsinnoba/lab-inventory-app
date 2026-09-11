import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireProjectAccess, requireProjectEditor } from '../middleware/project-access.js';

const router = Router();

async function projectExists(id) {
  const result = await pool.query('SELECT id FROM projects WHERE id = $1', [id]);
  return result.rowCount > 0;
}

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
      pool.query(`SELECT id,title,body,tags,author_id,created_at,updated_at FROM notes WHERE project_id=$1 ORDER BY updated_at DESC`, [id]),
      pool.query(`SELECT id,name,kind,file_type,original_filename,category,description,tags,created_at,updated_at FROM resources WHERE project_id=$1 ORDER BY updated_at DESC`, [id]),
      pool.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.username AS actor_username
                  FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
                  WHERE (a.entity_type='project' AND a.entity_id::text=$1) OR a.metadata->>'project_id'=$1
                  ORDER BY a.created_at DESC LIMIT 100`, [id]),
    ]);
    res.json({ members: members.rows, tasks: tasks.rows, experiments: experiments.rows, items: items.rows,
      notes: notes.rows, resources: resources.rows, activity: activity.rows,
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

router.post('/:id/members', requireRole('admin'), async (req, res) => {
  const { user_id, member_role = 'member' } = req.body;
  if (!user_id || !['lead','member','observer'].includes(member_role)) return res.status(400).json({ error: 'user_id and valid member_role are required' });
  try {
    if (!(await projectExists(req.params.id))) return res.status(404).json({ error: 'Project not found' });
    const user = await pool.query('SELECT id, username, role FROM users WHERE id=$1 AND is_active=TRUE', [user_id]);
    if (!user.rowCount) return res.status(404).json({ error: 'Active user not found' });
    const result = await pool.query(`INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,$3)
      ON CONFLICT(project_id,user_id) DO UPDATE SET member_role=EXCLUDED.member_role RETURNING *`, [req.params.id,user_id,member_role]);
    await writeAuditLog({ req, action:'UPDATE', entityType:'project_member', entityId:user_id, metadata:{project_id:req.params.id, member_role} });
    const row = await pool.query(`SELECT pm.*,u.username,u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 AND pm.user_id=$2`, [req.params.id,user_id]);
    res.status(201).json(row.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23503') return res.status(400).json({ error: 'User does not exist' });
    res.status(500).json({ error: 'Failed to add project member' });
  }
});

router.delete('/:id/members/:userId', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2 RETURNING user_id', [req.params.id,req.params.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Project member not found' });
    await writeAuditLog({ req, action:'DELETE', entityType:'project_member', entityId:req.params.userId, metadata:{project_id:req.params.id} });
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: 'Failed to remove project member' }); }
});

router.post('/:id/tasks', requireProjectEditor, async (req, res) => {
  const { title, description='', status='todo', priority='normal', assignee_id=null, due_date=null } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!['todo','in_progress','blocked','done','cancelled'].includes(status) || !['low','normal','high','critical'].includes(priority)) return res.status(400).json({ error: 'invalid task status or priority' });
  try {
    if (!(await projectExists(req.params.id))) return res.status(404).json({ error: 'Project not found' });
    const result = await pool.query(`INSERT INTO project_tasks(project_id,title,description,status,priority,assignee_id,due_date,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.params.id,title.trim(),description,status,priority,assignee_id,due_date,req.user?.userId || null]);
    await writeAuditLog({req,action:'CREATE',entityType:'project_task',entityId:result.rows[0].id,newValue:result.rows[0],metadata:{project_id:req.params.id}});
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error:'Failed to create task' }); }
});

router.patch('/:id/tasks/:taskId', requireProjectEditor, async (req,res) => {
  const allowed=['title','description','status','priority','assignee_id','due_date'];
  const updates=[]; const values=[];
  for (const field of allowed) if (field in req.body) { values.push(req.body[field]); updates.push(`${field}=$${values.length}`); }
  if (!updates.length) return res.status(400).json({error:'No valid fields to update'});
  if ('status' in req.body && !['todo','in_progress','blocked','done','cancelled'].includes(req.body.status)) return res.status(400).json({error:'invalid task status'});
  if ('priority' in req.body && !['low','normal','high','critical'].includes(req.body.priority)) return res.status(400).json({error:'invalid task priority'});
  if ('title' in req.body && !String(req.body.title || '').trim()) return res.status(400).json({error:'title cannot be empty'});
  values.push(req.params.taskId, req.params.id);
  try {
    const result=await pool.query(`UPDATE project_tasks SET ${updates.join(',')} WHERE id=$${values.length-1} AND project_id=$${values.length} RETURNING *`,values);
    if(!result.rowCount) return res.status(404).json({error:'Task not found'});
    await writeAuditLog({req,action:'UPDATE',entityType:'project_task',entityId:req.params.taskId,newValue:result.rows[0],metadata:{project_id:req.params.id}});
    res.json(result.rows[0]);
  } catch(err){ console.error(err); res.status(500).json({error:'Failed to update task'}); }
});

router.delete('/:id/tasks/:taskId', requireProjectEditor, async (req,res)=>{
  try{ const result=await pool.query('DELETE FROM project_tasks WHERE id=$1 AND project_id=$2 RETURNING id',[req.params.taskId,req.params.id]);
    if(!result.rowCount)return res.status(404).json({error:'Task not found'});
    await writeAuditLog({req,action:'DELETE',entityType:'project_task',entityId:req.params.taskId,metadata:{project_id:req.params.id}}); res.status(204).send();
  }catch(err){res.status(500).json({error:'Failed to delete task'});}
});

router.post('/:id/experiments', requireProjectEditor, async (req,res)=>{
  const {title,status='planned',hypothesis='',procedure='',observations='',result='',conclusion='',performed_by=null}=req.body;
  if(!title?.trim())return res.status(400).json({error:'title is required'});
  if(!['planned','running','completed','failed','cancelled'].includes(status))return res.status(400).json({error:'invalid experiment status'});
  try{if(!(await projectExists(req.params.id)))return res.status(404).json({error:'Project not found'});
    const r=await pool.query(`INSERT INTO project_experiments(project_id,title,status,hypothesis,procedure,observations,result,conclusion,performed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.params.id,title.trim(),status,hypothesis,procedure,observations,result,conclusion,performed_by||req.user?.userId||null]);
    await writeAuditLog({req,action:'CREATE',entityType:'project_experiment',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id:req.params.id}});res.status(201).json(r.rows[0]);
  }catch(err){console.error(err);res.status(500).json({error:'Failed to create experiment'});}
});

router.patch('/:id/experiments/:experimentId', requireProjectEditor, async (req,res)=>{
  const allowed=['title','status','hypothesis','procedure','observations','result','conclusion','performed_by'];const updates=[];const values=[];
  for(const f of allowed)if(f in req.body){values.push(req.body[f]);updates.push(`${f}=$${values.length}`);}if(!updates.length)return res.status(400).json({error:'No valid fields to update'}); if('status' in req.body && !['planned','running','completed','failed','cancelled'].includes(req.body.status))return res.status(400).json({error:'invalid experiment status'}); if('title' in req.body && !String(req.body.title || '').trim())return res.status(400).json({error:'title cannot be empty'}); values.push(req.params.experimentId,req.params.id);
  try{const before=await pool.query('SELECT * FROM project_experiments WHERE id=$1 AND project_id=$2',[req.params.experimentId,req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Experiment not found'});const r=await pool.query(`UPDATE project_experiments SET ${updates.join(',')} WHERE id=$${values.length-1} AND project_id=$${values.length} RETURNING *`,values);await writeAuditLog({req,action:'UPDATE',entityType:'project_experiment',entityId:req.params.experimentId,oldValue:before.rows[0],newValue:r.rows[0],metadata:{project_id:req.params.id}});res.json(r.rows[0]);
  }catch(err){console.error(err);res.status(500).json({error:'Failed to update experiment'});}
});

router.post('/:id/experiments/:experimentId/repeat', requireProjectEditor, async (req, res) => {
  try {
    const source = await pool.query(`SELECT title, hypothesis, procedure FROM project_experiments WHERE id=$1 AND project_id=$2`, [req.params.experimentId, req.params.id]);
    if (!source.rowCount) return res.status(404).json({ error: 'Experiment not found' });
    const original = source.rows[0];
    const result = await pool.query(`INSERT INTO project_experiments(project_id,title,status,hypothesis,procedure,observations,result,conclusion,performed_by)
      VALUES($1,$2,'planned',$3,$4,'','','',$5) RETURNING *`, [req.params.id, `${original.title} (repeat)`, original.hypothesis || '', original.procedure || '', req.user.userId]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'project_experiment', entityId: result.rows[0].id, newValue: result.rows[0], metadata: { project_id: req.params.id, repeated_from: req.params.experimentId } });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to repeat experiment' });
  }
});

router.delete('/:id/experiments/:experimentId', requireProjectEditor, async(req,res)=>{try{const r=await pool.query('DELETE FROM project_experiments WHERE id=$1 AND project_id=$2 RETURNING id',[req.params.experimentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Experiment not found'});await writeAuditLog({req,action:'DELETE',entityType:'project_experiment',entityId:req.params.experimentId,metadata:{project_id:req.params.id}});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to delete experiment'});}});

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
router.post('/:id/tasks/:taskId/experiments', requireProjectEditor, async (req,res)=>{
  const {experiment_id,relationship='related'}=req.body||{};
  if(!experiment_id||!['related','drives','validates','blocked_by'].includes(relationship)) return res.status(400).json({error:'experiment_id and valid relationship are required'});
  try {
    const check=await pool.query(`SELECT 1 FROM project_tasks t JOIN project_experiments e ON e.project_id=t.project_id WHERE t.id=$1 AND e.id=$2 AND t.project_id=$3`,[req.params.taskId,experiment_id,req.params.id]);
    if(!check.rowCount)return res.status(404).json({error:'Task or experiment not found in project'});
    const r=await pool.query(`INSERT INTO project_task_experiments(task_id,experiment_id,relationship,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(task_id,experiment_id) DO UPDATE SET relationship=EXCLUDED.relationship RETURNING *`,[req.params.taskId,experiment_id,relationship,req.user.userId]);
    await writeAuditLog({req,action:'UPDATE',entityType:'project_task_experiment',entityId:req.params.taskId,newValue:r.rows[0],metadata:{project_id:req.params.id,experiment_id}});
    res.status(201).json(r.rows[0]);
  }catch(err){console.error(err);res.status(500).json({error:'Failed to link experiment'});}
});
router.delete('/:id/tasks/:taskId/experiments/:experimentId', requireProjectEditor, async(req,res)=>{
  try{const r=await pool.query('DELETE FROM project_task_experiments te USING project_tasks t WHERE te.task_id=t.id AND te.task_id=$1 AND te.experiment_id=$2 AND t.project_id=$3 RETURNING te.task_id',[req.params.taskId,req.params.experimentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Task experiment link not found'});await writeAuditLog({req,action:'DELETE',entityType:'project_task_experiment',entityId:req.params.taskId,metadata:{project_id:req.params.id,experiment_id:req.params.experimentId}});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to unlink experiment'});}
});

router.get('/:id/experiments/:experimentId/measurements', requireProjectAccess, async(req,res)=>{
  try{const r=await pool.query(`SELECT m.*,u.username AS recorder_username FROM project_experiment_measurements m LEFT JOIN users u ON u.id=m.recorded_by WHERE m.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=m.experiment_id AND e.project_id=$2) ORDER BY m.observed_at NULLS LAST,m.created_at`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch measurements'});}
});
router.post('/:id/experiments/:experimentId/measurements', requireProjectEditor, async(req,res)=>{
  const {name,value_numeric=null,value_text=null,unit='',uncertainty=null,observed_at=null,recorded_by=null,notes=''}=req.body||{};
  if(!String(name||'').trim() || (value_numeric==null && value_text==null))return res.status(400).json({error:'name and a numeric or text value are required'});
  try{const check=await pool.query('SELECT 1 FROM project_experiments WHERE id=$1 AND project_id=$2',[req.params.experimentId,req.params.id]);if(!check.rowCount)return res.status(404).json({error:'Experiment not found'});const r=await pool.query(`INSERT INTO project_experiment_measurements(experiment_id,name,value_numeric,value_text,unit,uncertainty,observed_at,recorded_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.params.experimentId,String(name).trim(),value_numeric,value_text,unit,uncertainty,observed_at,recorded_by||req.user.userId,notes]);await writeAuditLog({req,action:'CREATE',entityType:'experiment_measurement',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id:req.params.id,experiment_id:req.params.experimentId}});res.status(201).json(r.rows[0]);}catch(err){console.error(err);res.status(500).json({error:'Failed to create measurement'});}
});
router.patch('/:id/experiments/:experimentId/measurements/:measurementId', requireProjectEditor, async(req,res)=>{
  const allowed=['name','value_numeric','value_text','unit','uncertainty','observed_at','recorded_by','notes'];const updates=[],values=[];for(const f of allowed)if(f in req.body){values.push(req.body[f]);updates.push(`${f}=$${values.length}`);}if(!updates.length)return res.status(400).json({error:'No valid fields to update'});values.push(req.params.measurementId,req.params.experimentId,req.params.id);try{const r=await pool.query(`UPDATE project_experiment_measurements m SET ${updates.join(',')} WHERE m.id=$${values.length-2} AND m.experiment_id=$${values.length-1} AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=m.experiment_id AND e.project_id=$${values.length}) RETURNING m.*`,values);if(!r.rowCount)return res.status(404).json({error:'Measurement not found'});res.json(r.rows[0]);}catch(err){res.status(500).json({error:'Failed to update measurement'});}
});
router.delete('/:id/experiments/:experimentId/measurements/:measurementId', requireProjectEditor, async(req,res)=>{try{const r=await pool.query(`DELETE FROM project_experiment_measurements m WHERE m.id=$1 AND m.experiment_id=$2 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=m.experiment_id AND e.project_id=$3) RETURNING m.id`,[req.params.measurementId,req.params.experimentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Measurement not found'});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to delete measurement'});}});

router.get('/:id/experiments/:experimentId/observations', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT o.*,u.username AS recorder_username FROM project_experiment_observations o LEFT JOIN users u ON u.id=o.recorded_by WHERE o.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=o.experiment_id AND e.project_id=$2) ORDER BY o.observed_at NULLS LAST,o.created_at`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch observations'});}});
router.post('/:id/experiments/:experimentId/observations', requireProjectEditor, async(req,res)=>{const {kind='observation',content,observed_at=null,recorded_by=null}=req.body||{};if(!String(content||'').trim())return res.status(400).json({error:'content is required'});try{const check=await pool.query('SELECT 1 FROM project_experiments WHERE id=$1 AND project_id=$2',[req.params.experimentId,req.params.id]);if(!check.rowCount)return res.status(404).json({error:'Experiment not found'});const r=await pool.query(`INSERT INTO project_experiment_observations(experiment_id,kind,content,observed_at,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.params.experimentId,kind,String(content).trim(),observed_at,recorded_by||req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'experiment_observation',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id:req.params.id,experiment_id:req.params.experimentId}});res.status(201).json(r.rows[0]);}catch(err){console.error(err);res.status(500).json({error:'Failed to create observation'});}});
router.delete('/:id/experiments/:experimentId/observations/:observationId', requireProjectEditor, async(req,res)=>{try{const r=await pool.query(`DELETE FROM project_experiment_observations o WHERE o.id=$1 AND o.experiment_id=$2 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=o.experiment_id AND e.project_id=$3) RETURNING o.id`,[req.params.observationId,req.params.experimentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Observation not found'});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to delete observation'});}});


router.get('/:id/tasks/:taskId/attachments', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT a.*,r.name,r.original_filename,r.kind,r.file_type FROM project_work_attachments a JOIN resources r ON r.id=a.resource_id WHERE a.task_id=$1 AND EXISTS(SELECT 1 FROM project_tasks t WHERE t.id=a.task_id AND t.project_id=$2) ORDER BY a.created_at DESC`,[req.params.taskId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch task attachments'});}});
router.post('/:id/tasks/:taskId/attachments', requireProjectEditor, async(req,res)=>{const {resource_id}=req.body||{};if(!resource_id)return res.status(400).json({error:'resource_id is required'});try{const check=await pool.query(`SELECT 1 FROM project_tasks t JOIN resources r ON r.project_id=t.project_id WHERE t.id=$1 AND r.id=$2 AND t.project_id=$3`,[req.params.taskId,resource_id,req.params.id]);if(!check.rowCount)return res.status(404).json({error:'Task or project resource not found'});const r=await pool.query(`INSERT INTO project_work_attachments(task_id,resource_id,added_by) VALUES($1,$2,$3) ON CONFLICT(task_id,resource_id) DO UPDATE SET added_by=EXCLUDED.added_by RETURNING *`,[req.params.taskId,resource_id,req.user.userId]);res.status(201).json(r.rows[0]);}catch(err){res.status(500).json({error:'Failed to attach resource'});}});
router.delete('/:id/tasks/:taskId/attachments/:attachmentId', requireProjectEditor, async(req,res)=>{try{const r=await pool.query(`DELETE FROM project_work_attachments a USING project_tasks t WHERE a.id=$1 AND a.task_id=t.id AND t.project_id=$2 RETURNING a.id`,[req.params.attachmentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Attachment not found'});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to remove attachment'});}});
router.get('/:id/experiments/:experimentId/attachments', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT a.*,r.name,r.original_filename,r.kind,r.file_type FROM project_work_attachments a JOIN resources r ON r.id=a.resource_id WHERE a.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=a.experiment_id AND e.project_id=$2) ORDER BY a.created_at DESC`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch experiment attachments'});}});
router.post('/:id/experiments/:experimentId/attachments', requireProjectEditor, async(req,res)=>{const {resource_id}=req.body||{};if(!resource_id)return res.status(400).json({error:'resource_id is required'});try{const check=await pool.query(`SELECT 1 FROM project_experiments e JOIN resources r ON r.project_id=e.project_id WHERE e.id=$1 AND r.id=$2 AND e.project_id=$3`,[req.params.experimentId,resource_id,req.params.id]);if(!check.rowCount)return res.status(404).json({error:'Experiment or project resource not found'});const r=await pool.query(`INSERT INTO project_work_attachments(experiment_id,resource_id,added_by) VALUES($1,$2,$3) ON CONFLICT(experiment_id,resource_id) DO UPDATE SET added_by=EXCLUDED.added_by RETURNING *`,[req.params.experimentId,resource_id,req.user.userId]);res.status(201).json(r.rows[0]);}catch(err){res.status(500).json({error:'Failed to attach resource'});}});
router.delete('/:id/experiments/:experimentId/attachments/:attachmentId', requireProjectEditor, async(req,res)=>{try{const r=await pool.query(`DELETE FROM project_work_attachments a USING project_experiments e WHERE a.id=$1 AND a.experiment_id=e.id AND e.project_id=$2 RETURNING a.id`,[req.params.attachmentId,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Attachment not found'});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to remove attachment'});}});

router.get('/:id/experiments/:experimentId/revisions', requireProjectAccess, async(req,res)=>{try{const r=await pool.query(`SELECT r.*,u.username AS actor_username FROM project_experiment_revisions r LEFT JOIN users u ON u.id=r.actor_id WHERE r.experiment_id=$1 AND EXISTS(SELECT 1 FROM project_experiments e WHERE e.id=r.experiment_id AND e.project_id=$2) ORDER BY r.revision_no DESC`,[req.params.experimentId,req.params.id]);res.json(r.rows);}catch(err){res.status(500).json({error:'Failed to fetch experiment revisions'});}});

router.post('/:id/items', requireProjectEditor, async(req,res)=>{const {item_id,allocated_quantity=0,notes=''}=req.body;if(!item_id)return res.status(400).json({error:'item_id is required'});if(Number(allocated_quantity)<0)return res.status(400).json({error:'allocated_quantity cannot be negative'});
  try{if(!(await projectExists(req.params.id)))return res.status(404).json({error:'Project not found'}); const r=await pool.query(`INSERT INTO project_items(project_id,item_id,allocated_quantity,notes,added_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,item_id) DO UPDATE SET allocated_quantity=EXCLUDED.allocated_quantity,notes=EXCLUDED.notes RETURNING *`,[req.params.id,item_id,allocated_quantity,notes,req.user?.userId||null]);
    await writeAuditLog({req,action:'UPDATE',entityType:'project_item',entityId:item_id,newValue:r.rows[0],metadata:{project_id:req.params.id}});res.status(201).json(r.rows[0]);
  }catch(err){console.error(err);if(err.code==='23503')return res.status(400).json({error:'Item or project does not exist'});res.status(500).json({error:'Failed to link inventory item'});}
});
router.delete('/:id/items/:itemId',requireProjectEditor,async(req,res)=>{try{const r=await pool.query('DELETE FROM project_items WHERE project_id=$1 AND item_id=$2 RETURNING item_id',[req.params.id,req.params.itemId]);if(!r.rowCount)return res.status(404).json({error:'Project inventory item not found'});await writeAuditLog({req,action:'DELETE',entityType:'project_item',entityId:req.params.itemId,metadata:{project_id:req.params.id}});res.status(204).send();}catch(err){res.status(500).json({error:'Failed to unlink inventory item'});}});

router.get('/:id/bom', requireProjectAccess, async (req, res) => {
  try {
    const result = await pool.query(`SELECT b.*, pi.name AS preferred_item_name, pi.current_quantity AS preferred_item_quantity,
      ai.name AS alternative_item_name, ai.current_quantity AS alternative_item_quantity
      FROM project_bom_items b LEFT JOIN items pi ON pi.id=b.preferred_item_id LEFT JOIN items ai ON ai.id=b.alternative_item_id
      WHERE b.project_id=$1 ORDER BY b.created_at`, [req.params.id]);
    res.json(result.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch project BOM' }); }
});

router.post('/:id/bom', requireProjectEditor, async (req, res) => {
  const { name, part_number = null, required_quantity = 1, unit = null, preferred_item_id = null, alternative_item_id = null, notes = '' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
  if (!Number.isFinite(Number(required_quantity)) || Number(required_quantity) <= 0) return res.status(400).json({ error: 'required_quantity must be greater than zero' });
  try {
    const result = await pool.query(`INSERT INTO project_bom_items(project_id,name,part_number,required_quantity,unit,preferred_item_id,alternative_item_id,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.params.id, String(name).trim(), part_number, required_quantity, unit, preferred_item_id, alternative_item_id, notes, req.user.userId]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'project_bom_item', entityId: result.rows[0].id, newValue: result.rows[0], metadata: { project_id: req.params.id } });
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create BOM item' }); }
});

router.patch('/:id/bom/:bomId', requireProjectEditor, async (req, res) => {
  const allowed = ['name','part_number','required_quantity','unit','preferred_item_id','alternative_item_id','notes'];
  const updates = []; const values = [];
  for (const field of allowed) if (field in req.body) { values.push(req.body[field] === '' ? null : req.body[field]); updates.push(`${field}=$${values.length}`); }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
  values.push(req.params.bomId, req.params.id);
  try { const result = await pool.query(`UPDATE project_bom_items SET ${updates.join(',')}, updated_at=now() WHERE id=$${values.length-1} AND project_id=$${values.length} RETURNING *`, values); if (!result.rowCount) return res.status(404).json({ error: 'BOM item not found' }); await writeAuditLog({ req, action:'UPDATE', entityType:'project_bom_item', entityId:req.params.bomId, newValue:result.rows[0], metadata:{project_id:req.params.id} }); res.json(result.rows[0]); } catch (err) { console.error(err); res.status(500).json({ error:'Failed to update BOM item' }); }
});

router.delete('/:id/bom/:bomId', requireProjectEditor, async (req, res) => {
  try { const result = await pool.query('DELETE FROM project_bom_items WHERE id=$1 AND project_id=$2 RETURNING id', [req.params.bomId, req.params.id]); if (!result.rowCount) return res.status(404).json({ error:'BOM item not found' }); await writeAuditLog({ req, action:'DELETE', entityType:'project_bom_item', entityId:req.params.bomId, metadata:{project_id:req.params.id} }); res.status(204).send(); } catch (err) { res.status(500).json({ error:'Failed to delete BOM item' }); }
});

export default router;
