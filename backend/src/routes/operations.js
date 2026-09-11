import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/overview', async (req, res) => {
  try {
    const [counts, lowStock, calibration, maintenance, equipment, missingBom, requirements] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_items,
        COUNT(*) FILTER (WHERE type='equipment')::int AS equipment,
        COUNT(*) FILTER (WHERE type='tool')::int AS tools,
        COUNT(*) FILTER (WHERE type IN ('component','spare_part'))::int AS components,
        COUNT(*) FILTER (WHERE type='material')::int AS materials,
        COUNT(*) FILTER (WHERE status='low_stock' OR current_quantity <= initial_quantity * 0.2)::int AS low_stock,
        COALESCE(SUM(current_quantity * COALESCE(unit_cost,0)),0)::numeric AS stock_value
        FROM items`),
      pool.query(`SELECT id,name,type,current_quantity,initial_quantity,unit,status,location_id,supplier,part_number
        FROM items WHERE status='low_stock' OR current_quantity <= initial_quantity * 0.2 ORDER BY current_quantity ASC, name ASC LIMIT 50`),
      pool.query(`SELECT i.id,i.name,i.type,i.next_calibration_date,i.calibration_interval_days,i.status
        FROM items i WHERE i.next_calibration_date IS NOT NULL AND i.next_calibration_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY i.next_calibration_date ASC LIMIT 50`),
      pool.query(`SELECT m.id,m.item_id,i.name,i.type,m.maintenance_type,m.status,m.scheduled_date,m.completed_date,m.notes
        FROM maintenance_records m JOIN items i ON i.id=m.item_id
        WHERE m.status IN ('scheduled','in_progress') OR (m.scheduled_date IS NOT NULL AND m.scheduled_date <= CURRENT_DATE + INTERVAL '30 days')
        ORDER BY m.scheduled_date NULLS LAST LIMIT 50`),
      pool.query(`SELECT id,name,type,status,manufacturer,model_number,serial_number,asset_tag,assigned_to,next_maintenance_date,next_calibration_date
        FROM items WHERE type IN ('equipment','instrument','tool') ORDER BY name ASC LIMIT 100`),
      pool.query(`SELECT b.id,b.project_id,p.name AS project_name,b.name,b.required_quantity,b.unit,
          b.preferred_item_id,pi.current_quantity AS preferred_quantity,b.alternative_item_id,ai.current_quantity AS alternative_quantity,
          CASE WHEN pi.id IS NOT NULL AND pi.current_quantity >= b.required_quantity THEN 'available'
               WHEN ai.id IS NOT NULL AND ai.current_quantity >= b.required_quantity THEN 'alternative_available'
               ELSE 'missing' END AS availability
        FROM project_bom_items b JOIN projects p ON p.id=b.project_id
        LEFT JOIN items pi ON pi.id=b.preferred_item_id LEFT JOIN items ai ON ai.id=b.alternative_item_id
        WHERE (pi.id IS NULL OR pi.current_quantity < b.required_quantity)
          AND (ai.id IS NULL OR ai.current_quantity < b.required_quantity)
        ORDER BY p.name,b.name LIMIT 100`),
      pool.query(`SELECT r.id,r.project_id,p.name AS project_name,r.name,r.requirement_type,r.quantity,r.unit,r.required_by,r.status,r.preferred_item_id,i.name AS preferred_item_name,i.current_quantity AS preferred_quantity
        FROM project_resource_requirements r JOIN projects p ON p.id=r.project_id LEFT JOIN items i ON i.id=r.preferred_item_id
        WHERE r.status NOT IN ('fulfilled','cancelled') ORDER BY r.required_by NULLS LAST,p.name,r.name LIMIT 100`),
    ]);
    res.json({summary: counts.rows[0], low_stock: lowStock.rows, calibration_due: calibration.rows, maintenance_due: maintenance.rows, equipment: equipment.rows, missing_bom: missingBom.rows, requirements: requirements.rows});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load operations overview' }); }
});

router.get('/suppliers', async (_req,res) => {
  try { const r=await pool.query(`SELECT s.*,COUNT(i.id)::int AS item_count FROM suppliers s LEFT JOIN items i ON i.supplier_id=s.id GROUP BY s.id ORDER BY s.name`); res.json(r.rows); }
  catch(err){console.error(err);res.status(500).json({error:'Failed to fetch suppliers'});}
});
router.post('/suppliers', async (req,res) => {
  const {name,contact_name=null,email=null,phone=null,website=null,notes=''}=req.body||{};
  if(!String(name||'').trim()) return res.status(400).json({error:'name is required'});
  try { const r=await pool.query(`INSERT INTO suppliers(name,contact_name,email,phone,website,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[String(name).trim(),contact_name,email,phone,website,notes,req.user.userId]); await writeAuditLog({req,action:'CREATE',entityType:'supplier',entityId:r.rows[0].id,newValue:r.rows[0]});res.status(201).json(r.rows[0]); }
  catch(err){if(err.code==='23505')return res.status(409).json({error:'Supplier already exists'});console.error(err);res.status(500).json({error:'Failed to create supplier'});}
});
router.patch('/suppliers/:id', async (req,res) => {
  const allowed=['name','contact_name','email','phone','website','notes'];const updates=[],values=[];for(const f of allowed)if(f in req.body){values.push(req.body[f]===''?null:req.body[f]);updates.push(`${f}=$${values.length}`);}if(!updates.length)return res.status(400).json({error:'No valid fields to update'});values.push(req.params.id);
  try{const before=await pool.query('SELECT * FROM suppliers WHERE id=$1',[req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Supplier not found'});const r=await pool.query(`UPDATE suppliers SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,values);await writeAuditLog({req,action:'UPDATE',entityType:'supplier',entityId:req.params.id,oldValue:before.rows[0],newValue:r.rows[0]});res.json(r.rows[0]);}catch(err){console.error(err);res.status(500).json({error:'Failed to update supplier'});}
});
router.delete('/suppliers/:id', requireRole('admin'), async(req,res)=>{try{const before=await pool.query('SELECT * FROM suppliers WHERE id=$1',[req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Supplier not found'});await pool.query('DELETE FROM suppliers WHERE id=$1',[req.params.id]);await writeAuditLog({req,action:'DELETE',entityType:'supplier',entityId:req.params.id,oldValue:before.rows[0]});res.status(204).send();}catch(err){console.error(err);res.status(500).json({error:'Failed to delete supplier'});}});

router.get('/requirements', async(req,res)=>{try{const r=await pool.query(`SELECT r.*,p.name AS project_name,i.name AS preferred_item_name,i.current_quantity AS preferred_quantity FROM project_resource_requirements r JOIN projects p ON p.id=r.project_id LEFT JOIN items i ON i.id=r.preferred_item_id WHERE ($1::uuid IS NULL OR r.project_id=$1) ORDER BY r.required_by NULLS LAST,p.name,r.name`,[req.query.project_id||null]);res.json(r.rows);}catch(err){console.error(err);res.status(500).json({error:'Failed to fetch resource requirements'});}});
router.post('/requirements', async(req,res)=>{const {project_id,name,requirement_type='component',quantity=1,unit=null,required_by=null,preferred_item_id=null,notes='',status='required'}=req.body||{};if(!project_id||!String(name||'').trim())return res.status(400).json({error:'project_id and name are required'});if(Number(quantity)<=0)return res.status(400).json({error:'quantity must be greater than zero'});try{const r=await pool.query(`INSERT INTO project_resource_requirements(project_id,name,requirement_type,quantity,unit,required_by,preferred_item_id,notes,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[project_id,String(name).trim(),requirement_type,quantity,unit,required_by,preferred_item_id,notes,status,req.user.userId]);await writeAuditLog({req,action:'CREATE',entityType:'project_resource_requirement',entityId:r.rows[0].id,newValue:r.rows[0],metadata:{project_id}});res.status(201).json(r.rows[0]);}catch(err){console.error(err);res.status(500).json({error:'Failed to create requirement'});}});
router.patch('/requirements/:id',async(req,res)=>{const allowed=['name','requirement_type','quantity','unit','required_by','preferred_item_id','notes','status'];const updates=[],values=[];for(const f of allowed)if(f in req.body){values.push(req.body[f]===''?null:req.body[f]);updates.push(`${f}=$${values.length}`);}if(!updates.length)return res.status(400).json({error:'No valid fields to update'});values.push(req.params.id);try{const r=await pool.query(`UPDATE project_resource_requirements SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,values);if(!r.rowCount)return res.status(404).json({error:'Requirement not found'});await writeAuditLog({req,action:'UPDATE',entityType:'project_resource_requirement',entityId:req.params.id,newValue:r.rows[0]});res.json(r.rows[0]);}catch(err){console.error(err);res.status(500).json({error:'Failed to update requirement'});}});
router.delete('/requirements/:id',async(req,res)=>{try{const r=await pool.query('DELETE FROM project_resource_requirements WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Requirement not found'});await writeAuditLog({req,action:'DELETE',entityType:'project_resource_requirement',entityId:req.params.id});res.status(204).send();}catch(err){console.error(err);res.status(500).json({error:'Failed to delete requirement'});}});

export default router;
