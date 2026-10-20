import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const input={projectId:'p',reservationId:'r',recipientId:'u',quantity:2};
function setup(overrides={}) {
 let generation=0;const writes=[],exports={};
 const deps={permissions:['projects.edit','inventory.adjust_stock'],reservations:[{id:'r',project_id:'p',item_id:'i',status:'confirmed',quantity:3}],items:[{id:'i',current_quantity:5,sync_version:7}],recipients:[{id:'u'}],...overrides};
 const code=ts.transpileModule(readFileSync(new URL('./reservation-checkout.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>({generation}),isAccountSessionCurrent:s=>s.generation===generation,getCurrentPermissions:async()=>deps.permissions};
  if(name==='./projects')return{getProjectReservations:async()=>{if(deps.switchAccount)generation++;return deps.reservations}};
  if(name==='./items')return{getItems:async()=>deps.items,getAssigneeDirectory:async()=>deps.recipients,createItemMovement:async(...args)=>{writes.push(args);if(deps.fail)throw Error('SQLite failed');return{movement:{id:'saved'}}}};
  throw Error(name);
 }});return{issue:exports.issueReservedStock,writes};
}
test('reserved checkout carries project, allocation, recipient and inventory version',async()=>{
 const c=setup();await c.issue({...input,serialNumber:'',reason:' handover '});
 assert.equal(c.writes.length,1);const [item,payload,version]=c.writes[0];
 assert.equal(item,'i');assert.equal(version,7);assert.equal(payload.movement_type,'checkout');
 assert.equal(payload.project_id,'p');assert.equal(payload.reservation_id,'r');assert.equal(payload.recipient_id,'u');assert.equal(payload.quantity,2);assert.equal(payload.reason,'handover');
});
test('invalid quantity, missing recipient and fractional serialized issues never write',async()=>{
 for(const patch of [{quantity:0},{quantity:NaN},{quantity:0.0001},{recipientId:''},{serialNumber:'S1',quantity:2}]){
  const c=setup();await assert.rejects(c.issue({...input,...patch}));assert.equal(c.writes.length,0);
 }
});
test('changed reservation, stock, permissions, directory or account prevents checkout',async()=>{
 for(const overrides of [{permissions:[]},{reservations:[]},{reservations:[{id:'r',project_id:'p',item_id:'i',status:'released',quantity:3}]},{reservations:[{id:'r',project_id:'p',item_id:'i',status:'confirmed',quantity:1}]},{items:[]},{items:[{id:'i',current_quantity:1}]},{recipients:[]},{switchAccount:true}]){
  const c=setup(overrides);await assert.rejects(c.issue(input));assert.equal(c.writes.length,0);
 }
});
test('failed native movement is surfaced without an automatic second write',async()=>{
 const c=setup({fail:true});await assert.rejects(c.issue(input),/SQLite failed/);assert.equal(c.writes.length,1);
});
