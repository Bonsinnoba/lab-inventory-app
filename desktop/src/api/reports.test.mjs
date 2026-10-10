import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(options={}) {
  let current='a',requests=0,reads=0,permissionReads=0;
  const modules={};
  const fixture={
    './auth':{captureAccountSession:()=>({accountId:current}),isAccountSessionCurrent:s=>s?.accountId===current},
    './local-backend':{localBackend:{isAvailable:()=>options.desktop!==false}},
    '@tauri-apps/api/tauri':{invoke:async()=>{
      permissionReads++;return options.permissions?options.permissions(permissionReads):['reports.view'];
    }},
    './projects':{
      getProjects:async()=>{reads++;return options.projects??[{id:'p',status:'active'}]},
      getProjectWorkspace:async id=>options.workspace?options.workspace(id,()=>{current='b'}):{tasks:[{id:'t',status:'todo'}],experiments:[]},
    },
    './local-inventory':{getLocalInventorySnapshot:async()=>{
      reads++;if(options.inventoryError)throw Error('not permitted');
      return options.inventory===undefined?[{id:'i',type:'component',status:'available',unit:'pcs',current_quantity:5}]:options.inventory;
    }},
    './resources':{getAllResources:async()=>{reads++;return[{id:'r',kind:'file'}]}},
    './http':{apiFetch:async()=>{requests++;return{ok:true,json:async()=>({fromServer:true})}}},
  };
  function module(name) {
    if(modules[name])return modules[name];const exports={};modules[name]=exports;
    const code=ts.transpileModule(readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,setTimeout,clearTimeout,require:p=>{
      if(fixture[p])return fixture[p];
      if(p==='./read-availability')return module('read-availability');throw Error(p);
    }});return exports;
  }
  return {api:module('reports'),csv:module('reports-export').buildReportsCsv,requests:()=>requests,reads:()=>reads};
}

test('local report has no HTTP, separates units and counts stable identities once',async()=>{
  const c=load({inventory:[
    {id:'a',type:'supply',status:'available',unit:'ml',current_quantity:20},
    {id:'a',type:'supply',status:'available',unit:'ml',current_quantity:20},
    {id:'b',type:'supply',status:'available',unit:'g',current_quantity:5},
  ]});
  const r=await c.api.getReportsOverview();assert.equal(c.requests(),0);
  assert.equal(r.inventory.length,2);assert.equal(r.inventory.find(i=>i.unit==='ml').quantity,20);
  assert.equal(r.projects[0].count,1);assert.equal(r.tasks[0].count,1);
  assert.equal(r.resources[0].kind,'file');assert.equal(r.availability.sections.activity,'unavailable');
  assert.equal(r.availability.lastSyncedAt,undefined);
});

test('missing or denied inventory remains unavailable without blocking other sections or trying HTTP',async()=>{
  for(const options of [{inventory:null},{inventoryError:true}]) {
    const c=load(options),r=await c.api.getReportsOverview();
    assert.equal(r.availability.sections.inventory,'unavailable');assert.equal(r.projects[0].count,1);
    assert.equal(c.requests(),0);assert.equal(r.inventory.length,0);
  }
});

test('failed workspace produces partial counts, not a complete task total',async()=>{
  const c=load({projects:[{id:'p',status:'active'},{id:'q',status:'planning'}],workspace:async id=>{
    if(id==='q')throw Error('missing workspace');return{tasks:[{id:'t',status:'todo'}],experiments:[]};
  }}),r=await c.api.getReportsOverview();
  assert.equal(r.availability.sections.tasks,'partial');assert.equal(r.availability.sections.experiments,'partial');assert.equal(r.tasks[0].count,1);
});

test('native report permission denied at entry prevents source reads',async()=>{
  const c=load({permissions:()=>[]});await assert.rejects(c.api.getReportsOverview(),/Reports access required/);
  assert.equal(c.reads(),0);assert.equal(c.requests(),0);
});

test('permission revocation or account switch during generation discards report',async()=>{
  const revoked=load({permissions:count=>count===1?['reports.view']:[]});
  await assert.rejects(revoked.api.getReportsOverview(),/Reports access required/);
  const switched=load({workspace:async(_id,switchAccount)=>{switchAccount();return{tasks:[],experiments:[]}}});
  await assert.rejects(switched.api.getReportsOverview(),/Account changed/);
});

test('CSV distinguishes unknown from empty, includes inventory units and escapes formulas',async()=>{
  const c=load({inventory:null}),r=await c.api.getReportsOverview();
  r.resources=[{kind:'=CMD()',count:1}];const csv=c.csv(r);
  assert.match(csv,/"inventory","","","","","","unavailable"/);
  assert.match(csv,/"experiments","","","","0","","available"/);
  assert.match(csv,/"'=CMD\(\)"/);assert.match(csv,/completeness unverified/);
});

test('browser continues to use the server report without local repository reads',async()=>{
  const c=load({desktop:false});assert.equal((await c.api.getReportsOverview()).fromServer,true);
  assert.equal(c.requests(),1);assert.equal(c.reads(),0);
});
