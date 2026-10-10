import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
function render(page,queries){
  const cache={};
  function load(path){
    if(cache[path])return cache[path];const exports={};cache[path]=exports;
    const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,require:p=>{
      if(p==='react')return React;if(p==='react/jsx-runtime')return jsx;
      if(p==='@tanstack/react-query')return{useQuery:({queryKey})=>({isLoading:false,refetch:()=>{},...queries[queryKey.join(':')]}),useQueryClient:()=>({}),useMutation:()=>({})};
      if(p==='react-router-dom')return{Link:({children,to,...props})=>React.createElement('a',{href:to,...props},children)};
      if(p==='lucide-react')return new Proxy({},{get:()=>()=>null});
      if(p==='recharts')return new Proxy({},{get:()=>({children})=>React.createElement('div',null,children)});
      if(p.includes('ToastContext'))return{useToast:()=>({showToast:()=>{}})};
      if(p.endsWith('Pagination'))return{default:()=>null,usePagination:rows=>({pagedItems:rows,page:1,pageSize:10,totalPages:1})};
      if(p.endsWith('ReadAvailabilityNotice'))return load('../components/ReadAvailabilityNotice.tsx');
      if(p.endsWith('read-availability'))return load('../api/read-availability.ts');
      if(p.startsWith('../api/'))return{};
      if(p==='./auth')return{};
      throw Error(p);
    }});return exports;
  }
  return renderToStaticMarkup(React.createElement(load(`./${page}.tsx`).default));
}
const meta=sections=>({source:'local',readAt:'2026-10-09T12:00:00Z',sections});
test('Dashboard renders known project and unknown health, not false success states',()=>{
  const html=render('DashboardPage',{'experience:dashboard':{data:{availability:meta({inventory:'unavailable',projects:'available',tasks:'partial',recent:'partial'}),metrics:{active_projects:1,overdue_tasks:null,due_next_7_days:null,low_stock:null},projects:[{id:'p',name:'Visible project',open_tasks:null,experiment_count:null,health_score:null,health:'unknown'}],overdue:[],due:[],recent:[],low_stock:[]}}});
  assert.match(html,/Visible project/);assert.match(html,/Task totals are incomplete/);assert.match(html,/Inventory is unavailable/);assert.doesNotMatch(html,/100%|No overdue tasks\.|Stock levels are above/);
});
test('Operations keeps navigation available and does not display healthy stock for missing inventory',()=>{
  const html=render('OperationsPage',{'operations-overview':{data:{availability:meta({inventory:'unavailable',maintenance:'available',requirements:'available',bom:'unavailable'}),summary:{total_items:null,low_stock:null,equipment:null,tools:null,stock_value:null},low_stock:[],calibration_due:[],missing_bom:[],equipment:[],maintenance_due:[],requirements:[]}},'operations-suppliers':{data:[]}});
  assert.match(html,/Operations sections/);assert.match(html,/Inventory unavailable/);assert.doesNotMatch(html,/All stock healthy|All inventory is currently above|No upcoming calibration deadlines/);
});
test('Lab Intelligence keeps available metrics while failed lists are not empty lists',()=>{
  const html=render('LabIntelligencePage',{'phase4-intelligence':{data:{availability:meta({inventory:'unavailable',maintenance:'available'}),inventory:{total_items:null,low_stock:null,depleted:null},maintenance:{due:3},storage:{total:null,labeled:null,contained:null},signals:[]}},'phase4-items:1:10:':{error:Error('denied')},'phase4-containers:1:10':{error:Error('denied')}});
  assert.match(html,/Maintenance due/);assert.match(html,/>3<\/div>/);assert.match(html,/Signals are incomplete/);assert.match(html,/Inventory storage is unavailable/);assert.doesNotMatch(html,/No matching inventory|No storage containers yet/);
});

test('Reports distinguishes unavailable and partial sections from confirmed empty data',()=>{
  const html=render('ReportsPage',{'reports-overview':{data:{generated_at:'2026-10-10T12:00:00Z',
    availability:meta({projects:'available',inventory:'unavailable',tasks:'partial',experiments:'available',resources:'available',activity:'unavailable'}),
    projects:[{status:'active',count:1}],inventory:[],tasks:[{status:'todo',count:2}],experiments:[],resources:[{kind:'file',count:1}],activity:[],
  }}});
  assert.match(html,/Reports &amp; Analytics/);assert.match(html,/Incomplete total/);
  assert.match(html,/quantity is unknown, not zero/);assert.match(html,/Partial data/);
  assert.match(html,/No records in this view/);assert.match(html,/Local authorized data/);
  assert.doesNotMatch(html,/Reports unavailable/);
});

test('Collaboration missing snapshots and read errors do not claim empty history or caught-up notifications',()=>{
  const html=render('CollaborationPage',{'collaboration-activity':{data:{items:[],state:'not_downloaded',last_synced_at:null}},'notifications':{error:Error('expired lease')}});
  assert.match(html,/not been synchronized/);assert.match(html,/does not mean you have no unread/);
  assert.doesNotMatch(html,/No activity in the synchronized snapshot|No unread notifications in the local view/);
});

test('Collaboration shows persisted activity and its original snapshot timestamp',()=>{
  const html=render('CollaborationPage',{'collaboration-activity':{data:{items:[{id:'e',action:'created',entity_type:'note',actor_username:'Alice',created_at:'2026-10-10T12:00:00Z'}],state:'available',last_synced_at:'2026-10-10T12:01:00Z'}},'notifications':{data:{items:[],unread_count:0}}});
  assert.match(html,/Alice created note/);assert.match(html,/Local activity snapshot from/);
  assert.doesNotMatch(html,/Some collaboration data could not be loaded/);
});
