import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const id='20000000-0000-4000-8000-000000000001';
const storage=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
function load(fetch,{store=storage(),desktop=false}={}){
  let account='a';const requests=[],modules={};
  function get(name){
    if(modules[name])return modules[name];const exports={};modules[name]=exports;
    const js=ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,URLSearchParams,crypto:{randomUUID},sessionStorage:store,require:p=>{
      if(p==='./auth')return{captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account};
      if(p==='./local-backend')return{isLocalBackendAvailable:()=>desktop};
      if(p==='./http')return{apiFetch:async(path,init)=>{requests.push({path,...init});return fetch(path,init)},getApiErrorMessage:async()=> 'Rejected inventory'};
      if(p==='./maintenance')return{};
      if(p==='./item-sku')return{ensureItemSku:()=>randomUUID()};
      if(p==='./local-inventory')return new Proxy({},{get:()=>async()=>null});
      if(p==='./inventory-http')return get(p);throw Error(p);
    }});return exports;
  }
  return{api:get('./items'),http:get('./inventory-http'),requests,store,switchAccount:()=>{account='b'}};
}
const success=()=>({ok:true,status:200,json:async()=>({id,sync_version:2})});
test('browser create uncertain retry survives reload with the same key, ID and body',async()=>{
  const store=storage(),item={name:'new',type:'tool',status:'available',initial_quantity:1,current_quantity:1};
  const a=load(async()=>{throw Error('lost ACK')},{store});await assert.rejects(a.api.createItem(item));
  const b=load(async()=>success(),{store});await b.api.createItem({...item});
  assert.equal(a.requests[0].headers['Idempotency-Key'],b.requests[0].headers['Idempotency-Key']);assert.equal(a.requests[0].body,b.requests[0].body);
  await b.api.createItem(item);assert.notEqual(b.requests[0].headers['Idempotency-Key'],b.requests[1].headers['Idempotency-Key']);
});
test('all browser mutations carry versions and stable retry identities',async()=>{
  const c=load(async()=>success()),base=[{id,version:7}];
  await c.api.updateItem(id,{name:'edited'},7);await c.api.deleteItem(id,7);
  await c.api.bulkUpdateItemStatus([id],'in_use',base);await c.api.bulkDeleteItems([id],base);
  await c.api.createItemMovement(id,{movement_type:'consume',quantity:2},7);
  assert.equal(c.requests.length,5);for(const r of c.requests){assert.ok(r.headers['Idempotency-Key']);const body=JSON.parse(r.body);assert.equal(body.expected_version??body.item_bases[0].version,7);}
  assert.ok(JSON.parse(c.requests[4].body).id);
});
test('a re-previewed uncertain workbook replays original row IDs and bases',async()=>{
  const store=storage(),plan=()=>({inventory_protocol:2,rows:[{operation:'create',record:{id:randomUUID(),name:'new',type:'tool',current_quantity:1}}],item_bases:[]});
  const a=load(async()=>{throw Error('lost ACK')},{store});await assert.rejects(a.http.writeInventoryHttp('/excel/inventory/import','POST',plan()));
  const b=load(async()=>success(),{store});await b.http.writeInventoryHttp('/excel/inventory/import','POST',plan());assert.equal(a.requests[0].body,b.requests[0].body);assert.equal(a.requests[0].headers['Idempotency-Key'],b.requests[0].headers['Idempotency-Key']);
});
test('refresh after a lost stock ACK reuses the original version and movement ID',async()=>{
  const store=storage(),movement={movement_type:'consume',quantity:2};
  const a=load(async()=>{throw Error('lost ACK')},{store});await assert.rejects(a.api.createItemMovement(id,movement,1));
  const b=load(async()=>success(),{store});await b.api.createItemMovement(id,movement,2);
  assert.equal(a.requests[0].body,b.requests[0].body);assert.equal(JSON.parse(b.requests[0].body).expected_version,1);
  assert.equal(a.requests[0].headers['Idempotency-Key'],b.requests[0].headers['Idempotency-Key']);
});
test('missing or incomplete displayed versions never fetch a fresh base or write',async()=>{
  const c=load(async()=>{throw Error('unexpected')});
  await assert.rejects(c.api.updateItem(id,{name:'x'}),/version/);await assert.rejects(c.api.deleteItem(id),/version/);
  await assert.rejects(c.api.createItemMovement(id,{movement_type:'adjust',quantity:3}),/version/);
  await assert.rejects(c.api.bulkDeleteItems([id],[]),/Refresh/);assert.equal(c.requests.length,0);
});
test('malformed success, transport and retryable server failures retain identity',async()=>{
  for(const response of [()=>{throw Error('offline')},()=>({ok:false,status:503}),()=>({ok:false,status:429}),()=>({ok:true,status:200,json:async()=>{throw Error('truncated')}})]){
    let fail=true;const c=load(async()=>fail?response():success());await assert.rejects(c.api.updateItem(id,{name:'x'},1));fail=false;await c.api.updateItem(id,{name:'x'},1);assert.equal(c.requests[0].headers['Idempotency-Key'],c.requests[1].headers['Idempotency-Key']);
  }
});
test('definitive conflict releases the key; changed intent gets another identity',async()=>{
  let fail=true;const c=load(async()=>fail?{ok:false,status:409}:success());await assert.rejects(c.api.updateItem(id,{name:'x'},1));fail=false;await c.api.updateItem(id,{name:'x'},2);assert.notEqual(c.requests[0].headers['Idempotency-Key'],c.requests[1].headers['Idempotency-Key']);
});
test('account switch cannot display the previous account response or reuse its intent',async()=>{
  let c;c=load(async()=>{c.switchAccount();return success()});await assert.rejects(c.api.updateItem(id,{name:'x'},1),/Account changed/);
  const d=load(async()=>{throw Error('lost ACK')});await assert.rejects(d.api.updateItem(id,{name:'x'},1));d.switchAccount();await assert.rejects(d.api.updateItem(id,{name:'x'},1));assert.notEqual(d.requests[0].headers['Idempotency-Key'],d.requests[1].headers['Idempotency-Key']);
});
test('unavailable browser retry persistence and desktop runtime fail closed',async()=>{
  const c=load(async()=>success(),{store:{getItem:()=>null,setItem:()=>{throw Error('quota')}}});await assert.rejects(c.api.updateItem(id,{name:'x'},1));assert.equal(c.requests.length,0);
  const d=load(async()=>success(),{desktop:true});await assert.rejects(d.http.writeInventoryHttp('/items','POST',{}),/outbox/);assert.equal(d.requests.length,0);
});
