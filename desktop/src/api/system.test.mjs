import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load({desktop=false,invoke=async()=>null,fetch=async()=>{throw new Error('network must not run')},storage=new Map()}={}){
  let account='a';const exports={};
  const compiled=ts.transpileModule(readFileSync(new URL('./system.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{exports,crypto:{randomUUID},window:{dispatchEvent(){}},CustomEvent:class{},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},require:dep=>{
    if(dep==='./local-backend')return {localBackend:{isAvailable:()=>desktop,invoke}};
    if(dep==='./auth')return {captureAccountSession:()=>({accountId:account,token:account}),isAccountSessionCurrent:s=>s.accountId===account};
    if(dep==='./http')return {apiFetch:fetch,getApiErrorMessage:async()=> 'rejected'};
    throw new Error(dep);
  }});return{api:exports,switchAccount:id=>{account=id},storage};
}
for(const fault of ['null','reject'])test(`preferences ${fault} IPC does not fall back to HTTP`,async()=>{
  let requests=0;const {api}=load({desktop:true,invoke:async()=>{if(fault==='reject')throw new Error('disk failed');return null},fetch:async()=>{requests++;throw new Error('HTTP')}});
  await assert.rejects(api.getDailyUsePreferences());await assert.rejects(api.updateDailyUsePreferences({music_volume:.3}));assert.equal(requests,0);
});
test('browser music settings are account/device-local and work without a server',async()=>{
  const a=load();await a.api.updateDailyUsePreferences({music_volume:.2,auto_pause_music:true});
  a.switchAccount('b');assert.equal((await a.api.updateDailyUsePreferences({auto_pause_music:false})).music_volume,.7);
  a.switchAccount('a');assert.equal((await a.api.updateDailyUsePreferences({auto_pause_music:false})).music_volume,.2);
  const restart=load({storage:a.storage});assert.equal((await restart.api.updateDailyUsePreferences({auto_pause_music:true})).music_volume,.2);
  const otherDevice=load();assert.equal((await otherDevice.api.updateDailyUsePreferences({auto_pause_music:true})).music_volume,.7);
  await assert.rejects(a.api.updateDailyUsePreferences({music_volume:2}));
});
test('browser notification retry keeps key; no music fields are uploaded',async()=>{
  const requests=[];const {api}=load({fetch:async(path,options)=>{
    requests.push({path,...options});if(requests.length===1)throw new Error('lost response');
    return {ok:true,json:async()=>({notifications_enabled:false,sync_version:1,updated_at:null})};
  }});
  const edit={notifications_enabled:false,expected_version:0};await assert.rejects(api.updateDailyUsePreferences(edit));await api.updateDailyUsePreferences(edit);
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(requests[1].body),edit);
});
test('historical server music imports only by explicit choice and never overwrites local values',async()=>{
  const {api,storage}=load({fetch:async()=>({ok:true,json:async()=>({notifications_enabled:true,sync_version:1,legacy_media:{auto_pause_music:true,music_volume:.42}})})});
  const before=await api.getDailyUsePreferences();assert.equal(before.music_volume,.7);assert.equal(storage.size,0);
  const imported=await api.importLegacyMediaPreferences();assert.equal(imported.music_volume,.42);
  await assert.rejects(api.importLegacyMediaPreferences(),/already has music settings/);
});
