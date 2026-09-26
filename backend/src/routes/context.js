import {Router} from 'express';
import {pool} from '../db.js';
import {getProjectAccess} from '../middleware/project-access.js';
import {hasPermission} from '../middleware/permissions.js';

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Context is an explicitly bounded, permission-checked snapshot, not an authorization token.
// Every section is independently sourced; no AI-generated values are stored here.
export async function assembleProjectContext(projectId,user,db=pool){
 const access=await getProjectAccess(projectId,user);
 if(access.access==='none')return null;
 const project=await db.query('SELECT id,name,status,description,priority,start_date,due_date,updated_at FROM projects WHERE id=$1',[projectId]);
 if(!project.rowCount)return null;
 const [experiments,tasks,inventory,reservations,notes,resources]=await Promise.all([
  db.query('SELECT id,title,status,updated_at FROM project_experiments WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 40',[projectId]),
  db.query('SELECT id,title,status,due_date FROM project_tasks WHERE project_id=$1 ORDER BY due_date NULLS LAST LIMIT 40',[projectId]),
  db.query(`SELECT pi.item_id,i.name,i.type,i.unit,i.status,i.current_quantity FROM project_items pi JOIN items i ON i.id=pi.item_id WHERE pi.project_id=$1 ORDER BY i.name LIMIT 60`,[projectId]),
  db.query(`SELECT r.id,r.item_id,i.name AS item_name,r.quantity,r.status,r.needed_from,r.needed_until FROM project_reservations r JOIN items i ON i.id=r.item_id WHERE r.project_id=$1 ORDER BY r.created_at DESC LIMIT 60`,[projectId]),
  db.query('SELECT id,title,updated_at FROM notes WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 40',[projectId]),
  db.query('SELECT id,name,kind,updated_at FROM resources WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 40',[projectId])
 ]);
 return {schema_version:1,scope:{type:'project',id:projectId},generated_at:new Date().toISOString(),freshness:'central_live',access:access.access,
  project:project.rows[0],sections:{experiments:experiments.rows,tasks:tasks.rows,inventory:inventory.rows,reservations:reservations.rows,notes:notes.rows,resources:resources.rows},
  provenance:{authority:'central_postgresql',source:'labos_project_context',limits:{per_section:60},truncated:{experiments:experiments.rowCount===40,tasks:tasks.rowCount===40,inventory:inventory.rowCount===60,reservations:reservations.rowCount===60,notes:notes.rowCount===40,resources:resources.rowCount===40}}};
}
router.get('/projects/:id',hasPermission('projects.view'),async(req,res)=>{
 if(!uuid.test(req.params.id))return res.status(400).json({error:{code:'INVALID_PROJECT_ID',message:'Valid project UUID required'}});
 try{
  const result=await assembleProjectContext(req.params.id,req.user);
  if(!result)return res.status(404).json({error:{code:'PROJECT_NOT_FOUND',message:'Project not found'}});
  res.setHeader('Cache-Control','private, no-store');
  res.json(result);
 }catch(err){console.error('Context assembly failed',err);res.status(500).json({error:{code:'CONTEXT_UNAVAILABLE',message:'Project context unavailable'}});}
});
export default router;
