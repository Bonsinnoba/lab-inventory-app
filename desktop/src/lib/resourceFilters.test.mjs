import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resourceFilters.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {filterResources,emptyResourceFilters}=exports;
const row=(id,fields={})=>({id,name:id,kind:'file',file_type:'pdf',created_at:'',...fields});
const ids=(rows,filters={},notes=[])=>Array.from(filterResources(rows,notes,{...emptyResourceFilters,...filters}),row=>row.id);
test('project filtering includes folder and note inheritance and excludes unresolved or cyclic scopes',()=>{
 const rows=[row('folder',{kind:'folder',project_id:'p1'}),row('child',{parent_resource_id:'folder'}),row('note-file',{note_id:'n1'}),row('other',{project_id:'p2'}),row('orphan',{parent_resource_id:'missing'}),row('cycle',{parent_resource_id:'cycle'}),row('conflict',{project_id:'p2',parent_resource_id:'folder'})];
 assert.deepEqual(ids(rows,{project:'p1'},[{id:'n1',project_id:'p1'}]),['folder','child','note-file']);
 assert.deepEqual(ids(rows,{attachment:'note'},[{id:'n1',project_id:'p1'}]),['note-file']);
});
test('unattached does not include item or note attachments and default browsing retains folder roots',()=>{
 const rows=[row('folder',{kind:'folder'}),row('child',{parent_resource_id:'folder'}),row('item',{item_id:'i1'}),row('note',{note_id:'n1'}),row('loose')];
 assert.deepEqual(ids(rows),['folder','item','note','loose']);
 assert.deepEqual(ids(rows,{project:'unattached'}),['folder','child','loose']);
});
test('available on PC requires current local proof, never server-completion metadata or a copied byte count',()=>{
 const rows=[row('server-only',{local_media_downloaded_at:'2026-11-06',local_media_filename:'video.mp4'}),row('stale',{local_copy:{state:'ready',verified_bytes:20,size_bytes:20},local_file_available:false}),row('local',{local_file_available:true}),row('pending-local',{local_file_available:true,local_file_pending:true})];
 assert.deepEqual(ids(rows,{availability:'local'}),['local','pending-local']);
});
test('combined search/type/project filters find nested resources without mutating their records',()=>{
 const rows=[row('folder',{kind:'folder',project_id:'p1'}),row('image',{parent_resource_id:'folder',file_type:'image',description:'ESP32 diagram'}),row('video',{kind:'link',file_type:'youtube',project_id:'p1',tags:['ESP32']}),row('pdf',{project_id:'p2',description:'ESP32'})],before=JSON.stringify(rows);
 assert.deepEqual(ids(rows,{search:'esp32',type:'image',project:'p1'}),['image']);assert.deepEqual(ids(rows,{search:'esp32',type:'video'}),['video']);assert.equal(JSON.stringify(rows),before);
});
