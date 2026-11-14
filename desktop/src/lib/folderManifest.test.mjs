import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const compile=(file,require=()=>{throw Error('Unexpected import');})=>{const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});return exports;};
const navigation=compile('./folderNavigation.ts');
const {buildFolderManifest,folderDestination}=compile('./folderManifest.ts',()=>navigation);
const row=(id,kind,parent='root',extra={})=>({id,kind,parent_resource_id:parent,name:id,created_at:'',file_type:'other',...extra});
const root=row('root','folder',null);

test('empty and nested folders remain navigable alongside flat imported paths and links',()=>{
 const rows=[root,row('empty','folder'),row('nested','folder','root',{name:'Designs'}),row('file','file','nested',{original_filename:'circuit.pdf'}),row('flat','file','root',{relative_path:'virtual/deep/readme.md'}),row('web','link','empty',{name:'https://example.test/info'})];
 const before=JSON.stringify(rows),manifest=buildFolderManifest(root,rows);
 assert.deepEqual(Array.from(navigation.folderContents(manifest.files,'').directories),['Designs','empty','virtual']);
 assert.equal(navigation.folderContents(manifest.files,'Designs').files[0].id,'file');
 assert.equal(navigation.folderContents(manifest.files,'empty').files[0].id,'web');
 assert.equal(navigation.folderContents(manifest.files,'virtual/deep').files[0].id,'flat');
 assert.equal(JSON.stringify(rows),before);
});

test('uploads select the deepest actual folder while preserving a remaining virtual suffix',()=>{
 const manifest=buildFolderManifest(root,[row('nested','folder','root',{name:'Designs'}),row('deep','folder','nested',{name:'References'})]);
 assert.deepEqual(JSON.parse(JSON.stringify(folderDestination('root',manifest.files,'Designs/References/circuits'))),{folderId:'deep',relativeDirectory:'circuits'});
 assert.equal(folderDestination('root',manifest.files,'Designs-other').folderId,'root');
});

test('a large workspace does not hide a small folder, while oversized subtrees fail explicitly',()=>{
 const other=Array.from({length:10001},(_,index)=>row(`other${index}`,'file','unrelated'));
 assert.equal(buildFolderManifest(root,[...other,row('own','file')]).files.length,1);
 assert.throws(()=>buildFolderManifest(root,other.map(entry=>({...entry,parent_resource_id:'root'}))),/listing size/);
});

test('ambiguous identities, paths, ancestry and file/directory aliases fail explicitly',()=>{
 for(const rows of [[row('x','file'),row('x','file')],[row('a','file','root',{name:'same'}),row('b','folder','root',{name:'SAME'})],[row('f','file','root',{name:'a'}),row('g','file','root',{relative_path:'a/b.pdf'})],[row('bad','folder','root',{name:'../escape'})],[row('root','folder','root')]])assert.throws(()=>buildFolderManifest(root,rows));
 const deep=[];let parent='root';for(let i=0;i<33;i++){deep.push(row(`level${i}`,'folder',parent));parent=`level${i}`;}assert.throws(()=>buildFolderManifest(root,deep),/31 levels/);
 assert.throws(()=>buildFolderManifest(root,[row('folder','folder','root',{name:'Designs'}),row('flat','file','root',{relative_path:'Designs/file.pdf'})]),/canonical parents/);
});
