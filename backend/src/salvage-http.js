import {pool} from './db.js';
import {catalogUuid} from './catalog-sync.js';
import {applySalvageIntent,salvagePermission} from './salvage-intents.js';
import {requireSalvageMutation} from './salvage-access.js';
import {writeAuditLog} from './middleware/audit.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const createFields=['source_item_id','project_id','source_movement_id','source_custody_id','recovery_type','recovered_item_name','source_quantity','recovered_quantity','unit','condition','valuation_notes','attestation_notes'];
const inspectFields=['approval','condition','reviewed_valuation','valuation_notes','attestation_notes','repair_verification_notes'];

// Browser transport only. Desktop callers continue to use the native outbox.
// Reuse the same domain handler and commit audit + receipt with its effects.
export function salvageHttpMutation(operation){
 return async(req,res,next)=>{
  let client;
  try{
   const body=req.body||{},key=catalogUuid(req.get('Idempotency-Key'));
   const creating=['create','create_batch'].includes(operation);
   const id=catalogUuid(creating?body.id:req.params.id);
   const record={};
   for(const field of creating?[...createFields,...(operation==='create_batch'?['outputs']:[])]:operation==='inspect'?inspectFields:[]){
    if(Object.hasOwn(body,field))record[field]=body[field];
   }
   const payload={record};
   if(!creating){
    if(!Number.isSafeInteger(body.expected_version)||body.expected_version<1)fail(400,'SALVAGE_VERSION_REQUIRED','Refresh the recovery and supply its displayed version');
    payload.expected_version=body.expected_version;
   }
   client=await pool.connect();await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
   await requireSalvageMutation(client,null,req.user.userId,'inventory.view');
   const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[key])).rows[0];
   let result;
   if(prior){
    const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
    if(prior.user_id!==req.user.userId||prior.device_id!=='salvage-http'||prior.entity_type!=='salvage_recovery'||prior.entity_id!==id||prior.operation!==operation||!same)
     fail(409,'IDEMPOTENCY_MISMATCH','This retry key belongs to a different recovery action');
    // A receipt cannot grant stale access after revocation or record deletion.
    const current=(await client.query('SELECT * FROM item_salvage_recoveries WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!current)fail(409,'SALVAGE_NOT_FOUND','Recovery is no longer available');
    await requireSalvageMutation(client,current.project_id,req.user.userId,salvagePermission(operation));
    if(operation==='create_batch'){
     const rows=(await client.query('SELECT * FROM item_salvage_recoveries WHERE batch_id=$1 ORDER BY id FOR UPDATE',[id])).rows;
     const outputs=payload.record.outputs;
     if(!Array.isArray(outputs)||rows.length!==outputs.length)fail(409,'SALVAGE_BATCH_CHANGED','Batch membership changed; refresh before continuing');
     const byId=new Map(rows.map(row=>[row.id,row]));
     const records=[];
     for(const output of outputs){
      const row=byId.get(catalogUuid(output.id));
      if(!row)fail(409,'SALVAGE_BATCH_CHANGED','Batch membership changed; refresh before continuing');
      await requireSalvageMutation(client,row.project_id,req.user.userId,salvagePermission(operation));
      records.push(row);
     }
     result={id,records};
    }else result=current;
   }else{
    result=await applySalvageIntent(client,{entity_id:id,operation,payload},req.user);
    await writeAuditLog({req,action:`salvage:${operation}`,entityType:'salvage_recovery',entityId:id,newValue:result,client,required:true});
    await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'salvage-http',$2,'salvage_recovery',$3,$4,$5,$6,$7)",
     [key,req.user.userId,id,operation,payload,result,creating?201:200]);
   }
   await client.query('COMMIT');
   res.status(creating?201:200).json(result);
  }catch(error){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
   if(['23503','23505','23514','22P02','22003'].includes(error.code))return res.status(409).json({error:{code:'SALVAGE_CONSTRAINT',message:'Recovery conflicts with current records; no changes were applied'}});
   next(error);
  }finally{client?.release();}
 };
}
