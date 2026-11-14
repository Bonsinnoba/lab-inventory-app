import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {browserUploadRequest} from './resource-browser-upload-receipts.js';
test('browser upload identity binds streamed actual bytes, normalized destination and authored details',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'labos-upload-identity-')),file=path.join(directory,'input');
 try{
  const contents=Buffer.alloc(3*1024*1024+17,71),key=randomUUID(),folder=randomUUID();await fs.writeFile(file,contents);
  const req={headers:{'idempotency-key':key.toUpperCase()},params:{folderId:folder.toUpperCase()},body:{relative_paths:'["virtual/input.txt"]'}};
  const metadata={category:'general',description:'Reviewed description',tags:['lab']};
  const input={path:file,originalname:'input.txt',mimetype:'text/plain',size:contents.length};
  const request=await browserUploadRequest(req,[input],true,metadata);
  assert.equal(request.key,key);assert.equal(request.payload.files[0].sha256,createHash('sha256').update(contents).digest('hex'));
  assert.equal(request.payload.parents.parent_resource_id,folder.replaceAll('-',''));assert.deepEqual(request.payload.metadata,metadata);assert.deepEqual(request.payload.paths,['virtual/input.txt']);
  await assert.rejects(browserUploadRequest(req,[{...input,size:1}],true,metadata),error=>error.code==='UPLOAD_SOURCE_CHANGED');
  await assert.rejects(browserUploadRequest({...req,headers:{'idempotency-key':'bad'}},[input],true,metadata),error=>error.code==='INVALID_UPLOAD_REQUEST_ID');
  assert.equal(await browserUploadRequest({...req,headers:{}},[input],true,metadata),null,'Legacy clients do not gain a guessed receipt');
 }finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(directory);}
});
