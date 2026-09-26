import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission, getUserPermissions } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getProjectAccess, requireProjectEditor } from '../middleware/project-access.js';

const router = Router();
router.get('/', hasPermission('projects.view'), async (req, res) => { try { const values=[];const visibility=req.user.role==='admin'?'':`WHERE p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_members visible_pm WHERE visible_pm.project_id=p.id AND visible_pm.user_id=$1)`;if(req.user.role!=='admin')values.push(req.user.userId);const result=await pool.query(`SELECT p.*,COALESCE(pfs.actual_expense,0)::float AS total_spent,COALESCE(pfs.actual_expense,0)::float AS actual_expense,COALESCE(pfs.project_income,0)::float AS project_income,COALESCE(pfs.allocated_inventory_value,0)::float AS allocated_inventory_value,CASE WHEN p.budget IS NULL THEN NULL ELSE (p.budget-COALESCE(pfs.actual_expense,0))::float END AS budget_remaining FROM projects p LEFT JOIN project_financial_summary pfs ON pfs.project_id=p.id ${visibility} ORDER BY p.created_at DESC`,values);const permissions=await getUserPermissions(req.user.userId,req.user.role);if(permissions.has('finance.view'))return res.json(result.rows);res.json(result.rows.map(({total_spent,actual_expense,project_income,allocated_inventory_value,budget_remaining,...project})=>project));}catch(err){console.error(err);res.status(500).json({error:err.message||'Failed to fetch projects'});} });
router.get('/financial-summary', hasPermission('projects.view'), hasPermission('finance.view'), async (req,res)=>{ try{const values=[];const visibility=req.user.role==='admin'?'':`WHERE pfs.project_id IN (SELECT p.id FROM projects p WHERE p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_members visible_pm WHERE visible_pm.project_id=p.id AND visible_pm.user_id=$1))`;if(req.user.role!=='admin')values.push(req.user.userId);const result=await pool.query(`SELECT pfs.*,CASE WHEN pfs.budget IS NULL THEN NULL ELSE (pfs.budget-pfs.actual_expense)::float END AS budget_remaining,CASE WHEN pfs.budget IS NULL OR pfs.budget=0 THEN NULL ELSE ROUND((pfs.actual_expense/pfs.budget*100)::numeric,1)::float END AS budget_used_percent FROM project_financial_summary pfs ${visibility} ORDER BY pfs.actual_expense DESC,pfs.name`,values);res.json(result.rows);}catch(err){console.error(err);res.status(500).json({error:'Failed to fetch project financial summary'});} });
// Planning review decisions are online-only and serialized per project.
// Central reservation ledger: proposed demand never reduces availability.
router.get('/:id/reservations',hasPermission('projects.view'),async(req,res)=>{
 try{
  const access=await getProjectAccess(req.params.id,req.user);
  if(access.access==='none')return res.status(404).json({error:'Project not found'});
  const rows=await pool.query(`SELECT r.*,i.name AS item_name,p.priority AS project_priority,p.start_date AS project_start_date,p.due_date AS project_due_date
    FROM project_reservations r JOIN items i ON i.id=r.item_id JOIN projects p ON p.id=r.project_id
    WHERE r.project_id=$1 ORDER BY r.created_at DESC`,[req.params.id]);
  res.json(rows.rows);
 }catch(err){console.error(err);res.status(500).json({error:'Unable to load reservations'});}
});
router.post('/:id/reservations',hasPermission('projects.edit'),async(req,res)=>{
 const access=await getProjectAccess(req.params.id,req.user);
 if(access.access==='none'||access.access==='view'||(access.access!=='admin'&&access.memberRole!=='lead'))return res.status(403).json({error:'Only a project lead or admin can request reservations'});
 const {item_id,quantity,needed_from,needed_until,note}=req.body||{};
 if(!/^[0-9a-f-]{36}$/i.test(String(item_id||''))||!Number.isFinite(Number(quantity))||Number(quantity)<=0||!needed_from||!Number.isFinite(Date.parse(needed_from))||(needed_until&&(!Number.isFinite(Date.parse(needed_until))||Date.parse(needed_until)<=Date.parse(needed_from))))return res.status(400).json({error:'Valid item, positive quantity and usage dates are required'});
 if(note&&String(note).length>2000)return res.status(400).json({error:'Note too long'});
 try{
  const project=await pool.query('SELECT id,status FROM projects WHERE id=$1',[req.params.id]);
  if(!project.rowCount)return res.status(404).json({error:'Project not found'});
  if(!['planning','active'].includes(project.rows[0].status))return res.status(409).json({error:'Project must be Planning or Active'});
  const item=await pool.query('SELECT id FROM items WHERE id=$1',[item_id]);
  if(!item.rowCount)return res.status(404).json({error:'Inventory item not found'});
  const result=await pool.query(`INSERT INTO project_reservations(project_id,item_id,requested_by,quantity,needed_from,needed_until,note,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,'pending_review') RETURNING *`,[req.params.id,item_id,req.user.userId,quantity,needed_from,needed_until||null,note||null]);
  await writeAuditLog({req,action:'CREATE',entityType:'project_reservation',entityId:result.rows[0].id,newValue:result.rows[0]});
  res.status(201).json(result.rows[0]);
 }catch(err){console.error(err);res.status(500).json({error:'Unable to request reservation'});}
});
router.post('/:id/reservations/:reservationId/decision',hasPermission('projects.edit'),async(req,res)=>{
 if(req.user.role!=='admin')return res.status(403).json({error:'Admin approval required'});
 const {decision,review_note}=req.body||{};
 if(!['confirm','reject','release'].includes(decision)||String(review_note||'').length>2000)return res.status(400).json({error:'Invalid decision or review note'});
 if(decision==='reject'&&!String(review_note||'').trim())return res.status(400).json({error:'Rejection reason required'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const request=await client.query('SELECT * FROM project_reservations WHERE id=$1 AND project_id=$2 FOR UPDATE',[req.params.reservationId,req.params.id]);
  if(!request.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Reservation not found'});}
  const reservation=request.rows[0];
  if(decision==='release'?reservation.status!=='confirmed':reservation.status!=='pending_review'){await client.query('ROLLBACK');return res.status(409).json({error:'Reservation state does not permit this decision'});}
  if(decision==='confirm'){
   // Serialize all approvals for the same item, including overlapping equipment bookings.
   const stock=await client.query('SELECT id,current_quantity,type,status FROM items WHERE id=$1 FOR UPDATE',[reservation.item_id]);
   if(!stock.rowCount||!['available','low_stock'].includes(stock.rows[0].status)){await client.query('ROLLBACK');return res.status(409).json({error:'Item unavailable for reservation'});}
   const allocated=await client.query(`SELECT COALESCE(SUM(quantity),0)::numeric AS total FROM project_reservations
     WHERE item_id=$1 AND status='confirmed' AND id<>$2 AND (needed_until IS NULL OR needed_until>$3) AND ($4::timestamptz IS NULL OR needed_from<$4)`,[reservation.item_id,reservation.id,reservation.needed_from,reservation.needed_until]);
   const available=Number(stock.rows[0].current_quantity)-Number(allocated.rows[0].total);
   if(available<Number(reservation.quantity)){await client.query('ROLLBACK');return res.status(409).json({error:{code:'RESERVATION_CONFLICT',message:'Insufficient unreserved stock during requested period',available,requested:Number(reservation.quantity)}});}
  }
  const status=decision==='confirm'?'confirmed':decision==='reject'?'rejected':'released';
  const updated=await client.query('UPDATE project_reservations SET status=$1,reviewed_by=$2,review_note=$3,reviewed_at=now(),updated_at=now() WHERE id=$4 RETURNING *',[status,req.user.userId,review_note||null,reservation.id]);
  await client.query('COMMIT');
  await writeAuditLog({req,action:'UPDATE',entityType:'project_reservation',entityId:reservation.id,newValue:{decision,status,review_note:review_note||null}});
  res.json(updated.rows[0]);
 }catch(err){await client.query('ROLLBACK');console.error(err);res.status(500).json({error:'Unable to decide reservation'});}finally{client.release();}
});
router.get('/:id/review',hasPermission('projects.view'),async(req,res)=>{
 try{
  const access=await getProjectAccess(req.params.id,req.user);
  if(access.access==='none')return res.status(404).json({error:'Project not found'});
  const [project,events]=await Promise.all([
   pool.query('SELECT id,status,review_status,priority,start_date,due_date FROM projects WHERE id=$1',[req.params.id]),
   pool.query('SELECT e.id,e.decision,e.note,e.created_at,u.username AS actor FROM project_review_events e JOIN users u ON u.id=e.actor_id WHERE e.project_id=$1 ORDER BY e.created_at DESC',[req.params.id])
  ]);
  if(!project.rowCount)return res.status(404).json({error:'Project not found'});
  res.json({project:project.rows[0],events:events.rows});
 }catch(err){console.error(err);res.status(500).json({error:'Unable to load project review'});}
});
router.post('/:id/review',hasPermission('projects.edit'),async(req,res)=>{
 const decision=req.body?.decision,note=typeof req.body?.note==='string'?req.body.note.trim():'';
 if(!['submit','request_changes','approve'].includes(decision))return res.status(400).json({error:'Invalid review decision'});
 if(note.length>2000)return res.status(400).json({error:'Review note is too long'});
 if(decision==='request_changes'&&!note)return res.status(400).json({error:'Explain the requested changes'});
 const access=await getProjectAccess(req.params.id,req.user);
 if(access.access==='none'||access.access==='view')return res.status(403).json({error:'Project editor access required'});
 if(decision==='submit'&&access.access!=='admin'&&access.memberRole!=='lead')return res.status(403).json({error:'Only the project lead or an admin can submit a plan'});
 if(decision!=='submit'&&req.user.role!=='admin')return res.status(403).json({error:'Admin approval required'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const found=await client.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!found.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Project not found'});}
  const project=found.rows[0];
  if(project.status!=='planning'){await client.query('ROLLBACK');return res.status(409).json({error:'Only Planning projects can be reviewed'});}
  if(decision==='submit'&&!['draft','changes_requested'].includes(project.review_status)){await client.query('ROLLBACK');return res.status(409).json({error:'Plan is already submitted or approved'});}
  if(decision!=='submit'&&project.review_status!=='submitted'){await client.query('ROLLBACK');return res.status(409).json({error:'Submit the plan before an admin decision'});}
  const next=decision==='submit'?'submitted':decision==='approve'?'approved':'changes_requested';
  const updated=await client.query('UPDATE projects SET review_status=$1,status=CASE WHEN $2=\'approve\' THEN \'active\' ELSE status END,updated_at=now() WHERE id=$3 RETURNING *',[next,decision,req.params.id]);
  await client.query('INSERT INTO project_review_events(project_id,actor_id,decision,note) VALUES($1,$2,$3,$4)',[req.params.id,req.user.userId,decision,note||null]);
  await client.query('COMMIT');
  await writeAuditLog({req,action:'UPDATE',entityType:'project',entityId:req.params.id,newValue:{review_decision:decision,review_status:next,status:updated.rows[0].status}});
  res.json(updated.rows[0]);
 }catch(err){await client.query('ROLLBACK');console.error(err);res.status(500).json({error:'Unable to record project review'});}finally{client.release();}
});
router.get('/:id', hasPermission('projects.view'), async (req,res)=>{try{const access=await getProjectAccess(req.params.id,req.user);if(access.access==='none')return res.status(404).json({error:'Project not found'});const project=await pool.query('SELECT * FROM projects WHERE id=$1',[req.params.id]);if(!project.rowCount)return res.status(404).json({error:'Project not found'});const response={...project.rows[0]};const permissions=await getUserPermissions(req.user.userId,req.user.role);if(permissions.has('finance.view')){const [transactions,finance]=await Promise.all([pool.query('SELECT t.*,bp.label AS budget_period_label FROM transactions t LEFT JOIN budget_periods bp ON bp.id=t.budget_period_id WHERE t.project_id=$1 ORDER BY t.date DESC,t.created_at DESC',[req.params.id]),pool.query('SELECT * FROM project_financial_summary WHERE project_id=$1',[req.params.id])]);response.transactions=transactions.rows;response.financials=finance.rows[0]||null;}res.json(response);}catch(err){console.error(err);res.status(500).json({error:err.message||'Failed to fetch project'});} });
router.post('/',hasPermission('projects.create'),async(req,res)=>{const{name,status,budget,description='',priority='normal',start_date=null,due_date=null}=req.body;if(!name)return res.status(400).json({error:'name is required'});if(status&&!['planning','active','completed','on_hold','cancelled'].includes(status))return res.status(400).json({error:'Invalid project status'});if(status&&status!=='planning'&&req.user.role!=='admin')return res.status(403).json({error:{code:'PROJECT_ACTIVATION_REQUIRES_ADMIN',message:'New projects must begin in Planning. An admin must authorize other initial statuses.'}});try{const result=await pool.query(`INSERT INTO projects (name,status,budget,description,priority,start_date,due_date,owner_id) VALUES ($1,COALESCE($2,'planning'),$3,$4,$5,$6,$7,$8) RETURNING *`,[name,status??null,budget??null,description,priority,start_date,due_date,req.user?.userId||null]);if(req.user?.userId)await pool.query(`INSERT INTO project_members (project_id,user_id,member_role) VALUES ($1,$2,'lead') ON CONFLICT DO NOTHING`,[result.rows[0].id,req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'project',entityId:result.rows[0].id,newValue:result.rows[0]});res.status(201).json(result.rows[0]);}catch(err){console.error(err);res.status(500).json({error:err.message||'Failed to create project'});} });
router.put('/:id',hasPermission('projects.edit'),requireProjectEditor,async(req,res)=>{const fields=['name','status','budget','description','priority','start_date','due_date'];const updates=[];const values=[];for(const field of fields)if(field in req.body){values.push(req.body[field]);updates.push(`${field}=$${values.length}`);}if('owner_id'in req.body){const permissions=req.permissions||await getUserPermissions(req.user.userId,req.user.role);if(!permissions.has('projects.manage_owner'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: projects.manage_owner',permission:'projects.manage_owner'}});if(req.body.owner_id){const owner=await pool.query('SELECT id FROM users WHERE id=$1 AND is_active=TRUE',[req.body.owner_id]);if(!owner.rowCount)return res.status(400).json({error:'owner_id must reference an active user'});}values.push(req.body.owner_id||null);updates.push(`owner_id=$${values.length}`);}if(!updates.length)return res.status(400).json({error:'No valid fields to update'});if('name'in req.body&&!String(req.body.name||'').trim())return res.status(400).json({error:'name cannot be empty'});if('status'in req.body&&!['planning','active','completed','on_hold','cancelled'].includes(req.body.status))return res.status(400).json({error:'Invalid project status'});if('status'in req.body&&req.body.status==='active'&&req.user.role!=='admin')return res.status(403).json({error:{code:'PROJECT_ACTIVATION_REQUIRES_ADMIN',message:'Only admins can activate projects'}});if('priority'in req.body&&!['low','normal','high','critical'].includes(req.body.priority))return res.status(400).json({error:'Invalid project priority'});values.push(req.params.id);try{if(req.body.status==='active'){const current=await pool.query('SELECT status FROM projects WHERE id=$1',[req.params.id]);if(current.rows[0]?.status==='planning')return res.status(409).json({error:'Submit the plan for admin approval using the project review workflow'});}const result=await pool.query(`UPDATE projects SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,values);if(!result.rowCount)return res.status(404).json({error:'Project not found'});await writeAuditLog({req,action:'UPDATE',entityType:'project',entityId:req.params.id,newValue:result.rows[0]});res.json(result.rows[0]);}catch(err){console.error(err);res.status(500).json({error:err.message||'Failed to update project'});} });
router.delete('/:id',hasPermission('projects.delete'),requireProjectEditor,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const project=await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[req.params.id]);if(!project.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Project not found'});}const nested=[['project_task','SELECT id FROM project_tasks WHERE project_id=$1'],['project_experiment','SELECT id FROM project_experiments WHERE project_id=$1'],['project_bom','SELECT id FROM project_bom_items WHERE project_id=$1'],['project_block','SELECT id FROM project_blocks WHERE project_id=$1'],['project_connector','SELECT id FROM project_connectors WHERE project_id=$1'],['project_experiment_measurement','SELECT m.id FROM project_experiment_measurements m JOIN project_experiments e ON e.id=m.experiment_id WHERE e.project_id=$1'],['project_experiment_observation','SELECT o.id FROM project_experiment_observations o JOIN project_experiments e ON e.id=o.experiment_id WHERE e.project_id=$1'],['project_task_experiment','SELECT id FROM project_task_experiments WHERE project_id=$1'],['project_work_attachment','SELECT a.id FROM project_work_attachments a LEFT JOIN project_tasks t ON t.id=a.task_id LEFT JOIN project_experiments e ON e.id=a.experiment_id WHERE t.project_id=$1 OR e.project_id=$1'],['project_resource_requirement','SELECT id FROM project_resource_requirements WHERE project_id=$1'],['project_item','SELECT item_id AS id FROM project_items WHERE project_id=$1'],['engineering_calculation','SELECT id FROM engineering_calculations WHERE project_id=$1'],['engineering_test','SELECT id FROM engineering_tests WHERE project_id=$1']];for(const [entityType,query] of nested){const rows=await client.query(query,[req.params.id]);for(const row of rows.rows)await client.query('INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id',[entityType,row.id,req.params.id]);}const resources=await client.query('WITH RECURSIVE tree AS (SELECT id,project_id,item_id,note_id FROM resources WHERE project_id=$1 UNION ALL SELECT r.id,r.project_id,r.item_id,r.note_id FROM resources r JOIN tree t ON r.parent_resource_id=t.id) SELECT id,project_id,item_id,note_id FROM tree',[req.params.id]);for(const row of resources.rows)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id,item_id=EXCLUDED.item_id,note_id=EXCLUDED.note_id",[row.id,row.project_id||req.params.id,row.item_id||null,row.note_id||null]);await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('project',$1,$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[req.params.id]);await client.query('DELETE FROM projects WHERE id=$1',[req.params.id]);await client.query('COMMIT');await writeAuditLog({req,action:'DELETE',entityType:'project',entityId:req.params.id,metadata:{project_id:req.params.id}});res.status(204).send();}catch(err){await client.query('ROLLBACK').catch(()=>{});console.error(err);res.status(500).json({error:err.message||'Failed to delete project'});}finally{client.release();}});
export default router;
