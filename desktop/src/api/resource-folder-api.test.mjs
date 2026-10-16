import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load({failMove=false,switchOnGuard=false,switchOnMove=false,failEditor=false,switchOnEditor=false,mutationProtocol=1}={}){
  const exports={},calls=[];let current=true;
  const source=ts.transpileModule(readFileSync(new URL('./resources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,URLSearchParams,XMLHttpRequest:class{constructor(){throw Error('Unexpected HTTP upload');}},require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>true};
    if(p==='./auth')return{captureAccountSession:()=>({accountId:'account'}),isAccountSessionCurrent:()=>current};
    if(p==='./http')return{apiFetch:()=>{throw Error('Unexpected HTTP');}};
    if(p==='./resource-uploads')return{stageResourceFolderFiles:async(...args)=>{calls.push({command:'stageFolder',args});return[];},stagePdfReplacement:async(...args)=>{calls.push({command:'stagePdf',args});return{id:args[0]};},refreshLocalFileAccess:async()=>{},localFilePending:()=>false,localFileUrl:()=>null};
    if(p==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='local_database_status')return{resource_mutation_protocol:mutationProtocol};
      if(command==='update_local_resource_metadata'){if(failEditor)throw Error('SQLite write failed');if(switchOnEditor)current=false;return{id:args.id,description:args.description};}
      if(command==='get_local_resource')return{id:'folder',name:'Designs',kind:'folder'};
      if(command==='list_local_resources')return[{id:'file',name:'part.txt',kind:'file',relative_path:'rev1/part.txt',size_bytes:3}];
      if(command==='create_local_resource_folder')return{id:'folder'};
      if(command==='local_authorization_guard'){if(switchOnGuard)current=false;return 'native-session';}
      if(command==='move_local_resource_attachment'){if(failMove)throw Error('SQLite write failed');if(switchOnMove)current=false;return{id:args.resourceId,project_id:args.destination.project_id};}
      if(['create_local_pdf_edit_copy','read_local_resource_markdown','save_local_resource_markdown','list_local_markdown_versions','read_local_markdown_version','read_local_docx','save_local_docx_copy'].includes(command)){
        if(failEditor)throw Error('Local source unavailable');if(switchOnEditor)current=false;
        if(command==='read_local_docx')return{html:'<p>Local DOCX</p>',messages:[]};
        if(command==='list_local_markdown_versions')return[{change_id:'version',status:'discarded'}];
        if(command==='read_local_markdown_version')return '# Preserved';
        return command==='read_local_resource_markdown'?'# Local document':{id:command==='save_local_resource_markdown'?args.resourceId:'copy',kind:'file',derived_from_resource_id:args.resourceId};
      }
      throw Error(command);
    }};
    return{};
  }});return{api:exports,calls,switch:()=>{current=false;}};
}

test('metadata writes capture the native session and never fall back to HTTP',async()=>{
  const c=load();await c.api.updateResourceMetadata('resource',{description:'saved'});
  const call=c.calls.find(c=>c.command==='update_local_resource_metadata');assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{id:'resource',description:'saved',expectedAccountId:'account',expectedSessionToken:'native-session'});
  for(const option of [{failEditor:true},{switchOnGuard:true},{switchOnEditor:true}]){
    const failed=load(option);await assert.rejects(failed.api.updateResourceMetadata('resource',{tags:[]}),/SQLite write failed|Account changed/);
  }
  const old=load({mutationProtocol:0});await assert.rejects(old.api.updateResourceMetadata('resource',{description:'saved'}),/updated desktop/);assert.equal(old.calls.length,1);
});

test('desktop folder upload delegates to native staging before constructing HTTP',async()=>{
  const c=load();await c.api.uploadFolderFiles('folder',[],[]);
  assert.equal(c.calls[0].command,'stageFolder');assert.equal(c.calls[0].args[0],'folder');
});

test('DOCX desktop reads and copies use native authorization and stable retry arguments without HTTP',async()=>{
  const c=load();assert.equal((await c.api.getDocxHtml('source','revision')).html,'<p>Local DOCX</p>');
  assert.equal(c.calls[1].command,'read_local_docx');assert.equal(c.calls[1].args.expectedRevision,'revision');
  await c.api.saveDocxCopy('source','<p>Edit</p>','revision','same-request');
  await c.api.saveDocxCopy('source','<p>Edit</p>','revision','same-request');
  const saves=c.calls.filter(c=>c.command==='save_local_docx_copy');assert.equal(saves.length,2);
  for(const call of saves){assert.equal(call.args.requestId,'same-request');assert.equal(call.args.expectedAccountId,'account');assert.equal(call.args.expectedSessionToken,'native-session');assert.equal(call.args.expectedRevision,'revision');assert.equal(call.args.html,'<p>Edit</p>');}
  const missing=load();await assert.rejects(missing.api.saveDocxCopy('source','html'),/Reopen/);assert.equal(missing.calls.length,0);
});
test('DOCX failures and account switches do not fall back to server reads or writes',async()=>{
  for(const option of [{failEditor:true},{switchOnGuard:true},{switchOnEditor:true}]){
    const c=load(option);await assert.rejects(c.api.saveDocxCopy('source','html','revision','request'),/Local source unavailable|Account changed/);
    const read=load(option);await assert.rejects(read.api.getDocxHtml('source','revision'),/Local source unavailable|Account changed/);
  }
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

test('Markdown saves use the captured revision and same resource identity without HTTP',async()=>{
  const c=load();const result=await c.api.saveResourceText('source','# Saved','revision');
  assert.equal(result.id,'source');assert.equal(c.calls[1].command,'save_local_resource_markdown');
  assert.equal(c.calls[1].args.expectedRevision,'revision');assert.equal(c.calls[1].args.content,'# Saved');
  assert.equal(c.calls[1].args.expectedSessionToken,'native-session');
  const missing=load();await assert.rejects(missing.api.saveResourceText('source','text'),/Reopen/);assert.equal(missing.calls.length,0);
});
test('failed or switched-session Markdown saves never fall back to server writes',async()=>{
  for(const option of [{failEditor:true},{switchOnGuard:true},{switchOnEditor:true}]){
    const c=load(option);await assert.rejects(c.api.saveResourceText('source','text','revision'),/Local source unavailable|Account changed/);
  }
});

test('desktop PDF replacement delegates to native staging, with the opened revision',async()=>{
  const c=load();const file={name:'edited.pdf'};const result=await c.api.replaceResourceFile('existing',file,'revision');
  assert.equal(result.id,'existing');assert.equal(c.calls[0].command,'stagePdf');assert.equal(c.calls[0].args[2],'revision');
});
test('saved-version review reauthorizes and passes account, resource and version identities',async()=>{
  const c=load();assert.equal((await c.api.listMarkdownSavedVersions('source'))[0].status,'discarded');
  assert.equal(await c.api.readMarkdownSavedVersion('source','version'),'# Preserved');
  assert.equal(c.calls[3].args.changeId,'version');assert.equal(c.calls[3].args.resourceId,'source');assert.equal(c.calls[3].args.expectedSessionToken,'native-session');
  for(const method of ['listMarkdownSavedVersions','readMarkdownSavedVersion']){
    const changed=load({switchOnEditor:true});await assert.rejects(changed.api[method]('source','version'),/Account changed/);
    const failed=load({failEditor:true});await assert.rejects(failed.api[method]('source','version'),/Local source unavailable/);
  }
});
