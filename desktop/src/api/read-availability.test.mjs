import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(){
  let current='a';const exports={};
  const js=ts.transpileModule(readFileSync(new URL('./read-availability.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,setTimeout,clearTimeout,require:()=>({captureAccountSession:()=>current?{accountId:current}:null,isAccountSessionCurrent:s=>!!s&&s.accountId===current})});
  return{...exports,switchAccount:()=>{current='b'},signOut:()=>{current=null}};
}
test('one denied source never erases a successful section or creates a zero',async()=>{
  const c=load();const r=await c.readLocalSections({inventory:async()=>{throw Error('Permission denied')},maintenance:async()=>[{id:'one'}],notes:async()=>[]});
  assert.equal(r.values.inventory,null);assert.equal(r.availability.sections.inventory,'unavailable');assert.equal(r.values.maintenance.length,1);assert.equal(r.availability.sections.notes,'available');
  assert.equal(r.availability.source,'local');assert.ok(r.availability.readAt);assert.equal(r.availability.lastSyncedAt,undefined);
});
test('null and synchronous exceptions are unavailable; no error payload is exposed',async()=>{
  const c=load();const r=await c.readLocalSections({missing:async()=>null,broken:()=>{throw Error('private implementation detail')}});
  assert.equal(r.values.missing,null);assert.equal(r.availability.sections.broken,'unavailable');assert.ok(!JSON.stringify(r).includes('private implementation'));
});
test('account switching or sign-out discards the entire old account response',async()=>{
  for(const action of ['switchAccount','signOut']){
    const c=load();await assert.rejects(c.readLocalSections({inventory:async()=>{c[action]();return[{id:'private'}]}}),/Account changed/);
  }
});
test('signed-out read does not invoke repositories',async()=>{
  const c=load();c.signOut();let calls=0;await assert.rejects(c.readLocalSections({inventory:async()=>{calls++;return[]}}));assert.equal(calls,0);
});
test('a hanging source is bounded and late failure cannot erase successful data',async()=>{
  const c=load();let rejectLate;
  const r=await c.readLocalSections({ready:async()=>['visible'],hung:()=>new Promise((_,reject)=>{rejectLate=reject})},undefined,20);
  assert.equal(r.values.ready[0],'visible');assert.equal(r.values.hung,null);assert.equal(r.availability.sections.hung,'unavailable');
  rejectLate(Error('late transport failure'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(r.values.ready[0],'visible');
});
