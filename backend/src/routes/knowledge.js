import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

const projectVisibility = (alias) => `(${alias}.project_id IS NULL OR $2 = 'admin' OR ${alias}.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$1 OR pm.user_id=$1))`;

router.get('/overview', async (req, res) => {
  try {
    const visibilityNotes = projectVisibility('n');
    const visibilityResources = projectVisibility('r');
    const [notes, resources, categories, recentNotes, recentResources] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM notes n WHERE ${visibilityNotes}`, [req.user.userId, req.user.role]),
      pool.query(`SELECT COUNT(*)::int AS count FROM resources r WHERE ${visibilityResources}`, [req.user.userId, req.user.role]),
      pool.query(`SELECT r.category, COUNT(*)::int AS count FROM resources r WHERE ${visibilityResources} GROUP BY r.category ORDER BY count DESC, r.category`, [req.user.userId, req.user.role]),
      pool.query(`SELECT n.id, n.title, n.tags, n.updated_at, n.author_id FROM notes n WHERE ${visibilityNotes} ORDER BY n.updated_at DESC LIMIT 8`, [req.user.userId, req.user.role]),
      pool.query(`SELECT r.id, r.name, r.kind, r.file_type, r.category, r.tags, r.updated_at FROM resources r WHERE r.parent_resource_id IS NULL AND ${visibilityResources} ORDER BY r.updated_at DESC LIMIT 8`, [req.user.userId, req.user.role]),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      counts: { notes: notes.rows[0].count, resources: resources.rows[0].count },
      categories: categories.rows,
      recent_notes: recentNotes.rows,
      recent_resources: recentResources.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load knowledge overview' });
  }
});

router.get('/tags', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tag, SUM(note_count)::int AS note_count, SUM(resource_count)::int AS resource_count
      FROM (
        SELECT unnest(n.tags) AS tag, 1 AS note_count, 0 AS resource_count FROM notes n WHERE ${projectVisibility('n')}
        UNION ALL
        SELECT unnest(r.tags) AS tag, 0 AS note_count, 1 AS resource_count FROM resources r WHERE ${projectVisibility('r')}
      ) x GROUP BY tag ORDER BY tag
    `, [req.user.userId, req.user.role]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load knowledge tags' });
  }
});



const projectFilter = (alias, req) => `(${alias}.project_id IS NULL OR $1 = 'admin' OR ${alias}.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$2 OR pm.user_id=$2))`;
const ensureProject = async (projectId, userId, role) => {
  if (!projectId) return true;
  const r = await pool.query(`SELECT 1 FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.id=$1 AND ($2='admin' OR p.owner_id=$3 OR pm.user_id=$3)`, [projectId, role, userId]);
  return r.rowCount > 0;
};

router.get('/findings', async (req,res)=>{ try {
  const q=String(req.query.q||'').trim(); const params=[req.user.role,req.user.userId];
  const where=`${projectFilter('f',req)} AND ($3='' OR f.title ILIKE '%'||$3||'%' OR f.body ILIKE '%'||$3||'%')`;
  params.push(q); const r=await pool.query(`SELECT f.*,u.username AS creator_username,e.title AS experiment_title FROM lab_findings f LEFT JOIN users u ON u.id=f.created_by LEFT JOIN project_experiments e ON e.id=f.experiment_id WHERE ${where} ORDER BY f.updated_at DESC LIMIT 200`,params); res.json(r.rows);
 } catch(e){console.error(e);res.status(500).json({error:'Failed to fetch findings'});} });
router.post('/findings', async (req,res)=>{ const {project_id=null,experiment_id=null,title,body='',status='open',confidence=null,tags=[]}=req.body||{}; if(!String(title||'').trim())return res.status(400).json({error:'title is required'}); try{ if(!(await ensureProject(project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'}); const r=await pool.query(`INSERT INTO lab_findings(project_id,experiment_id,title,body,status,confidence,tags,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[project_id,experiment_id,String(title).trim(),String(body),status,confidence,tags,req.user.userId]); await writeAuditLog({req,action:'CREATE',entityType:'finding',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id}});res.status(201).json(r.rows[0]); }catch(e){console.error(e);res.status(500).json({error:'Failed to create finding'});} });
router.patch('/findings/:id', async (req,res)=>{ const allowed=['title','body','status','confidence','tags','experiment_id']; const keys=allowed.filter(k=>k in (req.body||{})); if(!keys.length)return res.status(400).json({error:'No valid fields to update'}); try{const before=await pool.query(`SELECT * FROM lab_findings WHERE id=$1`,[req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Finding not found'});if(!(await ensureProject(before.rows[0].project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const vals=keys.map(k=>req.body[k]);vals.push(req.user.userId,req.params.id);const r=await pool.query(`UPDATE lab_findings SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_by=$${keys.length+1} WHERE id=$${keys.length+2} RETURNING *`,vals);await writeAuditLog({req,action:'UPDATE',entityType:'finding',entityId:req.params.id,oldValue:before.rows[0],newValue:r.rows[0],metadata:{project_id:before.rows[0].project_id}});res.json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:'Failed to update finding'});} });
router.delete('/findings/:id', async(req,res)=>{try{const b=await pool.query('SELECT * FROM lab_findings WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Finding not found'});if(!(await ensureProject(b.rows[0].project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});await pool.query('DELETE FROM lab_findings WHERE id=$1',[req.params.id]);await writeAuditLog({req,action:'DELETE',entityType:'finding',entityId:req.params.id,oldValue:b.rows[0],metadata:{project_id:b.rows[0].project_id}});res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete finding'});}});
router.get('/results', async(req,res)=>{try{const q=String(req.query.q||'').trim();const r=await pool.query(`SELECT r.*,f.title AS finding_title,e.title AS experiment_title FROM lab_results r LEFT JOIN lab_findings f ON f.id=r.finding_id LEFT JOIN project_experiments e ON e.id=r.experiment_id WHERE ${projectFilter('r',req)} AND ($3='' OR r.title ILIKE '%'||$3||'%' OR r.summary ILIKE '%'||$3||'%' OR COALESCE(r.value_text,'') ILIKE '%'||$3||'%') ORDER BY r.updated_at DESC LIMIT 200`,[req.user.role,req.user.userId,q]);res.json(r.rows);}catch(e){res.status(500).json({error:'Failed to fetch results'});}});
router.post('/results', async(req,res)=>{const {project_id=null,experiment_id=null,finding_id=null,title,summary='',value_numeric=null,value_text=null,unit=''}=req.body||{};if(!String(title||'').trim())return res.status(400).json({error:'title is required'});try{if(!(await ensureProject(project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const r=await pool.query(`INSERT INTO lab_results(project_id,experiment_id,finding_id,title,summary,value_numeric,value_text,unit,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,[project_id,experiment_id,finding_id,String(title).trim(),summary,value_numeric,value_text,unit,req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'result',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id}});res.status(201).json(r.rows[0]);}catch(e){console.error(e);res.status(500).json({error:'Failed to create result'});}});
router.patch('/results/:id', async(req,res)=>{const allowed=['title','summary','value_numeric','value_text','unit','finding_id','experiment_id'];const keys=allowed.filter(k=>k in (req.body||{}));if(!keys.length)return res.status(400).json({error:'No valid fields to update'});try{const b=await pool.query('SELECT * FROM lab_results WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Result not found'});if(!(await ensureProject(b.rows[0].project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const vals=keys.map(k=>req.body[k]);vals.push(req.user.userId,req.params.id);const r=await pool.query(`UPDATE lab_results SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_by=$${keys.length+1} WHERE id=$${keys.length+2} RETURNING *`,vals);await writeAuditLog({req,action:'UPDATE',entityType:'result',entityId:req.params.id,oldValue:b.rows[0],newValue:r.rows[0],metadata:{project_id:b.rows[0].project_id}});res.json(r.rows[0]);}catch(e){res.status(500).json({error:'Failed to update result'});}});
router.delete('/results/:id',async(req,res)=>{try{const b=await pool.query('SELECT * FROM lab_results WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Result not found'});if(!(await ensureProject(b.rows[0].project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});await pool.query('DELETE FROM lab_results WHERE id=$1',[req.params.id]);res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete result'});}});
router.get('/relationships',async(req,res)=>{try{const r=await pool.query(`SELECT * FROM knowledge_relationships WHERE ($1='admin' OR project_id IS NULL OR project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$2 OR pm.user_id=$2)) ORDER BY created_at DESC LIMIT 300`,[req.user.role,req.user.userId]);res.json(r.rows);}catch(e){res.status(500).json({error:'Failed to fetch relationships'});}});
router.post('/relationships',async(req,res)=>{const {project_id=null,source_type,source_id,target_type,target_id,relationship}=req.body||{};if(!source_type||!source_id||!target_type||!target_id||!String(relationship||'').trim())return res.status(400).json({error:'source, target and relationship are required'});try{if(!(await ensureProject(project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});const r=await pool.query(`INSERT INTO knowledge_relationships(project_id,source_type,source_id,target_type,target_id,relationship,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_type,source_id,target_type,target_id,relationship) DO UPDATE SET project_id=EXCLUDED.project_id RETURNING *`,[project_id,source_type,source_id,target_type,target_id,String(relationship).trim(),req.user.userId]);res.status(201).json(r.rows[0]);}catch(e){res.status(500).json({error:'Failed to create relationship'});}});
router.delete('/relationships/:id',async(req,res)=>{try{const b=await pool.query('SELECT * FROM knowledge_relationships WHERE id=$1',[req.params.id]);if(!b.rowCount)return res.status(404).json({error:'Relationship not found'});if(!(await ensureProject(b.rows[0].project_id,req.user.userId,req.user.role)))return res.status(403).json({error:'Project access denied'});await pool.query('DELETE FROM knowledge_relationships WHERE id=$1',[req.params.id]);res.status(204).send();}catch(e){res.status(500).json({error:'Failed to delete relationship'});}});
router.get('/search',async(req,res)=>{try{const q=String(req.query.q||'').trim();if(!q)return res.json([]);const [f,r,c]=await Promise.all([pool.query(`SELECT id,'finding' AS type,title,body AS text,project_id FROM lab_findings WHERE (title ILIKE '%'||$1||'%' OR body ILIKE '%'||$1||'%') LIMIT 50`,[q]),pool.query(`SELECT id,'result' AS type,title,summary AS text,project_id FROM lab_results WHERE (title ILIKE '%'||$1||'%' OR summary ILIKE '%'||$1||'%') LIMIT 50`,[q]),pool.query(`SELECT id,'calculation' AS type,title,formula AS text,project_id FROM engineering_calculations WHERE (title ILIKE '%'||$1||'%' OR formula ILIKE '%'||$1||'%') LIMIT 50`,[q])]);res.json([...f.rows,...r.rows,...c.rows]);}catch(e){res.status(500).json({error:'Knowledge search failed'});}});

export default router;
