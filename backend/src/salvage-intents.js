import {requireSalvageMutation} from './salvage-access.js';
import {releaseSalvage} from './salvage-release.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
export function salvagePermission(operation){return ['create','create_batch'].includes(operation)?'inventory.create':operation==='release'?'inventory.adjust_stock':'inventory.edit';}
const uuid=(value)=>{if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail(400,'SALVAGE_ID_INVALID','Valid recovery reference required');return value.toLowerCase();};
const text=(value,max=4000)=>{if(value==null)return null;if(typeof value!=='string'||value.length>max)fail(400,'SALVAGE_TEXT_INVALID','Recovery text is invalid or too long');return value;};
const quantity=value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>999999999.999||Math.abs(n*1000-Math.round(n*1000))>0.0001)fail(400,'INVALID_QUANTITY','Positive quantity with at most three decimals required');return n;};
export async function applySalvageIntent(client,change,user){
 const id=uuid(change.entity_id),operation=change.operation,payload=change.payload||{},record=payload.record||{};
 if(!['create','create_batch','inspect','release'].includes(operation))fail(400,'SALVAGE_OPERATION_INVALID','Unsupported salvage operation');
 if(operation==='create_batch'){
  if(record.source_custody_id)fail(400,'SALVAGE_CUSTODY_SOURCE_INVALID','Settle issued custody before dismantling material');
  const outputs=record.outputs;
  if(!Array.isArray(outputs)||outputs.length<2||outputs.length>25)fail(400,'SALVAGE_BATCH_INVALID','A disassembly batch requires 2 to 25 outputs');
  const ids=outputs.map(output=>uuid(output?.id));
  if(ids[0]!==id||new Set(ids).size!==ids.length)fail(400,'SALVAGE_BATCH_INVALID','Batch outputs require unique stable identities; first output identifies the batch');
  const records=[];
  // The caller's sync transaction commits the batch, all outputs and its receipt
  // together. Outputs cannot override their common provenance or source claim.
  for(const [index,output] of outputs.entries()){
   if(!output||typeof output!=='object'||!['disassembly_output','scrap'].includes(output.recovery_type))fail(400,'SALVAGE_BATCH_INVALID','Batch outputs must be dismantled material or scrap');
   records.push(await applySalvageIntent(client,{entity_id:ids[index],operation:'create',payload:{record:{
    source_item_id:record.source_item_id,source_movement_id:record.source_movement_id,project_id:record.project_id,
    source_quantity:record.source_quantity,attestation_notes:record.attestation_notes,
    recovered_item_name:output.recovered_item_name,recovered_quantity:output.recovered_quantity,unit:output.unit,
    recovery_type:output.recovery_type,condition:'uninspected'
   }}},user));
  }
  const first=records[0];
  await client.query(`INSERT INTO item_salvage_batches(id,source_item_id,project_id,source_movement_id,source_quantity,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[id,first.source_item_id,first.project_id,first.source_movement_id,first.source_quantity,user.userId]);
  const linked=await client.query('UPDATE item_salvage_recoveries SET batch_id=$1 WHERE id=ANY($2::uuid[]) RETURNING *',[id,ids]);
  return {id,records:linked.rows};
 }
 if(operation==='create'){
  if((await client.query('SELECT 1 FROM item_salvage_recoveries WHERE id=$1',[id])).rowCount)fail(409,'SALVAGE_ID_COLLISION','Recovery identity already exists');
  let source=record.source_item_id?uuid(record.source_item_id):null,project=record.project_id?uuid(record.project_id):null;
  const movement=record.source_movement_id?uuid(record.source_movement_id):null;
  const custodyId=record.source_custody_id?uuid(record.source_custody_id):null;
  let unit=text(record.unit,100);
  if(custodyId){
   if(movement||!['equipment_return','unused_stock_return'].includes(record.recovery_type))fail(400,'SALVAGE_CUSTODY_SOURCE_INVALID','Custody requires an explicit return without a consumption claim');
   const custody=(await client.query('SELECT * FROM item_custody_records WHERE id=$1',[custodyId])).rows[0];
   if(!custody||source&&source!==custody.item_id||project&&project!==custody.project_id||unit!=null&&unit!==custody.unit)fail(409,'SALVAGE_CUSTODY_SOURCE_INVALID','Select the issued item and its original project/unit');
   if(!['issued','partially_settled'].includes(custody.status)||quantity(record.source_quantity)!==quantity(record.recovered_quantity)||quantity(record.recovered_quantity)>Number(custody.outstanding_quantity)||custody.serial_number&&quantity(record.recovered_quantity)!==1)fail(409,'EXCESSIVE_SETTLEMENT','Return must fit the remaining issued quantity and serialized unit');
   source=custody.item_id;project=custody.project_id;unit=custody.unit;
  }
  if(movement){
   const original=(await client.query('SELECT item_id,project_id,movement_type FROM item_movements WHERE id=$1 FOR SHARE',[movement])).rows[0];
   if(!original||original.movement_type!=='consume'||source&&source!==original.item_id||project&&project!==original.project_id)fail(409,'SALVAGE_SOURCE_MISMATCH','Select the original consumed item/project');
   source=original.item_id;project=original.project_id;
  }
  await requireSalvageMutation(client,project,user.userId,salvagePermission(operation));
  const notes=text(record.attestation_notes);
  if(!movement&&!custodyId&&!notes?.trim())fail(400,'ATTESTATION_REQUIRED','Unknown historical source requires human attestation');
  const name=text(record.recovered_item_name,1000)?.trim(),type=record.recovery_type;
  if(!name||!['unused_stock_return','equipment_return','component_recovery','disassembly_output','scrap'].includes(type))fail(400,'SALVAGE_INPUT_INVALID','Recovery name and type required');
  const condition=record.condition||'uninspected';
  if(!['uninspected','like_new','good','fair','damaged_repairable','scrap'].includes(condition))fail(400,'INVALID_CONDITION','Invalid condition');
  return(await client.query(`INSERT INTO item_salvage_recoveries(id,source_item_id,project_id,source_movement_id,recovery_type,recovered_item_name,source_quantity,recovered_quantity,unit,condition,valuation_notes,attestation_notes,quarantined_by,source_custody_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[id,source,project,movement,type,name,quantity(record.source_quantity),quantity(record.recovered_quantity),unit,condition,text(record.valuation_notes),notes,user.userId,custodyId])).rows[0];
 }
 const current=(await client.query('SELECT * FROM item_salvage_recoveries WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!current)fail(409,'SALVAGE_NOT_FOUND','Synchronize the recovery before reviewing it');
 await requireSalvageMutation(client,current.project_id,user.userId,salvagePermission(operation));
 if(!Number.isSafeInteger(payload.expected_version)||Number(current.sync_version)!==payload.expected_version)fail(409,'SALVAGE_VERSION_CONFLICT','Recovery changed; retain your review and synchronize before retrying');
 if(operation==='release')return releaseSalvage(client,id,user.userId);
 if(current.quarantine_status==='released')fail(409,'ALREADY_RELEASED','Released material cannot be re-inspected');
 if(!['approved','rejected'].includes(record.approval))fail(400,'INVALID_APPROVAL','Inspection approval required');
 const condition=record.condition??current.condition;
 if(!['uninspected','like_new','good','fair','damaged_repairable','scrap'].includes(condition))fail(400,'INVALID_CONDITION','Invalid condition');
 const valuation=record.reviewed_valuation==null?current.reviewed_valuation:Number(record.reviewed_valuation);
 const repairNotes=text(record.repair_verification_notes);
 if(current.repair_received_at&&record.approval==='approved'&&['like_new','good','fair'].includes(condition)&&!repairNotes?.trim())fail(400,'SALVAGE_REPAIR_NOTES_REQUIRED','Describe the completed repair and verification before approving usable condition');
 if(valuation!=null&&(!Number.isFinite(Number(valuation))||Number(valuation)<0||Number(valuation)>9999999999.99))fail(400,'INVALID_VALUATION','Invalid reviewed value');
 return(await client.query(`UPDATE item_salvage_recoveries SET quarantine_status=$1,condition=$2,reviewed_valuation=$3,valuation_notes=COALESCE($4,valuation_notes),attestation_notes=COALESCE($5,attestation_notes),inspected_by=$6,inspected_at=clock_timestamp(),updated_at=now(),repair_verification_notes=COALESCE($8,repair_verification_notes) WHERE id=$7 RETURNING *`,
  [record.approval==='approved'?'inspected_approved':'inspected_rejected',condition,valuation,text(record.valuation_notes),text(record.attestation_notes),user.userId,id,repairNotes])).rows[0];
}
