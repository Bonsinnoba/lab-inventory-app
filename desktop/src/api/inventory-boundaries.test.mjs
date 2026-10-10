import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const id='20000000-0000-4000-8000-000000000001';
const initial=[{id,name:'Stock',type:'component',status:'available',current_quantity:10,initial_quantity:10,updated_at:'2026-01-01T00:00:00Z'}];
function load(invoke,fetch,{token='test',online=true}={}){
  let account='a';const session=()=>({accountId:account,token}),modules={};let requests=0;
  const get=name=>{
    if(modules[name])return modules[name];const exports={};modules[name]=exports;
    const js=ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,URLSearchParams,navigator:{onLine:online},crypto:{randomUUID},require:p=>{
      if(p==='@tauri-apps/api/tauri')return{invoke};
      if(p==='./auth')return{captureAccountSession:session,isAccountSessionCurrent:s=>!!s&&s.accountId===account};
      if(p==='./local-backend')return{isLocalBackendAvailable:()=>true};
      if(p==='./item-sku')return{ensureItemSku:()=> 'test'};
      if(p==='./maintenance')return{};
      if(p==='./http')return{apiFetch:async(...args)=>{requests++;if(fetch)return fetch(...args);throw Error('Unexpected HTTP')},getApiErrorMessage:async()=> 'error'};
      if(p==='./inventory-http')return{};
      if(p==='./local-inventory')return get('./local-inventory');throw Error(p);
    }});return exports;
  };return{api:get('./items'),local:get('./local-inventory'),switchAccount:()=>{account='b'},requests:()=>requests};
}
const actions=api=>[
  ()=>api.createItem({name:'new',type:'tool',status:'available',current_quantity:1,initial_quantity:1}),
  ()=>api.updateItem(id,{name:'edited'}),()=>api.deleteItem(id),
  ()=>api.bulkUpdateItemStatus([id],'in_use'),()=>api.bulkDeleteItems([id]),
  ()=>api.createItemMovement(id,{movement_type:'consume',quantity:2}),
];
for(const fault of ['missing','reject'])test(`all inventory writes ${fault}: no HTTP fallback`,async()=>{
  const c=load(async command=>{if(command==='get_local_inventory_snapshot')return fault==='missing'?null:JSON.stringify(initial);throw Error('SQLite failure')});
  for(const action of actions(c.api))await assert.rejects(action());assert.equal(c.requests(),0);
});
test('all inventory writes carry their exact base and captured account',async()=>{
  const writes=[];const c=load(async(command,args)=>{if(command==='get_local_inventory_snapshot')return JSON.stringify(initial);writes.push({command,...args});});
  for(const action of actions(c.api))await action();assert.equal(writes.length,6);
  for(const write of writes){assert.equal(write.input.expected_account_id,'a');assert.deepEqual(JSON.parse(write.input.expected_snapshot_json),initial);assert.ok(write.input.change_id);}
  assert.equal(c.requests(),0);
});
test('account change during snapshot read cannot queue an edit',async()=>{
  let c,writes=0;c=load(async command=>{if(command==='get_local_inventory_snapshot'){c.switchAccount();return JSON.stringify(initial);}writes++;});
  await assert.rejects(c.api.updateItem(id,{name:'wrong account'}),/Account changed/);assert.equal(writes,0);assert.equal(c.requests(),0);
});
test('account change after write does not return another account record to the UI',async()=>{
  let c;c=load(async command=>{if(command==='get_local_inventory_snapshot')return JSON.stringify(initial);c.switchAccount();});
  await assert.rejects(c.api.createItemMovement(id,{movement_type:'consume',quantity:2}),/Account changed/);assert.equal(c.requests(),0);
});
test('filtered initial inventory load caches a complete list, not the filtered subset',async()=>{
  const other={...initial[0],id:randomUUID(),type:'tool'};let cached,path;
  const c=load(async(command,args)=>{if(command==='get_local_inventory_snapshot')return null;if(command==='cache_local_inventory_snapshot')cached=JSON.parse(args.snapshotJson);},async p=>{path=p;return{ok:true,json:async()=>[...initial,other]}});
  const rows=await c.api.getItems({type:'component'});assert.equal(rows.length,1);assert.equal(cached.length,2);assert.equal(path,'/items?');
});
test('cache IPC names match Tauri camelCase and persistence failures are surfaced',async()=>{
  const calls=[];const c=load(async(command,args)=>{calls.push({command,args});throw Error('disk unavailable')});
  await assert.rejects(c.local.cacheLocalInventorySnapshot(initial),/disk unavailable/);
  await assert.rejects(c.local.cacheLocalItemMovements(id,[]),/disk unavailable/);
  assert.ok(calls[0].args.snapshotJson);assert.equal(calls[1].args.movementsJson,'[]');
});
test('history refresh returns the native pending-safe merge, not the raw server list',async()=>{
  const pending={id:'pending'},remote={id:'remote'};let cached=false;
  const c=load(async(command,args)=>{if(command==='list_local_inventory_movements')return (cached?[pending,remote]:[pending]).map(JSON.stringify);if(command==='cache_local_inventory_movements'){assert.equal(args.expectedAccountId,'a');assert.deepEqual(JSON.parse(args.movementsJson),[remote]);cached=true;}},async()=>({ok:true,json:async()=>[remote]}));
  assert.deepEqual(JSON.parse(JSON.stringify(await c.api.getItemMovements(id))),[pending,remote]);assert.equal(c.requests(),1);
});
test('history uses the cache offline or after transport/5xx failures, never after authorization denial',async()=>{
  for(const mode of ['offline','local','network','server','denied']){
    const c=load(async()=>['{"id":"cached"}'],async()=>{if(mode==='network')throw Error('offline');return{ok:false,status:mode==='denied'?403:503}},{online:mode!=='offline',token:mode==='local'?'local:test':'test'});
    if(mode==='denied')await assert.rejects(c.api.getItemMovements(id),/error/);else assert.equal((await c.api.getItemMovements(id))[0].id,'cached');
    assert.equal(c.requests(),['offline','local'].includes(mode)?0:1);
  }
  const c=load(async()=>null,undefined,{online:false});await assert.rejects(c.api.getItemMovements(id),/not been downloaded/);
});
test('history account changes, denied native reads and cache failures fail closed',async()=>{
  let c;c=load(async()=>[],async()=>{c.switchAccount();return{ok:true,json:async()=>[]}});await assert.rejects(c.api.getItemMovements(id),/Account changed/);
  const denied=load(async()=>{throw Error('Permission denied')});await assert.rejects(denied.api.getItemMovements(id),/Permission denied/);await assert.rejects(denied.api.getItems(),/Permission denied/);assert.equal(denied.requests(),0);
  const disk=load(async command=>{if(command==='list_local_inventory_movements')return[];throw Error('disk failed')},async()=>({ok:true,json:async()=>[]}));await assert.rejects(disk.api.getItemMovements(id),/disk failed/);
});
