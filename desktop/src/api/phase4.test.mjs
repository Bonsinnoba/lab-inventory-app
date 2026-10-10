import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({items=[],records=[],update=async()=>null}={}){
  const exports={};let requests=0;
  const js=ts.transpileModule(readFileSync(new URL('./phase4.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,require:p=>{
    if(p==='./read-availability'){
      const helper={};const code=ts.transpileModule(readFileSync(new URL('./read-availability.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      vm.runInNewContext(code,{exports:helper,setTimeout,clearTimeout,require:()=>({captureAccountSession:()=>({accountId:'test'}),isAccountSessionCurrent:()=>true})});return helper;
    }
    if(p==='./local-backend')return{localBackend:{isAvailable:()=>true}};
    if(p==='./items')return{getItems:async()=>items,updateItem:update};
    if(p==='./catalog')return{listCatalog:async()=>[{id:'box',name:'Freezer'}]};
    if(p==='./maintenance')return{listMaintenance:async()=>records};
    if(p==='./http')return{apiFetch:async()=>{requests++;throw Error('Unexpected HTTP')}};throw Error(p);
  }});return {api:exports,requests:()=>requests};
}
test('local intelligence includes explicit low-stock status and pending maintenance without HTTP',async()=>{
  const c=load({items:[{id:'one',name:'Tool',status:'low_stock',current_quantity:9,initial_quantity:10,storage_location:' ',storage_container_id:'box'},{id:'two',name:'Empty',status:'available',current_quantity:0,initial_quantity:10}],records:[{status:'scheduled',scheduled_date:'2000-01-01'},{status:'completed',scheduled_date:'2000-01-01'}]});
  const result=await c.api.getPhase4Intelligence();assert.equal(result.inventory.low_stock,2);assert.equal(result.inventory.depleted,1);assert.equal(result.maintenance.due,1);assert.equal(result.storage.contained,1);assert.equal(result.storage.labeled,0);assert.equal(c.requests(),0);
  const page=await c.api.getPhase4Items(1,6,'freezer');assert.equal(page.total,1);assert.equal(page.items[0].id,'one');
});
test('desktop storage-label edit delegates to inventory and does not retry via HTTP on failure',async()=>{
  const writes=[];const c=load({update:async(id,patch)=>{writes.push({id,patch});throw Error('disk failure')}});
  await assert.rejects(c.api.updateItemStorage('one','Shelf','box'),/disk failure/);
  assert.equal(writes.length,1);assert.equal(writes[0].patch.storage_container_id,'box');assert.equal(c.requests(),0);
});
