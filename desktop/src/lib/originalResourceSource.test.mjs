import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./originalResourceSource.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL});
const {originalResourceSource:source,resourceCopyMessage:message}=exports;
test('watch, short, mobile, live and privacy-provider links use a fixed embed origin',()=>{
  for(const url of ['https://youtube.com/watch?v=M7lc1UVf-VE','https://youtu.be/M7lc1UVf-VE','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube.com/live/M7lc1UVf-VE','https://youtube-nocookie.com/embed/M7lc1UVf-VE']){
    assert.equal(source(url).embed,'https://www.youtube.com/embed/M7lc1UVf-VE?rel=0');assert.equal(source(url).url,new URL(url).href);
  }
});
test('embed never forwards original credentials or query parameters',()=>{
  assert.equal(source('https://youtu.be/M7lc1UVf-VE?access_token=secret&autoplay=1').embed,'https://www.youtube.com/embed/M7lc1UVf-VE?rel=0');
  for(const url of ['javascript:alert(1)','file:///C:/private','http://youtube.com/watch?v=M7lc1UVf-VE','https://user:password@youtube.com/watch?v=M7lc1UVf-VE','not a url'])assert.equal(source(url),null);
});
test('host impersonation, ports and malformed IDs cannot become embeds',()=>{
  for(const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://evil.test/youtube.com/M7lc1UVf-VE','https://youtube.com:444/watch?v=M7lc1UVf-VE','https://youtube.com/watch?v=bad%22id','https://youtube.com/watch?v=short'])assert.equal(source(url).embed,null);
});
test('other HTTPS sources remain external-only',()=>assert.equal(source('https://www.facebook.com/reel/12345').embed,null));
test('status distinguishes original link, copying, error and unverified cached download',()=>{
  assert.match(message({}),/not recorded/);
  assert.match(message({local_media_filename:'video.mp4',local_copy:{state:'copying'}}),/Copying/);
  assert.match(message({local_media_filename:'video.mp4',local_copy:{state:'error'}}),/attention/);
  assert.match(message({local_media_filename:'video.mp4'}),/verified copy is not available/);
});
