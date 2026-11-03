import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
function load(snapshot,{web=false,fail=false,change=false,writeFailOnce=false}={}){
 const exports={};let current=true,requests=0,calls=0;const writes=[];
 const invoke=async(command,args)=>{calls++;if(fail)throw Error('SQLITE_FAILURE');if(change)current=false;
  if(command==='save_local_salvage_intent'){writes.push(args.input);if(writeFailOnce&&writes.length===1)throw Error('WRITE_ACK_LOST');return{id:args.input.recovery_id,local_pending_action:args.input.operation};}
  return snapshot;};
 const requireModule=name=>{
  if(name==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current};
  if(name==='./local-backend')return{isLocalBackendAvailable:()=>!web,localBackend:{invoke}};
  if(name==='./http')return{apiFetch:async()=>{requests++;return{ok:true,json:async()=>snapshot};}};
  if(name==='./inventory-http'){
   const module={};
   vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./inventory-http.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module,require:requireModule});
   return module;
  }
  return{};
 };
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./items.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URLSearchParams,crypto:webcrypto,require:requireModule});return{api:exports,requests:()=>requests,calls:()=>calls,writes};
}
test('desktop salvage reads only native snapshots and applies filters',async()=>{
 const c=load({downloaded:true,records:[{id:'a',project_id:'p',quarantine_status:'quarantined'},{id:'b',project_id:'other',quarantine_status:'released'}]});
 assert.equal((await c.api.getSalvageRecoveries({project_id:'p',status:'quarantined'}))[0].id,'a');assert.equal(c.requests(),0);
});
test('unknown, failed and old-account snapshots never use HTTP',async()=>{
 for(const [snapshot,options,pattern] of [[{downloaded:false,records:[]},{},/Synchronize/],[null,{fail:true},/SQLITE_FAILURE/],[{downloaded:true,records:[]},{change:true},/Account changed/]]){
  const c=load(snapshot,options);await assert.rejects(()=>c.api.getSalvageRecoveries(),pattern);assert.equal(c.requests(),0);
 }
 const empty=load({downloaded:true,records:[]});assert.equal((await empty.api.getSalvageRecoveries()).length,0);
});
test('browser salvage keeps server reads',async()=>{
 const c=load([{id:'server'}],{web:true});assert.equal((await c.api.getSalvageRecoveries())[0].id,'server');assert.equal(c.requests(),1);assert.equal(c.calls(),0);
});
test('native writes keep stable identities after uncertain local acknowledgement',async()=>{
 const c=load({downloaded:false,records:[]},{writeFailOnce:true}),record={recovered_item_name:'Board'};
 await assert.rejects(()=>c.api.createSalvageRecovery(record),/WRITE_ACK_LOST/);
 const result=await c.api.createSalvageRecovery(record);
 assert.equal(c.writes[0].change_id,c.writes[1].change_id);assert.equal(c.writes[0].recovery_id,result.id);assert.equal(c.requests(),0);
});
test('native inspect and release carry the reviewed version without refreshing the cached base',async()=>{
 const c=load({downloaded:true,records:[{id:'r',sync_version:'7'}]});
 await c.api.inspectSalvageRecovery('r',{approval:'approved',condition:'good'},3);await c.api.releaseSalvageRecovery('r',3);
 assert.equal(c.writes[0].expected_version,3);assert.equal(c.writes[1].expected_version,3);assert.equal(c.writes[1].operation,'release');assert.equal(c.requests(),0);assert.equal(c.calls(),2);
});
test('own pending creations remain readable before first server snapshot',async()=>{
 const c=load({downloaded:false,pending_count:1,records:[{id:'mine',local_pending_action:'create'}]});
 assert.equal((await c.api.getSalvageRecoveries())[0].id,'mine');assert.equal(c.requests(),0);
});
test('failed native salvage writes never become server writes',async()=>{
 const c=load(null,{fail:true});await assert.rejects(()=>c.api.createSalvageRecovery({}),/SQLITE_FAILURE/);assert.equal(c.requests(),0);
});
test('salvage consumption picker reads only the guarded native cache',async()=>{
 const c=load({downloaded:true,records:[{id:'movement',item_id:'item',movement_type:'consume'}]});
 assert.equal((await c.api.getSalvageSourceMovements('item'))[0].id,'movement');assert.equal(c.requests(),0);
});
test('missing, broken and switched-account source history never falls back to HTTP',async()=>{
 for(const [snapshot,options,pattern] of [[{downloaded:false,records:[]},{},/not been downloaded/],[null,{fail:true},/SQLITE_FAILURE/],[{downloaded:true,records:[]},{change:true},/Account changed/]]){
  const c=load(snapshot,options);await assert.rejects(()=>c.api.getSalvageSourceMovements('item'),pattern);assert.equal(c.requests(),0);
 }
});

test('disassembly batch queues one immutable event with stable output identities on uncertain ACK',async()=>{
 const c=load(null,{writeFailOnce:true});const data={source_quantity:1,attestation_notes:'Old assembly',outputs:[{id:'first',recovered_item_name:'Motor',recovered_quantity:1,unit:'each',recovery_type:'disassembly_output'},{id:'second',recovered_item_name:'Metal',recovered_quantity:2,unit:'kg',recovery_type:'scrap'}]};
 await assert.rejects(()=>c.api.createSalvageBatch(data),/WRITE_ACK_LOST/);await c.api.createSalvageBatch(data);
 assert.equal(c.writes[0].operation,'create_batch');assert.equal(c.writes[0].recovery_id,'first');assert.equal(c.writes[0].change_id,c.writes[1].change_id);
 assert.deepEqual(JSON.parse(JSON.stringify(c.writes[1].record)),data);assert.equal(c.requests(),0);
});
test('native batch failures never turn into direct server writes',async()=>{
 const data={outputs:[{id:'first'},{id:'second'}]};
 const c=load(null,{fail:true});await assert.rejects(()=>c.api.createSalvageBatch(data),/SQLITE_FAILURE/);assert.equal(c.requests(),0);
});
test('custody source reads and linked return intentions stay native and preserve provenance',async()=>{
 const c=load({downloaded:true,records:[{id:'custody',item_id:'item',outstanding_quantity:2}]});assert.equal((await c.api.getSalvageCustodySources('item'))[0].id,'custody');
 await c.api.createSalvageRecovery({source_custody_id:'custody',source_item_id:'item',recovery_type:'equipment_return',source_quantity:1,recovered_quantity:1});
 assert.equal(c.writes[0].record.source_custody_id,'custody');assert.equal(c.requests(),0);
});
test('missing or old-account custody sources do not become server reads',async()=>{
 for(const [snapshot,options,pattern] of [[{downloaded:false,records:[]},{},/not been downloaded/],[null,{fail:true},/SQLITE_FAILURE/],[{downloaded:true,records:[]},{change:true},/Account changed/]]){const c=load(snapshot,options);await assert.rejects(()=>c.api.getSalvageCustodySources('item'),pattern);assert.equal(c.requests(),0);}
});
test('browser custody sources use HTTP without native cache access',async()=>{
 const c=load([{id:'held',item_id:'item',outstanding_quantity:2}],{web:true});
 assert.equal((await c.api.getSalvageCustodySources('item'))[0].id,'held');assert.equal(c.calls(),0);assert.equal(c.requests(),1);
 const malformed=load({records:[]},{web:true});await assert.rejects(()=>malformed.api.getSalvageCustodySources('item'),/Invalid issued custody/);
});
