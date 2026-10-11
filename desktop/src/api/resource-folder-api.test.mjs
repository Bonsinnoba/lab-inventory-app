import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(){
  const exports={},calls=[];let current=true;
  const source=ts.transpileModule(readFileSync(new URL('./resources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,URLSearchParams,XMLHttpRequest:class{constructor(){throw Error('Unexpected HTTP upload');}},require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>true};
    if(p==='./auth')return{captureAccountSession:()=>({accountId:'account'}),isAccountSessionCurrent:()=>current};
    if(p==='./http')return{apiFetch:()=>{throw Error('Unexpected HTTP');}};
    if(p==='./resource-uploads')return{stageResourceFolderFiles:async(...args)=>{calls.push({command:'stageFolder',args});return[];},refreshLocalFileAccess:async()=>{},localFilePending:()=>false};
    if(p==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='get_local_resource')return{id:'folder',name:'Designs',kind:'folder'};
      if(command==='list_local_resources')return[{id:'file',name:'part.txt',kind:'file',relative_path:'rev1/part.txt',size_bytes:3}];
      if(command==='create_local_resource_folder')return{id:'folder'};
      throw Error(command);
    }};
    return{};
  }});return{api:exports,calls,switch:()=>{current=false;}};
}

test('desktop folder upload delegates to native staging before constructing HTTP',async()=>{
  const c=load();await c.api.uploadFolderFiles('folder',[],[]);
  assert.equal(c.calls[0].command,'stageFolder');assert.equal(c.calls[0].args[0],'folder');
});
test('desktop folder creation passes camel-case native parent arguments',async()=>{
  const c=load();await c.api.createFolder('Designs',{project_id:'project'});
  assert.equal(c.calls[0].args.projectId,'project');assert.equal(c.calls[0].args.project_id,undefined);
});
test('desktop folder manifest uses local rows rather than a server request',async()=>{
  const c=load();const manifest=await c.api.getResourceManifest('folder');
  assert.equal(manifest.folder,'Designs');assert.equal(manifest.files[0].relative_path,'rev1/part.txt');
  assert.equal(c.calls.find(c=>c.command==='list_local_resources').args.parentResourceId,'folder');
});
