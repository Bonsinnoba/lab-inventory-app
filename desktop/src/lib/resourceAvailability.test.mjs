import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import test from 'node:test';import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resourceAvailability.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Map});
const merge=exports.withResourceAvailability;
const row={id:'a',kind:'file',name:'Current title',updated_at:'revision-2',created_at:'',file_type:'text'};
test('metadata appears while file verification is absent and never implies available bytes',()=>{
 const result=merge([{...row,local_file_available:true,local_copy:{state:'ready'}}]);
 assert.equal(result[0].name,row.name);assert.equal(result[0].local_file_available,false);assert.equal(result[0].local_copy,undefined);
});
test('same-revision verification enriches only availability fields',()=>{
 const result=merge([row],[{...row,name:'Old title',parent_resource_id:'wrong',local_file_available:true,local_file_pending:true,local_copy:{state:'ready',verified_bytes:4,size_bytes:4}}]);
 assert.equal(result[0].name,row.name);assert.equal(result[0].parent_resource_id,undefined);assert.equal(result[0].local_file_available,true);assert.equal(result[0].local_file_pending,true);assert.equal(result[0].local_copy.state,'ready');
});
test('late scans cannot resurrect removed rows or attach old-revision proofs',()=>{
 assert.equal(merge([], [{...row,local_file_available:true}]).length,0);
 for(const changed of [{updated_at:'revision-3'},{kind:'link'},{local_media_filename:'new.mp4'},{local_media_downloaded_at:'new-download'}]){
  const result=merge([{...row,...changed}],[{...row,local_file_available:true,local_copy:{state:'ready'}}]);
  assert.equal(result[0].local_file_available,false);assert.equal(result[0].local_copy,undefined);
 }
});
