import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load({failMove=false,switchOnGuard=false,switchOnMove=false,failEditor=false,switchOnEditor=false}={}){
  const exports={},calls=[];let current=true;
  const source=ts.transpileModule(readFileSync(new URL('./resources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,URLSearchParams,XMLHttpRequest:class{constructor(){throw Error('Unexpected HTTP upload');}},require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>true};
    if(p==='./auth')return{captureAccountSession:()=>({accountId:'account'}),isAccountSessionCurrent:()=>current};
    if(p==='./http')return{apiFetch:()=>{throw Error('Unexpected HTTP');}};
    if(p==='./resource-uploads')return{stageResourceFolderFiles:async(...args)=>{calls.push({command:'stageFolder',args});return[];},refreshLocalFileAccess:async()=>{},localFilePending:()=>false,localFileUrl:()=>null};
    if(p==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='get_local_resource')return{id:'folder',name:'Designs',kind:'folder'};
      if(command==='list_local_resources')return[{id:'file',name:'part.txt',kind:'file',relative_path:'rev1/part.txt',size_bytes:3}];
      if(command==='create_local_resource_folder')return{id:'folder'};
      if(command==='local_authorization_guard'){if(switchOnGuard)current=false;return 'native-session';}
      if(command==='move_local_resource_attachment'){if(failMove)throw Error('SQLite write failed');if(switchOnMove)current=false;return{id:args.resourceId,project_id:args.destination.project_id};}
      if(['create_local_pdf_edit_copy','read_local_resource_markdown'].includes(command)){
        if(failEditor)throw Error('Local source unavailable');if(switchOnEditor)current=false;
        return command==='read_local_resource_markdown'?'# Local document':{id:'copy',kind:'file',derived_from_resource_id:args.resourceId};
      }
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

test('desktop attachment moves use guarded native outbox writes without HTTP',async()=>{
  const c=load();const result=await c.api.attachExistingResource('file',{project_id:'project'});
  assert.equal(result.project_id,'project');
  assert.equal(c.calls[1].command,'move_local_resource_attachment');
  assert.equal(c.calls[1].args.expectedAccountId,'account');
  assert.equal(c.calls[1].args.expectedSessionToken,'native-session');
});
test('failed SQLite move has no server fallback',async()=>{
  const c=load({failMove:true});await assert.rejects(c.api.attachExistingResource('file',{}),/SQLite write failed/);
  assert.equal(c.calls.length,2);
});
test('account switches prevent stale moves and stale results',async()=>{
  const before=load({switchOnGuard:true});await assert.rejects(before.api.attachExistingResource('file',{}),/Account changed/);
  assert.equal(before.calls.length,1);
  const after=load({switchOnMove:true});await assert.rejects(after.api.attachExistingResource('file',{}),/Account changed/);
});

test('desktop PDF copy and Markdown reads use guarded native files, never HTTP',async()=>{
  const c=load();const copy=await c.api.createPdfEditCopy('source');
  assert.equal(copy.derived_from_resource_id,'source');
  assert.equal(c.calls[1].command,'create_local_pdf_edit_copy');
  assert.equal(c.calls[1].args.expectedSessionToken,'native-session');
  assert.equal(await c.api.getResourceText('markdown'),'# Local document');
  assert.equal(c.calls[3].command,'read_local_resource_markdown');
});
test('editor file failures and account switches do not fall back to the server',async()=>{
  for(const method of ['createPdfEditCopy','getResourceText']){
    const failed=load({failEditor:true});await assert.rejects(failed.api[method]('source'),/Local source unavailable/);
    const changed=load({switchOnGuard:true});await assert.rejects(changed.api[method]('source'),/Account changed/);
    assert.equal(changed.calls.length,1);
    const after=load({switchOnEditor:true});await assert.rejects(after.api[method]('source'),/Account changed/);
  }
});
