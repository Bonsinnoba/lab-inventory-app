function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}

// Caller owns the transaction. Lock the recovery first to serialize release
// retries; no other writer may credit stock without holding this same row.
export async function releaseSalvage(client,recoveryId,actor){
 const recovery=(await client.query('SELECT * FROM item_salvage_recoveries WHERE id=$1 FOR UPDATE',[recoveryId])).rows[0];
 if(!recovery)fail(404,'SALVAGE_NOT_FOUND','Salvage record not found');
 await requireSalvageMutation(client,recovery.project_id,actor,'inventory.adjust_stock');
 if(recovery.quarantine_status==='released')return recovery;
 if(recovery.quarantine_status!=='inspected_approved')fail(409,'QUARANTINE_NOT_APPROVED','Material must be inspected and approved before release');
 if(recovery.condition==='uninspected'||(recovery.condition==='scrap'&&recovery.recovery_type!=='scrap'))
  fail(409,'SALVAGE_CONDITION_NOT_USABLE','Record the inspected condition before releasing usable stock');
 if(recovery.source_custody_id)return releaseCustodyReturn(client,recovery,actor);
 if(recovery.source_movement_id){
  // All recovery releases of one source serialize here. Pending proposals do
  // not consume a claim; only actual released source quantities count.
  const source=(await client.query('SELECT * FROM item_movements WHERE id=$1 FOR UPDATE',[recovery.source_movement_id])).rows[0];
  if(!source||source.movement_type!=='consume'||source.item_id!==recovery.source_item_id||source.project_id!==recovery.project_id)
   fail(409,'SALVAGE_SOURCE_MISMATCH','Recovery must reference the consumed item and its original project');
  if(recovery.batch_id){
   const batch=(await client.query('SELECT * FROM item_salvage_batches WHERE id=$1',[recovery.batch_id])).rows[0];
   if(!batch||batch.source_item_id!==recovery.source_item_id||batch.source_movement_id!==source.id||batch.project_id!==recovery.project_id||Number(batch.source_quantity)!==Number(recovery.source_quantity))
    fail(409,'SALVAGE_BATCH_SOURCE_MISMATCH','Recovery output no longer matches its batch source');
  }
  const exceeds=(await client.query(`SELECT
    COALESCE((SELECT SUM(source_quantity) FROM item_salvage_recoveries WHERE source_movement_id=$1 AND batch_id IS NULL AND quarantine_status='released'),0)
    +COALESCE((SELECT SUM(b.source_quantity) FROM item_salvage_batches b WHERE b.source_movement_id=$1 AND EXISTS(SELECT 1 FROM item_salvage_recoveries r WHERE r.batch_id=b.id AND r.quarantine_status='released')),0)
    +CASE WHEN $4::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM item_salvage_recoveries WHERE batch_id=$4 AND quarantine_status='released') THEN 0 ELSE $2::numeric END
    >$3::numeric AS exceeded`,
   [source.id,recovery.source_quantity,source.quantity,recovery.batch_id])).rows[0].exceeded;
  if(exceeds)fail(409,'SALVAGE_SOURCE_EXHAUSTED','Recovered source quantity exceeds the recorded consumption remaining for recovery');
 }else if(!String(recovery.attestation_notes||'').trim()){
  fail(409,'SALVAGE_ATTESTATION_REQUIRED','Unknown historical source requires explicit human attestation before release');
 }
 if(['unused_stock_return','equipment_return'].includes(recovery.recovery_type)&&recovery.source_item_id){
  await client.query('SELECT id FROM items WHERE id=$1 FOR UPDATE',[recovery.source_item_id]);
  const custody=(await client.query("SELECT 1 FROM item_custody_records WHERE item_id=$1 AND outstanding_quantity>0 LIMIT 1",[recovery.source_item_id])).rowCount;
  if(custody)fail(409,'SALVAGE_CUSTODY_RETURN_REQUIRED','Return issued stock through its custody record so the outstanding balance is settled');
 }
 let itemId=recovery.recovery_type==='scrap'?null:recovery.recovered_item_id;
 if(recovery.recovery_type!=='scrap'){
  let before='0',after;
  if(itemId){
   const item=(await client.query('SELECT current_quantity,status,unit FROM items WHERE id=$1 FOR UPDATE',[itemId])).rows[0];
   if(!item)fail(409,'SALVAGE_DESTINATION_MISSING','Recovered inventory item no longer exists');
   if(item.status==='retired')fail(409,'SALVAGE_DESTINATION_RETIRED','Choose an active inventory destination');
   if(item.unit&&recovery.unit&&item.unit!==recovery.unit)fail(409,'SALVAGE_UNIT_MISMATCH','Recovery and destination units must match');
   if(recovery.condition==='damaged_repairable'&&item.status!=='needs_repair')fail(409,'SALVAGE_CONDITION_MISMATCH','Damaged material requires a repair-only inventory destination');
   if(recovery.condition!=='damaged_repairable'&&!usableStock(item.status))fail(409,'SALVAGE_DESTINATION_UNUSABLE','Usable recovered material requires a usable inventory destination');
   before=item.current_quantity;
   after=(await client.query('UPDATE items SET current_quantity=current_quantity+$1,updated_at=now() WHERE id=$2 RETURNING current_quantity',[recovery.recovered_quantity,itemId])).rows[0].current_quantity;
  }else{
   const source=recovery.source_item_id?(await client.query('SELECT type FROM items WHERE id=$1',[recovery.source_item_id])).rows[0]:null;
   const type=recovery.recovery_type==='equipment_return'&&source?source.type:'component';
   const created=(await client.query(`INSERT INTO items(name,type,status,initial_quantity,current_quantity,unit,acquisition_method,acquisition_source,acquisition_notes)
    VALUES($1,$2,$3,$4,$4,$5,'salvaged','Salvage quarantine release',$6) RETURNING id,current_quantity`,
    [recovery.recovered_item_name,type,recovery.condition==='damaged_repairable'?'needs_repair':'available',recovery.recovered_quantity,recovery.unit,`Recovery ${recovery.id}`])).rows[0];
   itemId=created.id;after=created.current_quantity;
  }
  // Reviewed recovery valuation stays on the recovery. It is neither purchase
  // cost nor replacement cost and does not create any cash transaction.
  await client.query(`INSERT INTO item_movements(item_id,movement_type,quantity,quantity_before,quantity_after,project_id,reason,reference,performed_by)
   VALUES($1,'receive',$2,$3,$4,$5,'Quarantine salvage release',$6,$7)`,
   [itemId,recovery.recovered_quantity,before,after,recovery.project_id,`salvage:${recovery.id}`,actor]);
 }
 return (await client.query("UPDATE item_salvage_recoveries SET quarantine_status='released',recovered_item_id=$1,updated_at=now() WHERE id=$2 RETURNING *",[itemId,recoveryId])).rows[0];
}
import {requireSalvageMutation} from './salvage-access.js';
import {releaseCustodyReturn} from './salvage-custody-return.js';
import {usableStock} from './stock-condition.js';
