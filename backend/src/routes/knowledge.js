import { Router } from 'express';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { visibilityReadSql, canEditRestrictedEntity } from '../middleware/visibility.js';
import { getResourceAccess } from '../middleware/resource-access.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { canReadRelationshipEndpoint, canReadKnowledgeRelationship } from '../middleware/knowledge-relationship-access.js';

const router = Router();
const noteOverviewVisibility = visibilityReadSql({ alias: 'n', entityType: 'note', userIdParameter: '$1', roleParameter: '$2' });
const projectFilter = (alias) => visibilityReadSql({
  alias,
  entityType: { f: 'finding', r: 'result', c: 'engineering_calculation' }[alias],
  roleParameter: '$1',
  userIdParameter: '$2',
});
const ensureProject = async (projectId, userId, role) => { if (!projectId) return true; const access=await getProjectAccess(projectId,{userId,role});return access.access==='edit'||access.access==='admin'; };
async function canEditKnowledgeRecord(row,entityType,user){
  if(!(await ensureProject(row.project_id,user.userId,user.role)))return false;
  return row.visibility!=='restricted'||canEditRestrictedEntity({entityType,entityId:row.id,user});
}

async function visibleKnowledgeResources(user) {
  const result = await pool.query('SELECT id,name,kind,file_type,category,tags,updated_at,parent_resource_id FROM resources ORDER BY updated_at DESC');
  const visible = [];
  // Match the Resources list, including folder ancestors and attached Notes.
  for (let offset = 0; offset < result.rows.length; offset += 16) {
    const batch = result.rows.slice(offset, offset + 16);
    const access = await Promise.all(batch.map(row => getResourceAccess(row.id, user)));
    for (let i = 0; i < batch.length; i++) {
      if (access[i].access !== 'none' && !access[i].context?.invalid) visible.push(batch[i]);
    }
  }
  return visible;
}

async function canEditRelationshipProject(projectId,user) {
  if (!projectId) return true;
  const access=await getProjectAccess(projectId,user);
  return access.access==='edit'||access.access==='admin';
}

async function visibleKnowledgeRelationships(rows,user) {
  const visible=[];
  for (const row of rows) if (await canReadKnowledgeRelationship(row,user)) visible.push(row);
  return visible;
}

router.get('/overview', hasPermission('notes.view'), async (req,res) => {
  try {
    const params = [req.user.userId, req.user.role];
    const [notes, recentNotes, resources] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM notes n WHERE ${noteOverviewVisibility}`, params),
      pool.query(`SELECT n.id,n.title,n.tags,n.updated_at,n.author_id FROM notes n WHERE ${noteOverviewVisibility} ORDER BY n.updated_at DESC LIMIT 8`, params),
      visibleKnowledgeResources(req.user),
    ]);
    const counts = new Map();
    for (const row of resources) counts.set(row.category, (counts.get(row.category) || 0) + 1);
    const categories = [...counts].map(([category,count]) => ({category,count})).sort((a,b) => b.count-a.count || String(a.category).localeCompare(String(b.category)));
    res.setHeader('Cache-Control','no-store');
    res.json({ counts: { notes: notes.rows[0].count, resources: resources.length }, categories,
      recent_notes: recentNotes.rows,
      recent_resources: resources.filter(row => row.parent_resource_id === null).slice(0,8).map(({parent_resource_id,...row}) => row) });
  } catch(e) { console.error(e); res.status(500).json({error:'Failed to load knowledge overview'}); }
});
router.get('/tags', hasPermission('notes.view'), async (req,res) => {
  try {
    const [notes, resources] = await Promise.all([
      pool.query(`SELECT n.tags FROM notes n WHERE ${noteOverviewVisibility}`, [req.user.userId, req.user.role]),
      visibleKnowledgeResources(req.user),
    ]);
    const counts = new Map();
    for (const row of notes.rows) for (const tag of row.tags || []) {
      const count = counts.get(tag) || {note_count:0,resource_count:0}; count.note_count++; counts.set(tag,count);
    }
    for (const row of resources) for (const tag of row.tags || []) {
      const count = counts.get(tag) || {note_count:0,resource_count:0}; count.resource_count++; counts.set(tag,count);
    }
    res.json([...counts].map(([tag,count]) => ({tag,...count})).sort((a,b) => a.tag.localeCompare(b.tag)));
  } catch(e) { console.error(e); res.status(500).json({error:'Failed to load knowledge tags'}); }
});

router.get('/findings',hasPermission('projects.view'),async(req,res)=>{try{const q=String(req.query.q||'').trim();const r=await pool.query(`SELECT f.*,u.username AS creator_username,NULL::text AS experiment_title FROM lab_findings f LEFT JOIN users u ON u.id=f.created_by WHERE ${projectFilter('f')} AND ($3='' OR f.title ILIKE '%'||$3||'%' OR f.body ILIKE '%'||$3||'%') ORDER BY f.updated_at DESC LIMIT 200`,[req.user.role,req.user.userId,q]);res.json(r.rows);}catch(e){console.error(e);res.status(500).json({error:'Failed to fetch findings'});}});
router.post('/findings',hasPermission('projects.edit'),async(req,res)=>{const{project_id=null,experiment_id=null,title,body='',status='open',confidence=null,tags=[]}=req.body||{};if(!String(title||'').trim())return res.status(400).json({error:'title is required'});try{if(!(await ensureProject(project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const r=await pool.query(`INSERT INTO lab_findings(project_id,experiment_id,title,body,status,confidence,tags,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[project_id,experiment_id,String(title).trim(),String(body),status,confidence,tags,req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'finding',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id}});res.status(201).json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:'Failed to create finding'});}});
router.patch('/findings/:id',hasPermission('projects.edit'),async(req,res)=>{const allowed=['title','body','status','confidence','tags','experiment_id'];const keys=allowed.filter(k=>k in(req.body||{}));if(!keys.length)return res.status(400).json({error:'No valid fields to update'});try{const before=await pool.query('SELECT * FROM lab_findings WHERE id=$1',[req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Finding not found'});if(!(await canEditKnowledgeRecord(before.rows[0],'finding',req.user)))return res.status(403).json({error:'Finding edit access denied'});const vals=keys.map(k=>req.body[k]);vals.push(req.user.userId,req.params.id);const r=await pool.query(`UPDATE lab_findings SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_by=$${keys.length+1} WHERE id=$${keys.length+2} RETURNING *`,vals);await writeAuditLog({req,action:'UPDATE',entityType:'finding',entityId:req.params.id,oldValue:before.rows[0],newValue:r.rows[0],metadata:{project_id:before.rows[0].project_id}});res.json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:'Failed to update finding'});}});
router.delete('/findings/:id',hasPermission('projects.edit'),async(req,res)=>{try{const b=await pool.query('SELECT * FROM lab_findings WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Finding not found'});if(!(await canEditKnowledgeRecord(b.rows[0],'finding',req.user)))return res.status(403).json({error:'Finding edit access denied'});await pool.query('DELETE FROM lab_findings WHERE id=$1',[req.params.id]);await pool.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('finding',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[req.params.id,b.rows[0].project_id]);await writeAuditLog({req,action:'DELETE',entityType:'finding',entityId:req.params.id,oldValue:b.rows[0],metadata:{project_id:b.rows[0].project_id}});res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete finding'});}});
router.get('/results',hasPermission('projects.view'),async(req,res)=>{try{const q=String(req.query.q||'').trim();const findingVisibility=visibilityReadSql({alias:'f',entityType:'finding',roleParameter:'$1',userIdParameter:'$2'});const r=await pool.query(`SELECT r.*,CASE WHEN ${findingVisibility} THEN f.title ELSE NULL END AS finding_title,NULL::text AS experiment_title FROM lab_results r LEFT JOIN lab_findings f ON f.id=r.finding_id WHERE ${projectFilter('r')} AND ($3='' OR r.title ILIKE '%'||$3||'%' OR r.summary ILIKE '%'||$3||'%' OR COALESCE(r.value_text,'') ILIKE '%'||$3||'%') ORDER BY r.updated_at DESC LIMIT 200`,[req.user.role,req.user.userId,q]);res.json(r.rows);}catch(e){res.status(500).json({error:'Failed to fetch results'});}});
router.post('/results',hasPermission('projects.edit'),async(req,res)=>{const{project_id=null,experiment_id=null,finding_id=null,title,summary='',value_numeric=null,value_text=null,unit=''}=req.body||{};if(!String(title||'').trim())return res.status(400).json({error:'title is required'});try{if(!(await ensureProject(project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const r=await pool.query(`INSERT INTO lab_results(project_id,experiment_id,finding_id,title,summary,value_numeric,value_text,unit,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,[project_id,experiment_id,finding_id,String(title).trim(),summary,value_numeric,value_text,unit,req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'result',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id}});res.status(201).json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:'Failed to create result'});}});
router.patch('/results/:id',hasPermission('projects.edit'),async(req,res)=>{const allowed=['title','summary','value_numeric','value_text','unit','finding_id','experiment_id'];const keys=allowed.filter(k=>k in(req.body||{}));if(!keys.length)return res.status(400).json({error:'No valid fields to update'});try{const b=await pool.query('SELECT * FROM lab_results WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Result not found'});if(!(await canEditKnowledgeRecord(b.rows[0],'result',req.user)))return res.status(403).json({error:'Result edit access denied'});const vals=keys.map(k=>req.body[k]);vals.push(req.user.userId,req.params.id);const r=await pool.query(`UPDATE lab_results SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_by=$${keys.length+1} WHERE id=$${keys.length+2} RETURNING *`,vals);await writeAuditLog({req,action:'UPDATE',entityType:'result',entityId:req.params.id,oldValue:b.rows[0],newValue:r.rows[0],metadata:{project_id:b.rows[0].project_id}});res.json(r.rows[0]);}catch(e){res.status(500).json({error:'Failed to update result'});}});
router.delete('/results/:id',hasPermission('projects.edit'),async(req,res)=>{try{const b=await pool.query('SELECT * FROM lab_results WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Result not found'});if(!(await canEditKnowledgeRecord(b.rows[0],'result',req.user)))return res.status(403).json({error:'Result edit access denied'});await pool.query('DELETE FROM lab_results WHERE id=$1',[req.params.id]);await pool.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('knowledge_result',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[req.params.id,b.rows[0].project_id]);await writeAuditLog({req,action:'DELETE',entityType:'result',entityId:req.params.id,oldValue:b.rows[0]});res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete result'});}});
router.get('/relationships',hasPermission('projects.view'),async(req,res)=>{try{const r=await pool.query('SELECT * FROM knowledge_relationships ORDER BY created_at DESC');res.json((await visibleKnowledgeRelationships(r.rows,req.user)).slice(0,300));}catch(e){res.status(500).json({error:'Failed to fetch relationships'});}});
router.post('/relationships',hasPermission('projects.edit'),async(req,res)=>{
  const {project_id=null,source_type,source_id,target_type,target_id,relationship}=req.body||{};
  if(!source_type||!source_id||!target_type||!target_id||!String(relationship||'').trim())return res.status(400).json({error:'source, target and relationship are required'});
  try{
    if(!(await canEditRelationshipProject(project_id,req.user)))return res.status(403).json({error:'Project edit access denied'});
    if(!(await canReadRelationshipEndpoint(source_type,source_id,req.user))||!(await canReadRelationshipEndpoint(target_type,target_id,req.user)))return res.status(403).json({error:'Relationship endpoint access denied'});
    const values=[project_id,source_type,source_id,target_type,target_id,String(relationship).trim(),req.user.userId];
    const inserted=await pool.query(`INSERT INTO knowledge_relationships(project_id,source_type,source_id,target_type,target_id,relationship,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_type,source_id,target_type,target_id,relationship) DO NOTHING RETURNING *`,values);
    if(inserted.rowCount)return res.status(201).json(inserted.rows[0]);
    const existing=await pool.query('SELECT * FROM knowledge_relationships WHERE source_type=$1 AND source_id=$2 AND target_type=$3 AND target_id=$4 AND relationship=$5',[source_type,source_id,target_type,target_id,String(relationship).trim()]);
    if(!existing.rowCount||!(await canReadKnowledgeRelationship(existing.rows[0],req.user)))return res.status(403).json({error:'Relationship access denied'});
    return res.json(existing.rows[0]);
  }catch(e){console.error(e);res.status(500).json({error:'Failed to create relationship'});}
});
router.delete('/relationships/:id',hasPermission('projects.edit'),async(req,res)=>{try{const b=await pool.query('SELECT * FROM knowledge_relationships WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Relationship not found'});if(!(await canEditRelationshipProject(b.rows[0].project_id,req.user))||!(await canReadKnowledgeRelationship(b.rows[0],req.user)))return res.status(403).json({error:'Relationship edit access denied'});await pool.query('DELETE FROM knowledge_relationships WHERE id=$1',[req.params.id]);await pool.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('knowledge_relationship',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[req.params.id,b.rows[0].project_id]);res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete relationship'});}});
router.get('/search',hasPermission('projects.view'),async(req,res)=>{try{const q=String(req.query.q||'').trim();if(!q)return res.json([]);const params=[req.user.role,req.user.userId,q];const [f,r,c]=await Promise.all([pool.query(`SELECT f.id,'finding' AS type,f.title,f.body AS text,f.project_id FROM lab_findings f WHERE ${projectFilter('f')} AND (f.title ILIKE '%'||$3||'%' OR f.body ILIKE '%'||$3||'%') LIMIT 50`,params),pool.query(`SELECT r.id,'result' AS type,r.title,r.summary AS text,r.project_id FROM lab_results r WHERE ${projectFilter('r')} AND (r.title ILIKE '%'||$3||'%' OR r.summary ILIKE '%'||$3||'%') LIMIT 50`,params),pool.query(`SELECT c.id,'calculation' AS type,c.title,c.formula AS text,c.project_id FROM engineering_calculations c WHERE ${projectFilter('c')} AND (c.title ILIKE '%'||$3||'%' OR c.formula ILIKE '%'||$3||'%') LIMIT 50`,params)]);res.json([...f.rows,...r.rows,...c.rows]);}catch(e){console.error(e);res.status(500).json({error:'Knowledge search failed'});}});

router.get('/sync/pull',hasPermission('projects.view'),async(req,res)=>{
  try{
    const [findings,results,relationships,tombstones]=await Promise.all([
      pool.query(`SELECT f.* FROM lab_findings f WHERE ${projectFilter('f')} ORDER BY f.updated_at ASC`,[req.user.role,req.user.userId]),
      pool.query(`SELECT r.* FROM lab_results r WHERE ${projectFilter('r')} ORDER BY r.updated_at ASC`,[req.user.role,req.user.userId]),
      pool.query('SELECT r.* FROM knowledge_relationships r ORDER BY r.created_at ASC'),
      pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('finding','knowledge_result','knowledge_relationship') AND $1='admin'",[req.user.role])
    ]);
    const visibleRelationships=await visibleKnowledgeRelationships(relationships.rows,req.user);
    const deleted={finding:[],knowledge_result:[],knowledge_relationship:[]};
    for(const row of tombstones.rows){if(deleted[row.entity_type])deleted[row.entity_type].push(row.entity_id);}
    res.setHeader('Cache-Control','no-store');
    res.json({findings:findings.rows,results:results.rows,relationships:visibleRelationships,
      visible_finding_ids:findings.rows.map(row=>row.id),
      visible_result_ids:results.rows.map(row=>row.id),
      visible_relationship_ids:visibleRelationships.map(row=>row.id),deleted});
  }catch(e){console.error(e);res.status(500).json({error:'Failed to pull knowledge changes'});}
});

export default router;
