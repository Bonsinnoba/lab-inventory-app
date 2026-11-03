import {projectWorkFlatMutation} from '../project-work-http.js';
import { catalogHttpMutation } from '../catalog-sync.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';
import { filterReadableRows } from '../middleware/read-visibility.js';

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
    const summary = { ...counts.rows[0] };
    missingBom.rows=await filterReadableRows('tasks',missingBom.rows,req.user);
    requirements.rows=await filterReadableRows('tasks',requirements.rows,req.user);
    if (!req.permissions?.has('finance.view')) summary.stock_value = null;
    res.json({summary, low_stock: lowStock.rows, calibration_due: calibration.rows, maintenance_due: maintenance.rows, equipment: equipment.rows, missing_bom: missingBom.rows, requirements: requirements.rows});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load operations overview' }); }
});

router.get('/suppliers', async (_req,res) => {
  try { const r=await pool.query(`SELECT s.*,COUNT(i.id)::int AS item_count FROM suppliers s LEFT JOIN items i ON i.supplier_id=s.id GROUP BY s.id ORDER BY s.name`); res.json(r.rows); }
  catch(err){console.error(err);res.status(500).json({error:'Failed to fetch suppliers'});}
});
router.post('/suppliers',catalogHttpMutation('supplier','create'));
router.patch('/suppliers/:id',catalogHttpMutation('supplier','update'));
router.delete('/suppliers/:id',catalogHttpMutation('supplier','delete'));

router.get('/requirements', async(req,res)=>{try{const r=await pool.query(`SELECT r.*,p.name AS project_name,i.name AS preferred_item_name,i.current_quantity AS preferred_quantity FROM project_resource_requirements r JOIN projects p ON p.id=r.project_id LEFT JOIN items i ON i.id=r.preferred_item_id WHERE ($1::uuid IS NULL OR r.project_id=$1) ORDER BY r.required_by NULLS LAST,p.name,r.name`,[req.query.project_id||null]);res.json(await filterReadableRows('tasks',r.rows,req.user));}catch(err){console.error(err);res.status(500).json({error:'Failed to fetch resource requirements'});}});
router.post('/requirements',projectWorkFlatMutation('requirement','create'));
router.patch('/requirements/:id',projectWorkFlatMutation('requirement','update'));
router.delete('/requirements/:id',projectWorkFlatMutation('requirement','delete'));

export default router;
