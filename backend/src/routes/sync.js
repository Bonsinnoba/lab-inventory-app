import { Router } from 'express';
import { pool } from '../db.js';
import { getUserPermissions } from '../middleware/permissions.js';

const router = Router();
const ITEM_FIELDS = ['name','type','category','sku','initial_quantity','current_quantity','unit','dimensions','status','condition_notes','unit_cost','replacement_cost','location_id','storage_location','photo_url','supplier','supplier_id','part_number','next_maintenance_date','maintenance_interval_days','manufacturer','model_number','serial_number','asset_tag','calibration_interval_days','next_calibration_date','assigned_to','image_resource_id','created_at','updated_at'];
const MOVEMENT_TYPES = new Set(['receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in']);
const INCOMING = new Set(['receive','return','repair_in']);
const OUTGOING = new Set(['checkout','consume','damage','loss','repair_out']);

function fail(status, code, message) { const error = new Error(message); error.status = status; error.code = code; throw error; }
function jsonObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_SYNC_PAYLOAD', `${label} must be an object`); return value; }
function numeric(value, label) { const n = Number(value); if (!Number.isFinite(n)) fail(400, 'INVALID_SYNC_PAYLOAD', `${label} must be numeric`); return n; }
function uuidLike(value, label) { if (typeof value !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(value)) fail(400, 'INVALID_SYNC_ID', `${label} is invalid`); return value; }

async function applyItem(client, change) {
  const payload = jsonObject(change.payload, 'Item payload');
  const id = uuidLike(payload.id || change.entity_id, 'Item ID');
  if (change.operation === 'create') {
    const values = [id]; const columns = ['id'];
    for (const field of ITEM_FIELDS) if (field !== 'id' && Object.prototype.hasOwnProperty.call(payload, field)) { columns.push(field); values.push(payload[field] ?? null); }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
    const existing = await client.query('SELECT id FROM items WHERE id=$1', [id]);
    if (existing.rowCount) fail(409, 'ITEM_ALREADY_EXISTS', `Item ${id} already exists`);
    const result = await client.query(`INSERT INTO items (${columns.join(',')}) VALUES (${placeholders}) RETURNING *`, values);
    return result.rows[0];
  }
  if (change.operation === 'update') {
    const patch = jsonObject(payload.patch || payload.item || payload, 'Item update');
    const updates = []; const values = [];
    for (const field of ITEM_FIELDS) if (field !== 'id' && Object.prototype.hasOwnProperty.call(patch, field)) { values.push(patch[field] ?? null); updates.push(`${field}=$${values.length}`); }
    if (!updates.length) fail(400, 'EMPTY_ITEM_UPDATE', 'No valid item fields were supplied');
    const before = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [id]);
    if (!before.rowCount) fail(409, 'ITEM_NOT_FOUND', `Item ${id} does not exist on the server`);
    values.push(id);
    const result = await client.query(`UPDATE items SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`, values);
    return result.rows[0];
  }
  if (change.operation === 'delete') {
    const result = await client.query('DELETE FROM items WHERE id=$1 RETURNING *', [id]);
    return { deleted: Boolean(result.rowCount), id };
  }
  fail(400, 'UNSUPPORTED_ITEM_OPERATION', `Unsupported item operation: ${change.operation}`);
}

async function applyMovement(client, change) {
  const payload = jsonObject(change.payload, 'Movement payload');
  const itemId = uuidLike(payload.item_id || change.entity_id, 'Movement item ID');
  const movementId = uuidLike(payload.id, 'Movement ID');
  const type = String(payload.movement_type || '');
  const quantity = numeric(payload.quantity, 'Movement quantity');
  if (!MOVEMENT_TYPES.has(type)) fail(400, 'INVALID_MOVEMENT_TYPE', 'Invalid movement type');
  if (quantity <= 0) fail(400, 'INVALID_QUANTITY', 'Quantity must be greater than zero');
  const existingMovement = await client.query('SELECT * FROM item_movements WHERE id=$1', [movementId]);
  if (existingMovement.rowCount) return { movement: existingMovement.rows[0], item: await client.query('SELECT * FROM items WHERE id=$1', [itemId]).then(r => r.rows[0]) };
  const itemResult = await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [itemId]);
  if (!itemResult.rowCount) fail(409, 'ITEM_NOT_FOUND', `Item ${itemId} does not exist on the server`);
  const item = itemResult.rows[0];
  let next = numeric(item.current_quantity, 'Current quantity');
  if (INCOMING.has(type)) next += quantity; else if (OUTGOING.has(type)) next -= quantity; else if (type === 'adjust') next = quantity;
  if (next < 0) fail(409, 'INSUFFICIENT_STOCK', 'Movement would make stock negative');
  const destinationStorage = type === 'transfer' ? (payload.to_storage_location ? String(payload.to_storage_location).trim() : null) : (item.storage_location ?? null);
  const destinationLocation = type === 'transfer' ? (payload.to_location_id || item.location_id || null) : (payload.to_location_id || null);
  if (type === 'transfer' && !destinationStorage && !destinationLocation) fail(400, 'TRANSFER_LOCATION_REQUIRED', 'A destination location is required for transfers');
  const movementResult = await client.query(`INSERT INTO item_movements (id,item_id,movement_type,quantity,quantity_before,quantity_after,from_location_id,to_location_id,from_storage_location,to_storage_location,project_id,reason,reference,performed_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,now())) RETURNING *`, [movementId,itemId,type,quantity,Number(item.current_quantity),next,item.location_id||null,destinationLocation,item.storage_location||null,destinationStorage,payload.project_id||null,payload.reason||null,payload.reference||null,null,payload.created_at||null]);
  const updated = await client.query('UPDATE items SET current_quantity=$1,storage_location=$2,location_id=COALESCE($3,location_id),updated_at=now() WHERE id=$4 RETURNING *', [next,destinationStorage,destinationLocation,itemId]);
  return { movement: movementResult.rows[0], item: updated.rows[0] };
}

async function applyChange(client, change) {
  if (change.entity_type === 'item') return applyItem(client, change);
  if (change.entity_type === 'item_movement' && change.operation === 'create') return applyMovement(client, change);
  if (change.operation === 'bulk_status') {
    const payload=jsonObject(change.payload,'Bulk status payload'); const ids=Array.isArray(payload.ids)?payload.ids:[]; if(!ids.length||typeof payload.status!=='string')fail(400,'INVALID_BULK_STATUS','ids and status are required');
    const result=await client.query('UPDATE items SET status=$1,updated_at=now() WHERE id=ANY($2::uuid[])',[payload.status,ids]); return {updated:Number(result.rowCount)};
  }
  if (change.operation === 'bulk_delete') {
    const payload=jsonObject(change.payload,'Bulk delete payload'); const ids=Array.isArray(payload.ids)?payload.ids:[]; if(!ids.length) return {deleted:0};
    const result=await client.query('DELETE FROM items WHERE id=ANY($1::uuid[])',[ids]); return {deleted:Number(result.rowCount)};
  }
  fail(400,'UNSUPPORTED_SYNC_CHANGE',`Unsupported sync change: ${change.entity_type}/${change.operation}`);
}

router.post('/push', async (req, res, next) => {
  const body = jsonObject(req.body, 'Sync request');
  const deviceId = typeof body.device_id === 'string' && body.device_id.trim() ? body.device_id.trim() : null;
  const changes = Array.isArray(body.changes) ? body.changes : null;
  if (!deviceId) return res.status(400).json({ error: { code:'DEVICE_ID_REQUIRED', message:'device_id is required' } });
  if (!changes) return res.status(400).json({ error: { code:'CHANGES_REQUIRED', message:'changes must be an array' } });
  if (changes.length > 100) return res.status(413).json({ error: { code:'SYNC_BATCH_TOO_LARGE', message:'A maximum of 100 changes can be synchronized per request' } });
  try {
    const permissions = await getUserPermissions(req.user.userId, req.user.role);
    const results = [];
    for (const raw of changes) {
      const change = jsonObject(raw, 'Sync change');
      if (typeof change.change_id !== 'string' || !change.change_id.trim()) { results.push({change_id:null,status:'rejected',error:{code:'CHANGE_ID_REQUIRED',message:'change_id is required'}}); continue; }
      const entityType=String(change.entity_type||''); const operation=String(change.operation||'');
      const required = entityType === 'item_movement' ? 'inventory.adjust_stock' : operation === 'create' ? 'inventory.create' : operation === 'delete' || operation === 'bulk_delete' ? 'inventory.delete' : operation === 'bulk_status' ? 'inventory.edit' : 'inventory.edit';
      if (!permissions.has(required)) { results.push({change_id:change.change_id,status:'rejected',error:{code:'PERMISSION_DENIED',message:`Permission required: ${required}`}}); continue; }
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const prior=await client.query('SELECT payload_json,response_json,response_status FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[change.change_id]);
        if(prior.rowCount){if(JSON.stringify(prior.rows[0].payload_json)!==JSON.stringify(change.payload)){await client.query('ROLLBACK');results.push({change_id:change.change_id,status:'rejected',error:{code:'IDEMPOTENCY_PAYLOAD_MISMATCH',message:'change_id was already used with a different payload'}});continue;}await client.query('COMMIT');results.push({change_id:change.change_id,status:'synced',result:prior.rows[0].response_json});continue;}
        const result=await applyChange(client,change);
        await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,200)',[change.change_id,deviceId,req.user.userId,entityType,change.entity_id||null,operation,change.payload,result]);
        await client.query('COMMIT');
        results.push({change_id:change.change_id,status:'synced',result});
      } catch(error) {
        await client.query('ROLLBACK').catch(()=>{});
        if(error?.code==='23505'){
          const prior=await pool.query('SELECT payload_json,response_json FROM sync_idempotency WHERE change_id=$1',[change.change_id]);
          if(prior.rowCount && JSON.stringify(prior.rows[0].payload_json)===JSON.stringify(change.payload)){results.push({change_id:change.change_id,status:'synced',result:prior.rows[0].response_json});continue;}
        }
        results.push({change_id:change.change_id,status:'failed',error:{code:error.code||error.status?'SYNC_APPLY_FAILED': 'SYNC_APPLY_FAILED',message:error.message||'Unable to apply sync change'}});
      } finally { client.release(); }
    }
    res.json({device_id:deviceId,accepted:results.filter(r=>r.status==='synced').length,results});
  } catch(error) { next(error); }
});

export default router;
