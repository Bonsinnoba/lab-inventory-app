import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getUserPermissions } from '../middleware/permissions.js';
import { hasPermission } from '../middleware/permissions.js';

const router = Router();
function generateItemSku(name, type) {
  const words = String(name || 'item').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const namePart = words.length > 1
    ? (words[0].slice(0, 2) + words[1].slice(0, 2))
    : (words[0] || 'ITEM').slice(0, 4);
  const typePart = String(type || 'item').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1) || 'I';
  return `LAB-${namePart}-${typePart}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}


router.get('/', async (req, res) => {
  const { type, status, location, location_id, low_stock } = req.query;
  const conditions = []; const values = [];
  if (type) { values.push(type); conditions.push(`i.type = $${values.length}`); }
  if (status) { values.push(status); conditions.push(`i.status = $${values.length}`); }
  if (location) { values.push(`%${String(location).trim()}%`); conditions.push(`i.storage_location ILIKE $${values.length}`); }
  if (location_id) { values.push(location_id); conditions.push(`i.location_id = $${values.length}`); }
  if (low_stock === 'true') conditions.push(`(i.current_quantity <= (i.initial_quantity * 0.2) OR i.status = 'low_stock')`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try { const result = await pool.query(`SELECT i.* FROM items i ${where} ORDER BY i.name ASC`, values); res.json(result.rows); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch items' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await pool.query(`SELECT i.*, u.username AS assigned_to_username FROM items i LEFT JOIN users u ON u.id = i.assigned_to WHERE i.id = $1`, [req.params.id]);
    if (!item.rowCount) return res.status(404).json({ error: 'Item not found' });
    const permissions = await getUserPermissions(req.user.userId, req.user.role);
    const transactions = permissions.has('finance.view') ? await pool.query('SELECT * FROM transactions WHERE item_id = $1 ORDER BY date DESC', [req.params.id]) : { rows: [] };
    const notes = permissions.has('notes.view') ? await pool.query('SELECT * FROM notes WHERE item_id = $1 ORDER BY created_at DESC', [req.params.id]) : { rows: [] };
    res.json({ ...item.rows[0], transactions: transactions.rows, notes: notes.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch item' }); }
});

router.post('/', hasPermission('inventory.create'), async (req, res) => {
  const { name, type, category, sku, initial_quantity, current_quantity, unit, dimensions, status, condition_notes, unit_cost, replacement_cost, location_id, storage_location, photo_url, supplier, supplier_id = null, part_number, acquisition_method = 'unspecified', acquisition_source, acquisition_notes } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  if (!['unspecified','purchased','salvaged','donated','transferred','fabricated','other'].includes(acquisition_method)) return res.status(400).json({ error: 'Invalid acquisition method' });
  try {
    const result = await pool.query(`INSERT INTO items (name,type,category,sku,initial_quantity,current_quantity,unit,dimensions,status,condition_notes,unit_cost,replacement_cost,location_id,storage_location,photo_url,supplier,supplier_id,part_number,acquisition_method,acquisition_source,acquisition_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [name,type,category ?? null,(typeof sku==='string'&&!sku.trim())?generateItemSku(name,type):(sku ?? generateItemSku(name,type)),initial_quantity ?? 0,current_quantity ?? initial_quantity ?? 0,unit ?? null,dimensions ?? null,status ?? 'available',condition_notes ?? null,unit_cost ?? null,replacement_cost ?? null,location_id ?? null,storage_location ? String(storage_location).trim() || null : null,photo_url ?? null,supplier ?? null,supplier_id,part_number ?? null,acquisition_method,acquisition_source ?? null,acquisition_notes ?? null]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'item', entityId: result.rows[0].id, newValue: result.rows[0] }); res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to create item' }); }
});

router.put('/:id', hasPermission('inventory.edit'), async (req, res) => {
  const fields = ['name','type','category','sku','initial_quantity','unit','dimensions','status','condition_notes','last_checked_at','unit_cost','replacement_cost','location_id','storage_location','photo_url','next_maintenance_date','maintenance_interval_days','manufacturer','model_number','serial_number','asset_tag','calibration_interval_days','next_calibration_date','assigned_to','supplier','supplier_id','part_number','image_resource_id','acquisition_method','acquisition_source','acquisition_notes'];
  const updates = []; const values = [];
  for (const field of fields) if (field in req.body) { values.push(field === 'storage_location' ? (req.body[field] ? String(req.body[field]).trim() || null : null) : field === 'sku' && typeof req.body[field] === 'string' && !req.body[field].trim() ? null : req.body[field]); updates.push(`${field} = $${values.length}`); }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' }); values.push(req.params.id);
  try {
    const before = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]); if (!before.rowCount) return res.status(404).json({ error: 'Item not found' });
    const result = await pool.query(`UPDATE items SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    for (const field of fields) if (field in req.body && String(before.rows[0][field] ?? '') !== String(result.rows[0][field] ?? '')) await pool.query('INSERT INTO item_history (item_id, field_name, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4,$5)', [req.params.id, field, before.rows[0][field] == null ? null : String(before.rows[0][field]), result.rows[0][field] == null ? null : String(result.rows[0][field]), req.user?.userId || null]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'item', entityId: req.params.id, oldValue: before.rows[0], newValue: result.rows[0] }); res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to update item' }); }
});

router.get('/:id/history', async (req, res) => { try { const result = await pool.query('SELECT * FROM item_history WHERE item_id = $1 ORDER BY changed_at DESC', [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch item history' }); } });
router.get('/:id/assignment-history', async (req, res) => { try { const result = await pool.query(`SELECT a.id,a.action,a.old_value,a.new_value,a.created_at,u.username AS actor_username,old_user.username AS old_assignee_username,new_user.username AS new_assignee_username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN users old_user ON old_user.id=NULLIF(a.old_value->>'assigned_to','')::uuid LEFT JOIN users new_user ON new_user.id=NULLIF(a.new_value->>'assigned_to','')::uuid WHERE a.entity_type='item' AND a.entity_id=$1 AND (a.old_value ? 'assigned_to' OR a.new_value ? 'assigned_to') ORDER BY a.created_at DESC`, [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: { code: 'ASSIGNMENT_HISTORY_FAILED', message: 'Failed to fetch assignment history' } }); } });
router.get('/:id/movements', async (req, res) => { try { const result = await pool.query(`SELECT m.*,p.name AS project_name,u.username AS performed_by_username FROM item_movements m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN users u ON u.id=m.performed_by WHERE m.item_id=$1 ORDER BY m.created_at DESC`, [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: { code: 'MOVEMENTS_FETCH_FAILED', message: 'Failed to fetch item movements' } }); } });
router.post('/:id/movements', hasPermission('inventory.adjust_stock'), async (req, res) => {
  const { movement_type, quantity, to_storage_location = null, to_location_id = null, project_id = null, reason = null, reference = null } = req.body;
  const allowed = new Set(['receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in']); const qty = Number(quantity);
  const destination = to_storage_location ? String(to_storage_location).trim() : null;
  if (!allowed.has(movement_type)) return res.status(400).json({ error: { code: 'INVALID_MOVEMENT_TYPE', message: 'Invalid movement type' } });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: { code: 'INVALID_QUANTITY', message: 'Quantity must be greater than zero' } });
  if (movement_type === 'transfer' && !destination && !to_location_id) return res.status(400).json({ error: { code: 'TRANSFER_LOCATION_REQUIRED', message: 'A destination location is required for transfers' } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemResult = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!itemResult.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } }); }
    const item = itemResult.rows[0]; const incoming = new Set(['receive','return','repair_in']); const outgoing = new Set(['checkout','consume','damage','loss','repair_out']); let next = Number(item.current_quantity);
    if (incoming.has(movement_type)) next += qty; else if (outgoing.has(movement_type)) next -= qty; else if (movement_type === 'adjust') next = qty;
    if (next < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Movement would make stock negative' } }); }
    const nextStorageLocation = movement_type === 'transfer' ? (destination || (to_location_id ? null : item.storage_location)) : item.storage_location;
    const movement = await client.query(`INSERT INTO item_movements (item_id,movement_type,quantity,from_location_id,to_location_id,from_storage_location,to_storage_location,project_id,reason,reference,performed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.params.id,movement_type,qty,null,to_location_id,item.storage_location,nextStorageLocation,project_id,reason,reference,req.user?.userId || null]);
    const updated = await client.query('UPDATE items SET current_quantity=$1,storage_location=$2 WHERE id=$3 RETURNING *', [next,nextStorageLocation,req.params.id]);
    await client.query('COMMIT'); await writeAuditLog({ req, action: 'CREATE', entityType: 'item_movement', entityId: movement.rows[0].id, newValue: movement.rows[0] }); res.status(201).json({ movement: movement.rows[0], item: updated.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: { code: 'MOVEMENT_FAILED', message: err.message || 'Failed to record movement' } }); } finally { client.release(); }
});

export default router;
