import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./download-presentation.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports,Error});
test('native strings and Error messages retain useful failure details',()=>{
  assert.equal(exports.downloadFailureMessage(' no such column: o.rowid ','fallback'),'no such column: o.rowid');
  assert.equal(exports.downloadFailureMessage(new Error('failed'),'fallback'),'failed');
  assert.equal(exports.downloadFailureMessage(null,'fallback'),'fallback');
  assert.equal(exports.downloadFailureMessage('x'.repeat(500),'fallback').length,400);
});
test('existing active or unresolved jobs prevent a second queue action',()=>{
  for(const status of ['queued','scheduled','downloading','paused']){
    const job={id:'j',resource_id:'r',status};assert.equal(exports.resourceQueueJob([job],'r'),job);
  }
  for(const sync_state of ['pending_sync','conflict']){
    const job={id:'j',resource_id:'r',status:'cancelled',sync_state};
    assert.equal(exports.resourceQueueJob([job],'r'),job);
  }
  assert.equal(exports.resourceQueueJob([{resource_id:'other',status:'queued'}],'r'),undefined);
  assert.equal(exports.resourceQueueJob([{resource_id:'r',status:'failed'}],'r'),undefined);
});
test('pending and conflict labels never claim server acceptance',()=>{
  assert.match(exports.resourceQueueLabel({status:'queued',sync_state:'pending_sync'}),/PC.*pending sync/);
  assert.equal(exports.resourceQueueLabel({status:'downloading',sync_state:'pending_sync',pending_action:'cancel'}),'cancel pending sync');
  assert.equal(exports.resourceQueueLabel({status:'queued',sync_state:'conflict'}),'Download sync conflict');
  assert.equal(exports.resourceQueueLabel({status:'queued',sync_state:'server'}),'Queued on server');
});
