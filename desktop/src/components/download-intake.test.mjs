import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function render({schedule='',current=true,quality='720p'}={}){
  const exports={},calls=[],toasts=[];let mutation,state=0;
  const jsx=(type,props)=>({type,props});
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./DownloadIntake.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
  }).outputText,{exports,require:p=>{
    if(p==='react')return{useState:()=>[state++===0?quality:schedule,()=>{}]};
    if(p==='react/jsx-runtime')return{jsx,jsxs:jsx};
    if(p==='@tanstack/react-query')return{useMutation:options=>{mutation=options;return{mutate:()=>{},isPending:false,isError:false,isSuccess:false};},useQueryClient:()=>({invalidateQueries:async key=>calls.push(['invalidate',key])})};
    if(p==='../api/auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current};
    if(p==='../api/mediaDownloads')return{queueVideoDownload:async(...args)=>{calls.push(['enqueue',...args]);return{id:'job',quality,scheduled_for:args[2],sync_state:'pending_sync'};}};
    if(p==='../contexts/ToastContext')return{useToast:()=>({showToast:value=>toasts.push(value)})};
    if(p==='../api/download-presentation')return{downloadFailureMessage:()=>''};
    if(p==='lucide-react')return{CalendarClock:'calendar'};
    if(p==='./DownloadResourcePreview')return{default:'preview'};
    throw Error(p);
  }});
  const tree=exports.default({resource:{id:'existing-resource',name:'Saved video'},defaultQuality:quality});
  return{tree,calls,toasts,mutation};
}
test('rendering an automatically listed link never enqueues it',()=>{const c=render();assert.equal(c.calls.length,0);assert.ok(JSON.stringify(c.tree).includes('Awaiting schedule'));});
test('scheduling uses the existing resource identity and selected time, then refreshes downloads',async()=>{
  const c=render({schedule:'2099-12-10T12:00',quality:'480p'});
  const job=await c.mutation.mutationFn();assert.deepEqual(c.calls[0],['enqueue','existing-resource','480p',new Date('2099-12-10T12:00').toISOString()]);
  await c.mutation.onSuccess(job);assert.match(c.toasts[0],/saved on this PC/);assert.equal(c.calls[1][0],'invalidate');
});
test('using global defaults omits a per-job schedule; account switches cannot submit',async()=>{
  const c=render();await c.mutation.mutationFn();assert.equal(c.calls[0][3],undefined);
  const switched=render({current:false});await assert.rejects(switched.mutation.mutationFn(),/Account changed/);assert.equal(switched.calls.length,0);
});
test('an existing job returned by deduplication does not falsely claim the new schedule was applied',async()=>{
  const c=render({schedule:'2099-12-10T12:00'});await c.mutation.onSuccess({quality:'720p',scheduled_for:null,sync_state:'server'});assert.match(c.toasts[0],/already has a download request/);
});
test('Resources has neither queue buttons nor optional enqueue after link save',()=>{
  const main=readFileSync(new URL('../pages/ResourcesPage.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(main,/ResourceDownloadAction|queueVideoDownload|setQueueVideo|Queue download|Add Resource & Queue/);
  assert.match(main,/available in Downloads for scheduling/);
});
