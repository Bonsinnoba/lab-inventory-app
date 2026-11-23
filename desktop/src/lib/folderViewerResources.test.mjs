import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import test from 'node:test';import assert from 'node:assert/strict';
const navigation={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./folderNavigation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:navigation});
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./folderViewerResources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>navigation});
const scope=exports.folderViewerResources;
const entry=(id,path,kind='file')=>({id,relative_path:path,original_filename:path.split('/').pop(),kind,size_bytes:1,mime_type:'application/octet-stream'});
const entries=[entry('root','Root.pdf'),entry('a2','A/Lesson 2.pdf'),entry('a10','A/Lesson 10.pdf'),entry('deep','A/Deep/Inside.pdf'),entry('other','B/Outside.pdf'),entry('folder','A/Empty','folder'),entry('link','A/Website','link')];
test('folder scope contains only immediate members in natural display order',()=>{
 assert.equal(scope(entries,'A').map(x=>x.id).join(','),'a2,a10,link');assert.equal(scope(entries,'').map(x=>x.id).join(','),'root');assert.equal(scope(entries,'A/Deep').map(x=>x.id).join(','),'deep');
});
test('actual selected metadata wins over manifest placeholders',()=>{
 const selected={id:'link',name:'Website',kind:'link',url:'https://example.com/',created_at:'2026-11-19'};const list=scope(entries,'A',selected);assert.equal(list.find(x=>x.id==='link'),selected);assert.equal(list.length,3);assert.equal(list[0].file_type,'pdf');
});
test('single-file, empty and missing snapshots cannot broaden to the library',()=>{
 assert.equal(scope(entries,'A/Empty').length,0);assert.equal(scope(entries,'Missing').length,0);const selected={id:'retained',name:'Saved.pdf',kind:'file',file_type:'pdf',created_at:'now'};assert.equal(scope([],'',selected).map(x=>x.id).join(','),'retained');
});
test('duplicate manifest IDs cannot create repeated navigation entries',()=>{assert.equal(scope([entry('same','A/a.pdf'),entry('same','A/b.pdf')],'A').length,1);});
test('unsafe and similarly named directory paths do not leak into a scope',()=>{
 const list=scope([...entries,entry('bad','A/../Secret.pdf'),entry('prefix','AB/Not A.pdf')],'A');assert.ok(!list.some(x=>['bad','prefix','other','deep'].includes(x.id)));
});
