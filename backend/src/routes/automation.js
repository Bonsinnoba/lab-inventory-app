import {Router} from 'express';
import {pool} from '../db.js';
import {hasPermission} from '../middleware/permissions.js';
import {writeAuditLog} from '../middleware/audit.js';
import {catalogUuid} from '../catalog-sync.js';
import {automationDue,authorizeAutomationRun,applyAutomationRun} from '../automation-run.js';
const router=Router();
router.get('/due',hasPermission('automation.view'),async(req,res,next)=>{
 try{res.setHeader('Cache-Control','no-store');res.json(await automationDue(pool,req.user));}catch(error){next(error);}
});
router.post('/run',hasPermission('automation.run'),async(req,res,next)=>{
 let client;
 try{
  const runId=catalogUuid(req.get('Idempotency-Key'));
  const change={entity_id:runId,operation:'run',payload:{run_id:runId}};
  client=await pool.connect();await client.query('BEGIN');
  await authorizeAutomationRun(client,req.user.userId);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+runId]);
  const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[runId])).rows[0];
  let result;
  if(prior){
   if(prior.user_id!==req.user.userId||prior.device_id!=='automation-http'||prior.entity_type!=='automation_run'||prior.entity_id!==runId||prior.operation!=='run')throw Object.assign(Error('Retry key belongs to another operation'),{status:409,code:'IDEMPOTENCY_MISMATCH'});
   result=prior.response_json;
  }else{
   result=await applyAutomationRun(client,change,req.user);
   await writeAuditLog({req,action:'automation:run',entityType:'automation_run',entityId:runId,newValue:result,client,required:true});
   await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'automation-http',$2,'automation_run',$1,'run',$3,$4,200)",[runId,req.user.userId,change.payload,result]);
  }
  await client.query('COMMIT');res.json(result);
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});next(error);}finally{client?.release();}
});
export default router;
