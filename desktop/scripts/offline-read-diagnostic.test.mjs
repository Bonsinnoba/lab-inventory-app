// Mixed regression/characterization: KNOWN GAP checks still confirm unfixed defects.
// No database writes, real account data, server stop, or product changes.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const item={id:'item',name:'Cached stock',type:'component',status:'available',initial_quantity:10,current_quantity:5};
const project={id:'project',name:'Cached project',status:'active'};
const resource={id:'resource',name:'Cached resource',kind:'link',file_type:'video'};
function load(root,overrides={}){
  const modules={},requests=[];
  const fixtures={
    './items':{getItems:async()=>[item]},
    './local-inventory':{getLocalInventorySnapshot:async()=>[item]},
    './projects':{getProjects:async()=>[project],getProjectRequirements:async()=>[],getProjectBom:async()=>[],getProjectWorkspace:async()=>({tasks:[],experiments:[]})},
    './maintenance':{listMaintenance:async()=>[]},
    './catalog':{listCatalog:async()=>[]},
    './notes':{getNotes:async()=>[]},
    './resources':{getAllResources:async()=>[resource]},
    './notifications':{listNotifications:async()=>[]},
    './comments':{},
    './activity':{listActivity:async()=>({items:[],state:'not_downloaded',next_before:null})},
    './downloads-local':{readDownloadSnapshot:async()=>({jobs:[],settings:null,snapshot_complete:true,last_synced_at:'2026-10-10T12:00:00Z'})},
    './auth':{getToken:()=>null,captureAccountSession:()=>({accountId:'fixture'}),isAccountSessionCurrent:()=>true},
    './local-backend':{localBackend:{isAvailable:()=>true}},
    '../lib/runtime':{isTauriRuntime:()=>true},
    '../lib/config':{API_BASE:'http://127.0.0.1:4000/api'},
    '@tauri-apps/api/tauri':{invoke:async command=>command==='local_current_permissions'?['reports.view']:[resource]},
    ...overrides,
  };
  const get=name=>{
    if(modules[name])return modules[name];
    const exports={};modules[name]=exports;
    const js=ts.transpileModule(readFileSync(new URL(`../src/api/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,setTimeout,clearTimeout,window:{__TAURI_IPC__:true},URLSearchParams,require:p=>{
      if(p==='./http')return{apiFetch:async path=>{requests.push(path);throw Error('INJECTED_SERVER_UNREACHABLE')},apiUrl:path=>'http://127.0.0.1:4000/api'+path,getApiErrorMessage:async()=> 'Unavailable'};
      if(Object.hasOwn(fixtures,p))return fixtures[p];
      if(['./mediaDownloads','./operations-calculations','./read-availability'].includes(p))return get(p.slice(2));
      throw Error(`Unmodeled dependency ${p}`);
    }});return exports;
  };
  return{api:get(root),requests};
}
test('Downloads: queue reads delegate to the local snapshot without HTTP',async()=>{
  const c=load('mediaDownloads');assert.equal((await c.api.getDownloadJobs()).length,0);assert.equal(c.requests.length,0);
});

test('Reports: local projection works without server transport',async()=>{
  const c=load('reports');const report=await c.api.getReportsOverview();
  assert.equal(report.projects[0].count,1);assert.equal(report.inventory[0].quantity,5);
  assert.equal(report.availability.sections.activity,'unavailable');assert.equal(c.requests.length,0);
});

test('Collaboration delegates feed reads to the local activity repository',async()=>{
  const c=load('collaboration');assert.equal((await c.api.getActivity()).state,'not_downloaded');assert.equal(c.requests.length,0);
});
test('Resources: cached desktop metadata performs no HTTP enrichment',async()=>{
  const c=load('resources');assert.equal((await c.api.getAllResources())[0].id,'resource');assert.deepEqual(c.requests,[]);
});
test('Resources: native read failure is surfaced without a server fallback',async()=>{
  const c=load('resources',{'@tauri-apps/api/tauri':{invoke:async()=>{throw Error('LOCAL_READ_FAILURE')}}});
  await assert.rejects(c.api.getAllResources(),/LOCAL_READ_FAILURE/);assert.deepEqual(c.requests,[]);
});
test('KNOWN GAP: media called local by the API is still a server URL',()=>{
  const c=load('mediaDownloads');assert.match(c.api.getLocalMediaUrl('resource'),/^http:\/\/127\.0\.0\.1:4000\/api\//);
});
for(const [module,fn] of [['operations','getOperationsOverview'],['phase4','getPhase4Intelligence'],['experience','getExperienceDashboard']]){
  test(`${module}: healthy desktop repositories serve the aggregate without HTTP`,async()=>{
    const c=load(module);assert.ok(await c.api[fn]());assert.equal(c.requests.length,0);
  });
  test(`${module}: unavailable inventory does not hide other sections or become zero`,async()=>{
    const c=load(module,{'./items':{getItems:async()=>{throw Error('LOCAL_CACHE_OR_PERMISSION_FAILURE')}}});
    const result=await c.api[fn]();assert.equal(result.availability.sections.inventory,'unavailable');
    if(module==='operations'){assert.equal(result.summary.total_items,null);assert.equal(result.availability.sections.maintenance,'available');}
    if(module==='phase4'){assert.equal(result.inventory.total_items,null);assert.equal(result.maintenance.due,0);}
    if(module==='experience'){assert.equal(result.metrics.low_stock,null);assert.equal(result.projects.length,1);}
    assert.equal(c.requests.length,0);
  });
}
test('Dashboard: unavailable workspace has unknown counts and health',async()=>{
  const c=load('experience',{'./projects':{getProjects:async()=>[project],getProjectWorkspace:async()=>{throw Error('MISSING_WORKSPACE')}}});
  const result=await c.api.getExperienceDashboard();assert.equal(result.projects[0].open_tasks,null);assert.equal(result.projects[0].health_score,null);assert.equal(result.projects[0].health,'unknown');assert.equal(result.metrics.overdue_tasks,null);
});
