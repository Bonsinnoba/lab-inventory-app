import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

function load(invoke,{desktop=true,signedIn=true,itemApi={}}={}) {
  let generation=0,requests=0;const exports={};
  const source=ts.transpileModule(readFileSync(new URL('./projects.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(source,{exports,crypto:webcrypto,window:desktop?{__TAURI_IPC__:true}:{},require:name=>{
    if(name==='@tauri-apps/api/tauri')return{invoke};
    if(name==='./auth')return{
      captureAccountSession:()=>signedIn?{accountId:'a',generation}:null,
      isAccountSessionCurrent:s=>!!s&&signedIn&&s.generation===generation
    };
    if(name==='./http')return{apiFetch:async()=>{requests++;return{ok:true,json:async()=>[{id:'server'}]}}};
    if(name==='./items')return itemApi;
    if(name==='./transactions')return{};
    throw Error(name);
  }});
  return{api:exports,requests:()=>requests,switchAccount:()=>generation++};
}
test('desktop reservations read the native projection without an HTTP refresh',async()=>{
  const c=load(async(command,args)=>{assert.equal(command,'get_local_project');assert.equal(args.projectId,'p');return{reservations:[{id:'local',quantity:4,local_pending_issue_quantity:2}]}});
  assert.equal((await c.api.getProjectReservations('p'))[0].quantity,4);assert.equal(c.requests(),0);
});
test('missing, rejected and old native snapshots never fall through to HTTP',async()=>{
  for(const mode of ['missing','reject','old']){
    const c=load(async()=>{if(mode==='reject')throw Error('lease expired');return mode==='missing'?null:{id:'p'}});
    await assert.rejects(c.api.getProjectReservations('p'));assert.equal(c.requests(),0);
  }
});
test('native confirmed empty reservations are distinct from an unavailable snapshot',async()=>{
  const c=load(async()=>({reservations:[]}));assert.equal((await c.api.getProjectReservations('p')).length,0);assert.equal(c.requests(),0);
});
test('account switches suppress late reservation results and absent login avoids IPC',async()=>{
  let c;c=load(async()=>{c.switchAccount();return{reservations:[{id:'old-account'}]}});
  await assert.rejects(c.api.getProjectReservations('p'),/Account changed/);assert.equal(c.requests(),0);
  let calls=0;const absent=load(async()=>{calls++},{signedIn:false});
  await assert.rejects(absent.api.getProjectReservations('p'),/Sign in/);assert.equal(calls,0);
});
test('web reservations retain their existing HTTP read path',async()=>{
  const c=load(async()=>{throw Error('Unexpected IPC')},{desktop:false});
  assert.equal((await c.api.getProjectReservations('p'))[0].id,'server');assert.equal(c.requests(),1);
});

for(const [name,field] of [['getExperimentMeasurements','measurements'],['getExperimentObservations','observations'],['getExperimentRevisions','revisions']]){
  test(`${name}: desktop records and confirmed empty collections stay local`,async()=>{
    for(const rows of [[],[{id:'record'}]]){
      const c=load(async(command,args)=>{assert.equal(command,'get_local_project_experiments');assert.equal(args.projectId,'p');return[{id:'e',[field]:rows}]});
      assert.equal((await c.api[name]('p','e')).length,rows.length);assert.equal(c.requests(),0);
    }
  });
  test(`${name}: missing experiment, missing collection and malformed snapshot never use HTTP`,async()=>{
    for(const snapshot of [null,{},[],[{id:'other',[field]:[]}],[{id:'e'}],[{id:'e',[field]:'prose is not a record collection'}]]){
      const c=load(async()=>snapshot);await assert.rejects(c.api[name]('p','e'));assert.equal(c.requests(),0);
    }
    const denied=load(async()=>{throw Error('permission denied')});
    await assert.rejects(denied.api[name]('p','e'),/permission denied/);assert.equal(denied.requests(),0);
  });
  test(`${name}: stale account responses are suppressed and absent login avoids IPC`,async()=>{
    let c;c=load(async()=>{c.switchAccount();return[{id:'e',[field]:[]}]});
    await assert.rejects(c.api[name]('p','e'),/Account changed/);assert.equal(c.requests(),0);
    let calls=0;const absent=load(async()=>{calls++},{signedIn:false});
    await assert.rejects(absent.api[name]('p','e'),/Sign in/);assert.equal(calls,0);
  });
  test(`${name}: web reads retain HTTP transport`,async()=>{
    const c=load(async()=>{throw Error('Unexpected IPC')},{desktop:false});
    assert.equal((await c.api[name]('p','e'))[0].id,'server');assert.equal(c.requests(),1);
  });
}

test('project review uses the confirmed local snapshot rather than optimistic project state',async()=>{
  const snapshot={project:{id:'p',review_status:'draft',status:'planning'},events:[]};
  const c=load(async(command,args)=>{assert.equal(command,'get_local_project');assert.equal(args.projectId,'p');return{id:'p',status:'active',review_snapshot:snapshot}});
  assert.deepEqual(await c.api.getProjectReview('p'),snapshot);assert.equal(c.requests(),0);
});
test('project review never falls back to HTTP for absent, malformed or foreign snapshots',async()=>{
  for(const value of [null,{}, {id:'p'}, {id:'other',review_snapshot:{project:{id:'p',review_status:'draft'},events:[]}}, {id:'p',review_snapshot:{project:{id:'other',review_status:'draft'},events:[]}}, {id:'p',review_snapshot:{project:{id:'p',review_status:'invented'},events:[]}}, {id:'p',review_snapshot:{project:{id:'p',review_status:'draft'},events:null}}]){
    const c=load(async()=>value);await assert.rejects(c.api.getProjectReview('p'));assert.equal(c.requests(),0);
  }
  const denied=load(async()=>{throw Error('permission denied')});
  await assert.rejects(denied.api.getProjectReview('p'),/permission denied/);assert.equal(denied.requests(),0);
});
test('project review rejects stale sessions and does not invoke native reads without login',async()=>{
  let c;c=load(async()=>{c.switchAccount();return{id:'p',review_snapshot:{project:{id:'p',review_status:'draft'},events:[]}}});
  await assert.rejects(c.api.getProjectReview('p'),/Account changed/);
  let calls=0;const absent=load(async()=>{calls++},{signedIn:false});
  await assert.rejects(absent.api.getProjectReview('p'),/Sign in/);assert.equal(calls,0);
});
test('desktop review decision queues native account-owned intent without HTTP fallback',async()=>{
  const c=load(async(command,args)=>{
    assert.equal(command,'save_local_project_review_intent');assert.equal(args.input.expected_account_id,'a');
    assert.equal(args.input.project_id,'p');assert.equal(args.input.decision,'approve');assert.equal(args.input.note,'reviewed');
    assert.match(args.input.change_id,/^[0-9a-f-]{36}$/);return{id:'p',status:'planning',local_review_pending:true};
  });
  assert.equal((await c.api.decideProjectReview('p','approve','reviewed')).status,'planning');assert.equal(c.requests(),0);
  const failed=load(async()=>{throw Error('native failure')});
  await assert.rejects(failed.api.decideProjectReview('p','submit',''),/native failure/);assert.equal(failed.requests(),0);
  let switched;switched=load(async()=>{switched.switchAccount();return{id:'p'}});
  await assert.rejects(switched.api.decideProjectReview('p','submit',''),/Account changed/);
});
test('browser project review retains its HTTP read',async()=>{
  const c=load(async()=>{throw Error('Unexpected IPC')},{desktop:false});
  await c.api.getProjectReview('p');assert.equal(c.requests(),1);
});

test('canonical observation records are independent from experiment prose',async()=>{
  const c=load(async()=>[{id:'e',observations:'A meaningful scientific narrative',observation_records:[{id:'row',content:'Structured observation'}]}]);
  assert.equal((await c.api.getExperimentObservations('p','e'))[0].id,'row');assert.equal(c.requests(),0);
  const empty=load(async()=>[{id:'e',observations:[{id:'legacy'}],observation_records:[]}]);
  assert.equal((await empty.api.getExperimentObservations('p','e')).length,0);
});

test('desktop request and review persist native intentions without HTTP fallback',async()=>{
  const calls=[];const c=load(async(command,args)=>{calls.push({command,args});return{id:args.input.reservation_id}});
  await c.api.requestProjectReservation('p',{item_id:'i',quantity:2,needed_from:'2026-10-21T00:00:00Z'});
  await c.api.decideProjectReservation('p','r','confirm','reviewed');
  assert.equal(calls.length,2);assert.equal(c.requests(),0);
  for(const call of calls){assert.equal(call.command,'save_local_reservation_intent');assert.equal(call.args.input.expected_account_id,'a');assert.equal(call.args.input.payload.project_id,'p');assert.match(call.args.input.change_id,/^[0-9a-f-]{36}$/);}
  assert.equal(calls[0].args.input.operation,'request');assert.equal(calls[1].args.input.operation,'decision');
  const broken=load(async()=>{throw Error('disk unavailable')});
  await assert.rejects(broken.api.requestProjectReservation('p',{}),/disk unavailable/);
  await assert.rejects(broken.api.decideProjectReservation('p','r','release',''),/disk unavailable/);
  assert.equal(broken.requests(),0);
});

test('desktop consumption preserves submission identity and never falls back to HTTP',async()=>{
  const requestId=webcrypto.randomUUID(),calls=[];
  const c=load(async()=>({reservations:[{id:'r',project_id:'p',item_id:'i',quantity:4,status:'confirmed'}]}),{itemApi:{createItemMovement:async(id,payload)=>{calls.push({id,payload});return{movement:{id:payload.movement_id,quantity:payload.quantity}}}}});
  const saved=await c.api.fulfillProjectReservation('p','r',2,requestId);
  assert.equal(calls[0].payload.movement_id,requestId);assert.equal(calls[0].payload.movement_type,'consume');assert.equal(saved.reservation.quantity,2);assert.equal(c.requests(),0);
  const failed=load(async()=>({reservations:[{id:'r',project_id:'p',item_id:'i',quantity:4,status:'confirmed'}]}),{itemApi:{createItemMovement:async()=>{throw Error('local disk failure')}}});
  await assert.rejects(failed.api.fulfillProjectReservation('p','r',2,requestId),/local disk failure/);assert.equal(failed.requests(),0);
});
