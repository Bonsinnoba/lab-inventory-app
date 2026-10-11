import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadDescriptor,stageUploadChunk,validateUploadRelativePath} from './resource-upload-staging.js';
const resource_id='b897d1ab-9064-4873-8f62-70c8b5f13e32';
const descriptor={resource_id,size_bytes:3,sha256:'a'.repeat(64)};

test('folder paths cannot escape or alias relative destinations',()=>{
  assert.equal(validateUploadRelativePath('board/rev1/design.svg'),'board/rev1/design.svg');
  for(const path of [null,'','/root','../escape','a/../b','a/./b','a//b','C:/temp','a\\b','a\u0000b','x'.repeat(1025)])assert.throws(()=>validateUploadRelativePath(path),{status:400});
});
test('upload identity and size validation are strict',()=>{
  assert.deepEqual(uploadDescriptor(descriptor),descriptor);
  for(const value of [null,{}, {...descriptor,resource_id:'../escape'},{...descriptor,size_bytes:-1},{...descriptor,size_bytes:1.1},{...descriptor,size_bytes:2**53},{...descriptor,sha256:'abc'}]){
    assert.throws(()=>uploadDescriptor(value),{status:400});
  }
});
test('invalid chunk lengths and offsets fail before database or filesystem access',async()=>{
  const client={query:()=>{throw Error('Unexpected database access');}};
  for(const [offset,bytes] of [[1,Buffer.alloc(2)],[0,Buffer.alloc(4)],[-1,Buffer.alloc(3)],[0,[]]]){
    await assert.rejects(()=>stageUploadChunk(client,resource_id,resource_id,descriptor,offset,bytes),{status:400});
  }
});
