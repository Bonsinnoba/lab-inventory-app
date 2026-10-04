import { writeAuditLog } from './middleware/audit.js';
import { getUserPermissions } from './middleware/permissions.js';

const fields = ['maintenance_type','status','scheduled_date','completed_date','notes','cost'];
function fail(status, code, message) { throw Object.assign(new Error(message), {status, code}); }
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(400,'INVALID_SYNC_ID','A canonical maintenance/item UUID is required');
  return value.toLowerCase();
}
export function validateMaintenance(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(400,'INVALID_MAINTENANCE','Maintenance record is required');
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(record,field)) continue;
    const value = record[field];
    if (field === 'maintenance_type' && !['routine','repair','inspection','calibration','cleaning','other'].includes(value)) fail(400,'INVALID_MAINTENANCE','Invalid maintenance type');
    if (field === 'status' && !['scheduled','in_progress','completed','cancelled'].includes(value)) fail(400,'INVALID_MAINTENANCE','Invalid maintenance status');
    if (field.endsWith('_date') && value !== null) {
      const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value+'T00:00:00Z') : null;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) fail(400,'INVALID_MAINTENANCE',`Invalid ${field}`);
    }
    if (field === 'notes' && value !== null && (typeof value !== 'string' || value.length > 10000)) fail(400,'INVALID_MAINTENANCE','Invalid maintenance notes');
    if (field === 'cost' && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9999999999.99)) fail(400,'INVALID_MAINTENANCE','Invalid maintenance cost');
    result[field] = value;
  }
  return result;
}

// Called inside the sync transaction; idempotency and commit belong to caller.
export async function applyMaintenanceChange(client,change,user) {
  const permissions=await getUserPermissions(user.userId,user.role);
  if (!permissions.has('inventory.view') || !permissions.has('inventory.edit')) fail(403,'PERMISSION_DENIED','Maintenance requires inventory.view and inventory.edit');
  if (!['create','update','delete'].includes(change.operation)) fail(400,'INVALID_MAINTENANCE_OPERATION','Unsupported maintenance operation');
  const payload=change.payload, record=payload?.record;
  if (!record || typeof record !== 'object') fail(400,'INVALID_MAINTENANCE','record is required');
  const entityId=uuid(change.entity_id), itemId=uuid(record.item_id);
  if (uuid(record.id) !== entityId) fail(400,'INVALID_SYNC_ID','Maintenance IDs disagree');
  if (payload.depends_on) {
    const dependency=await client.query("SELECT 1 FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND entity_type='maintenance_record' AND entity_id=$3",[payload.depends_on,user.userId,entityId]);
    if (!dependency.rowCount) fail(409,'SYNC_DEPENDENCY_PENDING','An earlier maintenance change must be resolved first');
  }
  // Serialize creates, deletes and different-key retries for the same identity.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['maintenance:'+entityId]);
  const existing=(await client.query('SELECT * FROM maintenance_records WHERE id=$1 FOR UPDATE',[entityId])).rows[0];
  if (existing && existing.item_id !== itemId) fail(409,'MAINTENANCE_PARENT_MISMATCH','Maintenance item cannot be changed');
  const tombstone=await client.query("SELECT 1 FROM sync_tombstones WHERE entity_type='maintenance_record' AND entity_id=$1",[entityId]);
  if (change.operation === 'create' && (existing || tombstone.rowCount)) fail(409,'SYNC_CONFLICT','Maintenance identity already exists or was deleted');
  if (!existing && change.operation !== 'create') {
    if (change.operation === 'delete' && tombstone.rowCount) return {id:entityId,deleted:true};
    fail(409,'SYNC_CONFLICT','Maintenance record no longer exists');
  }
  if (existing && (!Number.isSafeInteger(payload.expected_version) || payload.expected_version !== existing.sync_version)) fail(409,'SYNC_CONFLICT','Maintenance changed on another client. Refresh and review before retrying.');
  let result;
  if (change.operation === 'delete') {
    await client.query('DELETE FROM maintenance_records WHERE id=$1',[entityId]);
    result={id:entityId,deleted:true};
  } else {
    const values=validateMaintenance(record);
    const parent=await client.query('SELECT 1 FROM items WHERE id=$1 FOR KEY SHARE',[itemId]);
    if (!parent.rowCount) fail(409,'MAINTENANCE_PARENT_NOT_FOUND','Sync the inventory item before its maintenance');
    if (change.operation === 'create') {
      result=(await client.query(`INSERT INTO maintenance_records(id,item_id,maintenance_type,status,scheduled_date,completed_date,notes,cost,performed_by,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[entityId,itemId,values.maintenance_type??'routine',values.status??'scheduled',values.scheduled_date??null,values.completed_date??null,values.notes??null,values.cost??null,values.status==='completed'?user.userId:null,user.userId])).rows[0];
    } else {
      const keys=Object.keys(values);
      if (!keys.length) fail(400,'INVALID_MAINTENANCE','No maintenance fields to update');
      const params=keys.map(key=>values[key]);
      const assignments=keys.map((key,i)=>`${key}=$${i+1}`);
      if (values.status==='completed' && !existing.performed_by) {params.push(user.userId);assignments.push(`performed_by=$${params.length}`);}
      params.push(entityId);
      result=(await client.query(`UPDATE maintenance_records SET ${assignments.join(',')} WHERE id=$${params.length} RETURNING *`,params)).rows[0];
    }
  }
  await writeAuditLog({req:{user},client,required:true,action:change.operation.toUpperCase(),entityType:'maintenance_record',entityId,oldValue:existing??null,newValue:result,metadata:{change_id:change.change_id}});
  return result;
}
