import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(fail=false){
  const exports={},calls=[];
  const js=ts.transpileModule(readFileSync(new URL('./inventory-pull.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(js,{exports,require:()=>({invoke:async(command,args)=>{calls.push({command,args});if(fail)throw Error('disk failed')}})});
  return{apply:exports.applyInventoryPage,calls};
}
const empty={items:[],deleted_item_ids:[],has_more:false};
test('only an explicit initial complete empty snapshot initializes native inventory',async()=>{
  const c=load();await assert.rejects(c.apply(empty,null,'a'),/confirm/);assert.equal(c.calls.length,0);
  assert.equal((await c.apply({...empty,snapshot_complete:true},null,'a')).done,true);
  assert.equal(c.calls[0].command,'cache_local_inventory_snapshot');assert.equal(c.calls[0].args.snapshotJson,'[]');assert.equal(c.calls[0].args.expectedAccountId,'a');
});
test('an empty incremental response does not erase the local snapshot',async()=>{
  const c=load();assert.equal((await c.apply(empty,'cursor','a')).cursor,'cursor');assert.equal(c.calls.length,0);
});
test('incomplete and non-progressing pages fail without modifying local state',async()=>{
  const c=load();for(const body of [{},{...empty,has_more:true},{...empty,items:[{}]},{...empty,items:[{}],next_cursor:'cursor'}])await assert.rejects(c.apply(body,'cursor','a'));assert.equal(c.calls.length,0);
});
test('data and tombstones persist atomically with the cursor; write failures propagate',async()=>{
  const body={...empty,items:[{id:'one'}],deleted_item_ids:['two'],next_cursor:'next',has_more:true},c=load();
  const result=await c.apply(body,'cursor','a');assert.equal(result.done,false);assert.equal(result.cursor,'next');assert.equal(c.calls[0].command,'apply_server_inventory_pull');assert.equal(c.calls[0].args.expectedAccountId,'a');assert.equal(c.calls[0].args.nextCursor,'next');
  await assert.rejects(load(true).apply(body,'cursor','a'),/disk failed/);
});
