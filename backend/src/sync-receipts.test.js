import test from 'node:test';
import assert from 'node:assert/strict';
import {syncResponseProjection as project} from './sync-receipts.js';
const permissions=new Set(['resources.create','resources.edit']);
test('uploaded file receipt includes the native binding keys but no record snapshot',()=>{
  assert.deepEqual(project('resource',{kind:'file',id:'file-id',updated_at:'revision',name:'private',storage_path:'secret'},permissions),
    {acknowledged:true,id:'file-id',updated_at:'revision'});
});
test('other records remain redacted, including revoked file permission',()=>{
  for(const kind of ['note','project','transaction'])assert.deepEqual(project(kind,{id:'id',body:'private'},permissions),{acknowledged:true});
  assert.deepEqual(project('resource',{kind:'file',id:'id',updated_at:'date'},new Set()),{acknowledged:true});
});
test('download receipts retain version and deletion confirmation, never URLs or paths',()=>{
  const receipt={id:'job',resource_id:'resource',deleted:true,control_version:4};
  assert.deepEqual(project('resource_download_job',{...receipt,resource_url:'secret',error_message:'private path',storage_path:'secret'},permissions),{acknowledged:true,...receipt});
  assert.deepEqual(project('resource_download_job',receipt,new Set()),{acknowledged:true});
});
test('settings confirmation retains validated settings and version, not updater identity',()=>{
  const receipt={enabled:true,mode:'manual',window_start:'01:00',window_end:'05:00',concurrent_downloads:1,default_quality:'best',max_retries:2,sync_version:9};
  assert.deepEqual(project('media_download_settings',{...receipt,updated_by:'private'},permissions),{acknowledged:true,...receipt});
});
