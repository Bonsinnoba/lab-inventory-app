import {randomUUID} from 'crypto';
import {assertReservationStockFloor} from './reservation-stock.js';
import {getUserPermissions} from './middleware/permissions.js';
function generateItemSku(name, type) {
  const namePart = String(name || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'ITEM';
  const typePart = String(type || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'ITEM';
  return `LAB-${namePart}-${typePart}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_SYNC_PAYLOAD',label+' must be an object');return value;}
function number(value,label){const n=Number(value);if(!Number.isFinite(n))fail(400,'INVALID_SYNC_PAYLOAD',label+' must be numeric');return n;}
function id(value,label){if(typeof value!=='string'||!/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value))fail(400,'INVALID_SYNC_ID',label+' is invalid');return value.replaceAll('-','').toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');}
const ITEM_FIELDS=['name','type','category','sku','initial_quantity','current_quantity','unit','dimensions','status','condition_notes','last_checked_at','unit_cost','replacement_cost','location_id','storage_location','storage_container_id','photo_url','supplier','supplier_id','part_number','acquisition_method','acquisition_source','acquisition_notes','next_maintenance_date','maintenance_interval_days','manufacturer','model_number','serial_number','asset_tag','calibration_interval_days','next_calibration_date','assigned_to','image_resource_id','created_at','updated_at'];
const MOVEMENT_TYPES=new Set(['receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in']); const INCOMING=new Set(['receive','return','repair_in']); const OUTGOING=new Set(['checkout','consume','damage','loss','repair_out']);
async function applyItem(client,change){const payload=object(change.payload,'Item payload'),itemId=id(payload.id||change.entity_id,'Item ID');if(change.operation==='create'){const values=[itemId],columns=['id'];for(const field of ITEM_FIELDS)if((field!=='updated_at'||payload.inventory_protocol!==2)&&Object.prototype.hasOwnProperty.call(payload,field)){columns.push(field);const value=field==='sku' ? (typeof payload[field]==='string'&&payload[field].trim() ? payload[field].trim() : generateItemSku(payload.name,payload.type)) : payload[field];values.push(value??null);}if((await client.query('SELECT id FROM items WHERE id=$1',[itemId])).rowCount)fail(409,'ITEM_ALREADY_EXISTS',`Item ${itemId} already exists`);return(await client.query(`INSERT INTO items (${columns.join(',')}) VALUES (${values.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)).rows[0];}if(change.operation==='update'){const patch=object(payload.patch||payload.item||payload,'Item update'),updates=[],values=[];const before=await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[itemId]);if(!before.rowCount)fail(409,'ITEM_NOT_FOUND',`Item ${itemId} does not exist on the server`);const base=payload.base_updated_at;if(base&&!payload.conflict_resolution&&payload.inventory_protocol!==2){const serverAt=new Date(before.rows[0].updated_at),baseAt=new Date(base);if(Number.isNaN(baseAt.getTime())||Number.isNaN(serverAt.getTime())||serverAt.getTime()!==baseAt.getTime())fail(409,'SYNC_CONFLICT',`Item ${itemId} changed on the server after this offline edit`);}if(payload.conflict_resolution&&payload.conflict_resolution!=='keep_local')fail(400,'INVALID_CONFLICT_RESOLUTION','Unsupported conflict resolution');for(const field of ITEM_FIELDS)if(field!=='id'&&field!=='created_at'&&field!=='updated_at'&&Object.prototype.hasOwnProperty.call(patch,field)){values.push(patch[field]??null);updates.push(`${field}=$${values.length}`);}if(!updates.length)return before.rows[0];if(Object.prototype.hasOwnProperty.call(patch,'current_quantity'))await assertReservationStockFloor(client,itemId,Number(patch.current_quantity));updates.push('updated_at=now()');values.push(itemId);return(await client.query(`UPDATE items SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,values)).rows[0];}if(change.operation==='delete'){const result=await client.query('DELETE FROM items WHERE id=$1 RETURNING id',[itemId]);if(result.rowCount)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('item',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()",[itemId]);return{deleted:Boolean(result.rowCount),id:itemId};}fail(400,'UNSUPPORTED_ITEM_OPERATION',`Unsupported item operation: ${change.operation}`);}
async function applyMovement(client,change,userId){
  const payload={...object(change.payload,'Movement payload')};
  const itemId=id(payload.item_id||change.entity_id,'Movement item ID');
  const movementId=id(payload.id,'Movement ID');
  let type=String(payload.movement_type||'');
  const quantity=number(payload.quantity,'Movement quantity');
  if(!MOVEMENT_TYPES.has(type))fail(400,'INVALID_MOVEMENT_TYPE','Invalid movement type');
  if(quantity<=0)fail(400,'INVALID_QUANTITY','Quantity must be greater than zero');
  const existing=await client.query('SELECT * FROM item_movements WHERE id=$1',[movementId]);
  if(existing.rowCount)fail(409,'MOVEMENT_ALREADY_EXISTS',`Movement ${movementId} already exists`);
  const itemResult=await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[itemId]);
  if(!itemResult.rowCount)fail(409,'ITEM_NOT_FOUND',`Item ${itemId} does not exist on the server`);
  const item=itemResult.rows[0];
  let next=number(item.current_quantity,'Current quantity');
  let custodySettlement = null;
  let custodyRecord = null;
  let custody = null;
  let settlementType = null;
  let recipientId = null;
  let custodyRecordId = null;
  let outstandingUnits = null;
  let quantityUnits = null;
  let reservation = null;
  let fulfilledReservation = null;
  const isCustody = Boolean(payload.custody_id || (type === 'checkout' && payload.recipient_id));
  const units = (value, label) => {
    const n = number(value, label), scaled = n * 1000;
    if (n < 0 || n > 999999999.999 || Math.abs(scaled - Math.round(scaled)) > 0.0001) {
      fail(400, 'INVALID_CUSTODY_QUANTITY', `${label} must be nonnegative with at most three decimal places`);
    }
    return Math.round(scaled);
  };
  if (isCustody) quantityUnits = units(quantity, 'Custody quantity');

  if (payload.custody_id) {
    const custodyId = id(payload.custody_id, 'Custody ID');
    const custodyRes = await client.query('SELECT * FROM item_custody_records WHERE id=$1 FOR UPDATE', [custodyId]);
    if (!custodyRes.rowCount) fail(404, 'CUSTODY_NOT_FOUND', `Custody record ${payload.custody_id} not found`);
    custody = custodyRes.rows[0];
    if (id(custody.item_id, 'Custody item ID') !== itemId) fail(400, 'CUSTODY_ITEM_MISMATCH', 'Custody record belongs to a different item');
    outstandingUnits = units(custody.outstanding_quantity, 'Outstanding custody');
    if (!['issued','partially_settled'].includes(custody.status) || outstandingUnits === 0) fail(409, 'CUSTODY_SETTLED', 'Custody has already been settled');
    if (quantityUnits > outstandingUnits) fail(409, 'EXCESSIVE_SETTLEMENT', `Cannot settle ${quantity}; outstanding balance is ${custody.outstanding_quantity}`);
    if (custody.serial_number && quantity !== 1) fail(400, 'SERIAL_QUANTITY', 'A serialized unit must be settled as one whole unit');

    settlementType = payload.settlement_type || type;
    if (!['return','consume','damage','loss','transfer'].includes(settlementType)) fail(400, 'INVALID_SETTLEMENT_TYPE', 'Unsupported custody settlement');
    // Older desktop intents used consume for explicit damage/loss/transfer.
    // Preserve their meaning, but never infer consumption from an unknown type.
    if (type !== settlementType && !(type === 'consume' && ['damage','loss','transfer'].includes(settlementType))) fail(400, 'SETTLEMENT_TYPE_MISMATCH', 'Movement and settlement types disagree');
    type = settlementType;
    if (settlementType === 'return') {
      next = (units(next, 'Storeroom quantity') + quantityUnits) / 1000;
    } else {
      // Consuming, damaging, losing, or transferring issued custody stock does NOT decrement storeroom stock again.
      next = number(item.current_quantity, 'Current quantity');
    }

    if (settlementType === 'transfer') {
      if (!payload.transfer_recipient_id) fail(400, 'TRANSFER_RECIPIENT_REQUIRED', 'Transfer recipient is required for custody transfer');
      recipientId = id(payload.transfer_recipient_id, 'Transfer recipient ID');
      if (recipientId === id(custody.recipient_id, 'Custody recipient ID')) fail(400, 'SAME_CUSTODY_RECIPIENT', 'Choose a different custody recipient');
      custodyRecordId = movementId;
    } else if (payload.transfer_recipient_id) {
      fail(400, 'INVALID_TRANSFER_RECIPIENT', 'A transfer recipient is only valid for custody transfers');
    }
  } else {
    if (payload.settlement_type || payload.transfer_recipient_id) fail(400, 'CUSTODY_REQUIRED', 'Select the custody record to settle');
    if (payload.reservation_id) {
      if (!isCustody) fail(400,'RESERVATION_CUSTODY_REQUIRED','Reservation-backed issues require checkout with a recipient');
      const reservationId=id(payload.reservation_id,'Reservation ID');
      // Item lock is already held. Keep this order in reservation HTTP writers too.
      reservation=(await client.query('SELECT * FROM project_reservations WHERE id=$1 FOR UPDATE',[reservationId])).rows[0];
      if (!reservation || reservation.item_id!==itemId) fail(409,'RESERVATION_ITEM_MISMATCH','Reservation is unavailable for this inventory item');
      if (!payload.project_id || id(payload.project_id,'Project ID')!==reservation.project_id) fail(400,'RESERVATION_PROJECT_MISMATCH','Issue must reference the reservation project');
      if (reservation.status!=='confirmed' || quantityUnits>units(reservation.quantity,'Remaining reservation')) fail(409,'RESERVATION_QUANTITY_CONFLICT','Issue exceeds the remaining confirmed reservation');
      const authority=(await client.query(`SELECT p.status,p.owner_id,p.visibility,u.role,u.is_active,
        pm.member_role,g.access_level FROM projects p JOIN users u ON u.id=$2
        LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=u.id
        LEFT JOIN record_access_grants g ON g.entity_type='project' AND g.entity_id=p.id AND g.user_id=u.id
        WHERE p.id=$1 FOR SHARE OF p,u`,[reservation.project_id,userId])).rows[0];
      const permissions=authority&&await getUserPermissions(userId,authority.role);
      if (!authority?.is_active || !permissions.has('projects.edit') ||
          (authority.role!=='admin' && (authority.role==='viewer' ||
            (authority.owner_id!==userId&&!['lead','member'].includes(authority.member_role)) ||
            (authority.visibility==='restricted'&&authority.access_level!=='edit')))) {
        fail(403,'RESERVATION_PROJECT_ACCESS_DENIED','Project editor access is required to issue reserved stock');
      }
      if (!['planning','active'].includes(authority.status)) fail(409,'RESERVATION_PROJECT_CLOSED','Project is not open for stock issues');
      payload.project_id=reservation.project_id;
      payload.reservation_id=reservation.id;
      let requirement=payload.requirement_id? id(payload.requirement_id,'Requirement ID'):null;
      for (const [field,table] of [['task_id','project_tasks'],['experiment_id','project_experiments']]) {
        if (!payload[field]) continue;
        payload[field]=id(payload[field],field);
        const work=(await client.query(`SELECT project_id,requirement_id FROM ${table} WHERE id=$1 FOR SHARE`,[payload[field]])).rows[0];
        if (!work || work.project_id!==reservation.project_id) fail(400,'CUSTODY_PROJECT_MISMATCH','Work references must belong to the reservation project');
        if (work.requirement_id) {
          if (requirement && requirement!==work.requirement_id) fail(400,'CUSTODY_REQUIREMENT_MISMATCH','Issue work references disagree on canonical demand');
          requirement=work.requirement_id;
        }
      }
      if (requirement && !(await client.query('SELECT id FROM project_resource_requirements WHERE id=$1 AND project_id=$2 FOR SHARE',[requirement,reservation.project_id])).rowCount) fail(400,'CUSTODY_REQUIREMENT_MISMATCH','Requirement must belong to the reservation project');
      payload.requirement_id=requirement;
    }
    if (INCOMING.has(type)) next += quantity;
    else if (OUTGOING.has(type)) next -= quantity;
    else if (type === 'adjust') next = quantity;

    if (isCustody) next = (units(item.current_quantity, 'Storeroom quantity') - quantityUnits) / 1000;

    if (next < 0) fail(409, 'INSUFFICIENT_STOCK', 'Movement would make stock negative');
    // Only the validated matching allocation is fulfilled by this issue.
    await assertReservationStockFloor(client, itemId, reservation ? (units(next,'Remaining stock')+quantityUnits)/1000 : next);

    if (type === 'checkout' && payload.recipient_id) {
      recipientId = id(payload.recipient_id, 'Recipient ID');
      custodyRecordId = payload.custody_record_id ? id(payload.custody_record_id, 'New custody ID') : movementId;
      if (payload.serial_number && quantity !== 1) fail(400, 'SERIAL_QUANTITY', 'Issue serialized equipment one unit at a time');
    }
  }

  if (recipientId) {
    const recipient = await client.query('SELECT id FROM users WHERE id=$1 AND is_active=true FOR SHARE', [recipientId]);
    if (!recipient.rowCount) fail(409, 'RECIPIENT_UNAVAILABLE', 'Custody recipient is not an active account');
  }
  if (isCustody && (next < 0 || next > 999999999.999)) fail(400, 'INVALID_CUSTODY_QUANTITY', 'Movement exceeds the supported stock range');
  // A recipient transfer moves issued units, not the remaining storeroom item.
  const locationTransfer = type === 'transfer' && !custody;
  const destinationStorage=locationTransfer?(payload.to_storage_location?String(payload.to_storage_location).trim():null):(item.storage_location??null);
  const destinationLocation=custody?(item.location_id||null):locationTransfer?(payload.to_location_id||item.location_id||null):(payload.to_location_id||null);
  if(type==='transfer'&&!destinationStorage&&!destinationLocation&&!payload.custody_id)fail(400,'TRANSFER_LOCATION_REQUIRED','A destination location is required for transfers');
  const movement=(await client.query(`INSERT INTO item_movements (id,item_id,movement_type,quantity,quantity_before,quantity_after,from_location_id,to_location_id,from_storage_location,to_storage_location,project_id,reason,reference,performed_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,now())) RETURNING *`,[movementId,itemId,type,quantity,Number(item.current_quantity),next,item.location_id||null,destinationLocation,item.storage_location||null,destinationStorage,(custody ? custody.project_id : payload.project_id)||null,payload.reason||null,payload.reference||null,userId,payload.created_at||null])).rows[0];
  if (reservation) {
    const remaining=(units(reservation.quantity,'Remaining reservation')-quantityUnits)/1000;
    fulfilledReservation=(await client.query(`UPDATE project_reservations SET quantity=$1,
      fulfilled_quantity=fulfilled_quantity+$2,status=CASE WHEN $1::numeric=0 THEN 'fulfilled' ELSE 'confirmed' END,
      fulfilled_at=CASE WHEN $1::numeric=0 THEN now() ELSE fulfilled_at END,
      fulfilled_by=$3,fulfillment_movement_id=$4,updated_at=now() WHERE id=$5 RETURNING *`,
      [remaining,quantity,userId,movementId,reservation.id])).rows[0];
    await client.query(`INSERT INTO project_reservation_fulfillments(reservation_id,movement_id,quantity,performed_by,request_id)
      VALUES($1,$2,$3,$4,$2)`,[reservation.id,movementId,quantity,userId]);
  }
  // Foreign keys are intentionally immediate. Dependent rows must follow the
  // movement insert, inside the caller's existing transaction/receipt boundary.
  if (custodyRecordId) {
    const source = custody || payload;
    custodyRecord = (await client.query(`
      INSERT INTO item_custody_records (
        id,item_id,source_movement_id,project_id,task_id,experiment_id,requirement_id,reservation_id,
        recipient_id,issued_by,initial_quantity,outstanding_quantity,unit,serial_number,status,notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'issued',$15) RETURNING *
    `, [custodyRecordId,itemId,movementId,source.project_id||null,source.task_id||null,source.experiment_id||null,
      source.requirement_id||null,source.reservation_id||null,recipientId,userId,quantity,quantity,
      custody ? custody.unit : item.unit||null,source.serial_number||null,payload.notes||payload.reason||null])).rows[0];
  }
  if (custody) {
    const newOutstanding = (outstandingUnits - quantityUnits) / 1000;
    await client.query(`UPDATE item_custody_records SET outstanding_quantity=$1::numeric,status=$2,
      settled_at=(CASE WHEN $1::numeric = 0 THEN now() ELSE settled_at END),updated_at=now() WHERE id=$3`,
      [newOutstanding,newOutstanding===0?'settled':'partially_settled',custody.id]);
    custodySettlement = (await client.query(`INSERT INTO item_custody_settlements
      (id,custody_id,settlement_type,quantity,performed_by,transfer_recipient_id,movement_id,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [movementId,custody.id,settlementType,quantity,userId,recipientId,movementId,payload.notes||payload.reason||null])).rows[0];
  }
  const updated=(await client.query('UPDATE items SET current_quantity=$1,storage_location=$2,location_id=COALESCE($3,location_id),updated_at=now() WHERE id=$4 RETURNING *',[next,destinationStorage,destinationLocation,itemId])).rows[0];
  return { movement, item: updated, custody_record: custodyRecord, custody_settlement: custodySettlement, reservation: fulfilledReservation };
}
export async function applyInventoryRaw(client,change,userId){if(change.operation==='bulk_status'){const p=object(change.payload,'Bulk status payload');const ids=Array.isArray(p.ids)?p.ids:[];if(!ids.length||typeof p.status!=='string')fail(400,'INVALID_BULK_STATUS','ids and status are required');return{updated:Number((await client.query('UPDATE items SET status=$1,updated_at=now() WHERE id=ANY($2::uuid[])',[p.status,ids])).rowCount)};}if(change.operation==='bulk_delete'){const p=object(change.payload,'Bulk delete payload');const ids=Array.isArray(p.ids)?p.ids:[];if(!ids.length)return{deleted:0};const result=await client.query('DELETE FROM items WHERE id=ANY($1::uuid[]) RETURNING id', [ids]);for(const row of result.rows)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('item',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()",[row.id]);return{deleted:Number(result.rowCount)};}if(change.entity_type==='item')return applyItem(client,change);if(change.entity_type==='item_movement'&&change.operation==='create')return applyMovement(client,change,userId);fail(400,'UNSUPPORTED_SYNC_CHANGE',`Unsupported sync change: ${change.entity_type}/${change.operation}`);}
