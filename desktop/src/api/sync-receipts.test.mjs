import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./sync-receipts.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports});
const {processSyncReceipts:process}=exports;
test('bad upload ACK cannot block independent deletes or rejected-change reporting',async()=>{
  const ack=[],failed=[],rejected=[];
  const ids=['upload','delete1','rejected','delete2'];
  const outcome=await process(ids.map(change_id=>({change_id})),ids.map(change_id=>({change_id,status:change_id==='rejected'?'rejected':'synced'})),{
    assertSession(){},acknowledge:async c=>{if(c.change_id==='upload')throw Error('Missing resource ID');ack.push(c.change_id);},
    fail:async c=>{failed.push(c.change_id);},reject:async c=>{rejected.push(c.change_id);}
  });
  assert.deepEqual(ack,['delete1','delete2']);assert.deepEqual(failed,['upload']);assert.deepEqual(rejected,['rejected']);
  assert.equal(outcome.syncedCount,2);assert.equal(outcome.failedCount,2);assert.equal(outcome.retry,true);
});
test('missing/duplicate receipts retry original IDs; unknown successes are ignored',async()=>{
  const failed=[],ack=[];
  await process([{change_id:'missing'},{change_id:'duplicate'}],[{change_id:'duplicate',status:'synced'},{change_id:'duplicate',status:'synced'},{change_id:'unknown',status:'synced'}],{
    assertSession(){},acknowledge:async c=>{ack.push(c.change_id);},fail:async c=>{failed.push(c.change_id);},reject:async()=>{}
  });assert.deepEqual(failed,['missing','duplicate']);assert.deepEqual(ack,[]);
});
test('account switch aborts before any further local writes',async()=>{
  let switched=false,writes=0;
  await assert.rejects(process([{change_id:'one'},{change_id:'two'}],[{change_id:'one',status:'synced'},{change_id:'two',status:'synced'}],{
    assertSession(){if(switched)throw Error('Account changed');},acknowledge:async()=>{switched=true;},
    fail:async()=>{writes++;},reject:async()=>{writes++;}
  }),/Account changed/);assert.equal(writes,0);
});
