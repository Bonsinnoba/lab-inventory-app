import {applyInventoryMutation} from './inventory-sync.js';
import {usableStock} from './stock-condition.js';
import {randomUUID} from 'node:crypto';
const fail=(code,message)=>{throw Object.assign(Error(message),{status:409,code});};

// Caller owns recovery lock and transaction. Follow normal inventory writer lock
// ordering (advisory -> item -> custody), never custody -> item.
export async function releaseCustodyReturn(client,recovery,actor){
 if(recovery.batch_id||recovery.source_movement_id||!['equipment_return','unused_stock_return'].includes(recovery.recovery_type))fail('SALVAGE_CUSTODY_SOURCE_INVALID','Custody return cannot also be a consumption or disassembly claim');
 const damaged=recovery.condition==='damaged_repairable';
 if(!damaged&&!['like_new','good','fair'].includes(recovery.condition))fail('SALVAGE_CUSTODY_CONDITION','Inspect the material before returning it to usable stock');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['inventory:'+recovery.source_item_id]);
 const item=(await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[recovery.source_item_id])).rows[0];
 const custody=(await client.query('SELECT * FROM item_custody_records WHERE id=$1 FOR UPDATE',[recovery.source_custody_id])).rows[0];
 if(!item||(!damaged&&!usableStock(item.status)))fail('SALVAGE_DESTINATION_UNUSABLE','Usable return requires the original active, usable inventory item');
 if(!custody||custody.item_id!==item.id||custody.project_id!==recovery.project_id||Number(recovery.source_quantity)!==Number(recovery.recovered_quantity)||custody.unit!==recovery.unit||(item.unit||null)!==(custody.unit||null)||(recovery.recovered_item_id&&recovery.recovered_item_id!==item.id))fail('SALVAGE_CUSTODY_SOURCE_INVALID','Return must preserve the issued item, project, unit and quantity');
 const role=(await client.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0]?.role;
 if(recovery.repair_received_at){
  // The holder was already settled at damaged intake. Never settle or debit it
  // again; only a fresh, documented inspection permits stock to return.
  const fresh=(await client.query('SELECT inspected_at > repair_received_at AS fresh FROM item_salvage_recoveries WHERE id=$1',[recovery.id])).rows[0]?.fresh;
  if(damaged||!recovery.repair_verification_notes?.trim()||!fresh)fail('SALVAGE_REPAIR_INSPECTION_REQUIRED','Record a fresh usable-condition inspection and repair verification');
  const settlement=(await client.query('SELECT * FROM item_custody_settlements WHERE id=$1',[recovery.custody_settlement_id])).rows[0];
  if(!settlement||settlement.custody_id!==custody.id||settlement.settlement_type!=='damage'||Number(settlement.quantity)!==Number(recovery.recovered_quantity))fail('SALVAGE_REPAIR_SETTLEMENT_INVALID','Repair intake must match the original recorded damage settlement');
  await applyInventoryMutation(client,{entity_type:'item_movement',entity_id:item.id,operation:'create',payload:{
   inventory_protocol:2,item_bases:[{id:item.id,version:Number(item.sync_version)}],id:randomUUID(),item_id:item.id,
   movement_type:'receive',quantity:Number(recovery.recovered_quantity),project_id:recovery.project_id,
   reference:`salvage-repair:${recovery.id}`,reason:'Inspected repaired custody return',notes:recovery.repair_verification_notes
  }},{userId:actor,role});
  return(await client.query("UPDATE item_salvage_recoveries SET quarantine_status='released',recovered_item_id=$1,repair_completed_at=clock_timestamp(),updated_at=now() WHERE id=$2 RETURNING *",[item.id,recovery.id])).rows[0];
 }
 const result=await applyInventoryMutation(client,{entity_type:'item_movement',entity_id:item.id,operation:'create',change_id:`salvage-return:${recovery.id}`,payload:{
  inventory_protocol:2,item_bases:[{id:item.id,version:Number(item.sync_version)}],id:recovery.id,item_id:item.id,
  movement_type:damaged?'damage':'return',settlement_type:damaged?'damage':'return',custody_id:custody.id,quantity:Number(recovery.recovered_quantity),
  reference:`salvage:${recovery.id}`,reason:damaged?'Damaged custody intake into repair quarantine':'Inspected custody return',notes:`Recovery ${recovery.id}`
 }},{userId:actor,role});
 if(damaged)return(await client.query("UPDATE item_salvage_recoveries SET quarantine_status='quarantined',custody_settlement_id=$1,repair_received_at=clock_timestamp(),repair_verification_notes=NULL,updated_at=now() WHERE id=$2 RETURNING *",[result.custody_settlement.id,recovery.id])).rows[0];
 return(await client.query("UPDATE item_salvage_recoveries SET quarantine_status='released',recovered_item_id=$1,custody_settlement_id=$2,updated_at=now() WHERE id=$3 RETURNING *",[item.id,result.custody_settlement.id,recovery.id])).rows[0];
}
