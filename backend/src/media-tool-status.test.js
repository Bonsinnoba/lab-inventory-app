import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaToolInspector} from './media-tool-status.js';

const commands={yt_dlp:{path:'yt-dlp',args:['--version']},ffmpeg:{path:'ffmpeg',args:['-version']},node:{path:'node',args:['--version']}};
test('parallel tool inspection caches positive and negative results with check time',async()=>{
  let at=1000;const calls=[];
  const inspect=createMediaToolInspector({commands,production:false,now:()=>at,probe:async(path,args)=>{
    calls.push([path,args]);if(path==='ffmpeg')throw Error('x'.repeat(900));
  }});
  const first=await inspect();
  assert.equal(first.checked_at,new Date(1000).toISOString());assert.equal(first.production,false);
  assert.equal(first.yt_dlp.available,true);assert.equal(first.ffmpeg.available,false);assert.equal(first.ffmpeg.error.length,500);
  at=60999;assert.equal(await inspect(),first);assert.equal(calls.length,3);
  at=61000;assert.notEqual(await inspect(),first);assert.equal(calls.length,6);
});
test('concurrent snapshots share one probe set and timestamp completion',async()=>{
  let at=1000;let release;let count=0;const gate=new Promise(r=>{release=r;});
  const inspect=createMediaToolInspector({commands,production:true,now:()=>at,probe:async()=>{count++;await gate;}});
  const a=inspect();const b=inspect();assert.equal(count,3);at=2000;release();
  const [one,two]=await Promise.all([a,b]);assert.equal(one,two);assert.equal(one.checked_at,new Date(2000).toISOString());
});
test('clock rollback refreshes instead of extending old cached observations',async()=>{
  let at=2000;let count=0;
  const inspect=createMediaToolInspector({commands,production:false,now:()=>at,probe:async()=>{count++;}});
  await inspect();at=1000;await inspect();assert.equal(count,6);
});
test('failed probes recover after cache expiry without rejecting the snapshot',async()=>{
  let failed=true;let at=0;
  const inspect=createMediaToolInspector({commands,production:false,now:()=>at,ttlMs:10,probe:async()=>{if(failed)throw Error('missing');}});
  assert.equal((await inspect()).node.available,false);failed=false;at=10;
  assert.equal((await inspect()).node.available,true);
});
