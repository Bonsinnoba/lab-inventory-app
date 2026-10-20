import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const id='20000000-0000-4000-8000-000000000001';
const initial=[{id,name:'Stock',type:'component',status:'available',current_quantity:10,initial_quantity:10,updated_at:'2026-01-01T00:00:00Z'}];
function load(invoke,fetch,{token='test',online=true,signedIn=true}={}){
  let account='a',generation=0;const session=()=>signedIn?({accountId:account,token,generation}):null,modules={};let requests=0;
  const get=name=>{
    if(modules[name])return modules[name];const exports={};modules[name]=exports;
    const js=ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,URLSearchParams,navigator:{onLine:online},crypto:{randomUUID},require:p=>{
      if(p==='@tauri-apps/api/tauri')return{invoke};
      if(p==='./auth')return{captureAccountSession:session,isAccountSessionCurrent:s=>!!s&&signedIn&&s.accountId===account&&s.generation===generation&&s.token===token};
      if(p==='./local-backend')return{isLocalBackendAvailable:()=>true};
      if(p==='./item-sku')return{ensureItemSku:()=> 'test'};
      if(p==='./maintenance')return{};
      if(p==='./http')return{apiFetch:async(...args)=>{requests++;if(fetch)return fetch(...args);throw Error('Unexpected HTTP')},getApiErrorMessage:async()=> 'error'};
      if(p==='./inventory-http')return{};
      if(p==='./local-inventory')return get('./local-inventory');throw Error(p);
    }});return exports;
  };return{api:get('./items'),local:get('./local-inventory'),switchAccount:()=>{account='b';generation++},renewSession:()=>{generation++},requests:()=>requests};
}
const actions=api=>[
  ()=>api.createItem({name:'new',type:'tool',status:'available',current_quantity:1,initial_quantity:1}),
  ()=>api.updateItem(id,{name:'edited'}),()=>api.deleteItem(id),
  ()=>api.bulkUpdateItemStatus([id],'in_use'),()=>api.bulkDeleteItems([id]),
  ()=>api.createItemMovement(id,{movement_type:'consume',quantity:2}),
];
test('reservation intent without a recipient cannot be dropped by the ordinary writer',async()=>{
  let nativeCommand;
  const c=load(async command=>{
    if(command==='get_local_inventory_snapshot')return JSON.stringify(initial);
    nativeCommand=command;throw Error('Reservation-backed issues require checkout with a recipient');
  });
  await assert.rejects(c.api.createItemMovement(id,{movement_type:'checkout',quantity:1,reservation_id:randomUUID(),project_id:randomUUID()}),/recipient/);
  assert.equal(nativeCommand,'save_local_inventory_custody_movement');assert.equal(c.requests(),0);
});
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

const scopedReads = [
  ['movements', 'getItemMovements', 'list_local_inventory_movements', 'cache_local_inventory_movements'],
  ['field history', 'getItemHistory', 'list_local_item_field_history', 'cache_local_item_field_history'],
  ['assignment history', 'getItemAssignmentHistory', 'list_local_item_assignment_history', 'cache_local_item_assignment_history'],
  ['custody', 'getItemCustody', 'list_local_item_custody', 'cache_local_item_custody'],
  ['assignee directory', 'getAssigneeDirectory', 'list_local_assignee_directory', 'cache_local_assignee_directory'],
];

test('custody writes use the dedicated native transaction with full authored intent and receipt', async()=>{
  const intent={movement_type:'transfer',quantity:2,custody_id:id,settlement_type:'transfer',transfer_recipient_id:id,
    project_id:id,task_id:id,experiment_id:id,requirement_id:id,reservation_id:id,serial_number:'SN-1',notes:'transfer'};
  let saved;
  const c=load(async(command,args)=>{
    if(command==='get_local_inventory_snapshot')return JSON.stringify(initial);
    assert.equal(command,'save_local_inventory_custody_movement');saved=args.input;
    const movement=JSON.parse(saved.movement_json);
    return JSON.stringify({item:initial[0],movement});
  });
  const result=await c.api.createItemMovement(id,intent);
  for(const [key,value] of Object.entries(intent))assert.equal(result.movement[key],value);
  assert.equal(saved.expected_account_id,'a');assert.ok(saved.change_id);assert.equal(c.requests(),0);
});
test('missing custody native command, missing inventory and account switch never fall back to HTTP',async()=>{
  for(const mode of ['missing-command','missing-inventory','account-change']){
    let c;c=load(async(command,args)=>{
      if(command==='get_local_inventory_snapshot')return mode==='missing-inventory'?null:JSON.stringify(initial);
      if(mode==='missing-command')throw Error('Unknown native command');
      c.switchAccount();return JSON.stringify({item:initial[0],movement:JSON.parse(args.input.movement_json)});
    });
    await assert.rejects(c.api.createItemMovement(id,{movement_type:'checkout',quantity:1,recipient_id:id}));
    assert.equal(c.requests(),0);
  }
});
for (const [label, method, readCommand, cacheCommand] of scopedReads) {
  const read = c => c.api[method](id);
  test(`${label}: cached offline reads need no network; missing snapshots are not empty`, async () => {
    for (const options of [{online:false}, {token:'local:test'}]) {
      const c = load(async () => ['{"id":"cached"}'], undefined, options);
      assert.equal((await read(c))[0].id, 'cached');
      assert.equal(c.requests(), 0);
      const empty = load(async () => [], undefined, options);
      assert.equal((await read(empty)).length, 0);
      const missing = load(async () => null, undefined, options);
      await assert.rejects(read(missing), /not been downloaded/);
      assert.equal(missing.requests(), 0);
    }
  });
  test(`${label}: HTTP refusals and invalid responses never fall back to cache`, async () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      const c = load(async () => ['{"id":"cached"}'], async () => ({ok:false,status}));
      await assert.rejects(read(c), /error/);
    }
    for (const json of [async () => ({}), async () => {throw Error('bad JSON')}]) {
      const c = load(async () => ['{"id":"cached"}'], async () => ({ok:true,json}));
      await assert.rejects(read(c), /Invalid inventory history|bad JSON/);
    }
  });
  test(`${label}: transport/5xx fallback rechecks native permission and lease`, async () => {
    for (const fault of ['network', 'server']) {
      const fetch = async () => {if (fault === 'network') throw Error('offline');return {ok:false,status:503}};
      let reads = 0;
      const c = load(async () => {reads++;return [`{"id":"read-${reads}"}`]}, fetch);
      assert.equal((await read(c))[0].id, 'read-2');
      let deniedReads = 0;
      const denied = load(async () => {if (++deniedReads > 1) throw Error('Lease expired');return ['{"id":"cached"}']}, fetch);
      await assert.rejects(read(denied), /Lease expired/);
    }
  });
  test(`${label}: account/session changes at every asynchronous boundary fail closed`, async () => {
    for (const boundary of ['local','response','json','cache','merged','network']) {
      let c, reads = 0, writes = 0;
      c = load(async command => {
        if (command === readCommand) {
          reads++;
          if (boundary === 'local' || (boundary === 'merged' && reads > 1)) c.switchAccount();
          return ['{"id":"cached"}'];
        }
        assert.equal(command, cacheCommand);
        writes++;
        if (boundary === 'cache') c.renewSession();
      }, async () => {
        if (boundary === 'response') c.switchAccount();
        if (boundary === 'network') {c.switchAccount();throw Error('offline')}
        return {ok:true,json:async () => {if (boundary === 'json') c.renewSession();return [{id:'remote'}]}};
      });
      await assert.rejects(read(c), /Account changed/, boundary);
      if (['local','response','json','network'].includes(boundary)) assert.equal(writes,0,boundary);
    }
  });
  test(`${label}: no session, denied native reads and failed cache writes cannot return rows`, async () => {
    let nativeCalls = 0;
    const absent = load(async () => {nativeCalls++;return []}, undefined, {signedIn:false});
    await assert.rejects(read(absent), /Sign in/);
    assert.equal(nativeCalls,0);
    const denied = load(async () => {throw Error('Permission denied')});
    await assert.rejects(read(denied), /Permission denied/);
    assert.equal(denied.requests(),0);
    const disk = load(async command => {if (command === readCommand) return [];throw Error('disk failed')}, async () => ({ok:true,json:async () => []}));
    await assert.rejects(read(disk), /disk failed/);
  });
  test(`${label}: successful refresh uses captured account and rereads the native snapshot`, async () => {
    let cached = false;
    const c = load(async (command,args) => {
      if (command === readCommand) return (cached ? ['{"id":"merged"}'] : []);
      assert.equal(command,cacheCommand);
      assert.equal(args.expectedAccountId,'a');
      cached = true;
    }, async () => ({ok:true,json:async () => [{id:'remote'}]}));
    assert.equal((await read(c))[0].id,'merged');
  });
}
