import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./musicLibrary.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:webcrypto,TextEncoder,console});
const {uniqueMusicIds,addMusicIds,nextQueueTrack,musicFolderEntries,musicContentId,normalizeMusicQueue,moveMusicId,shuffleMusicIds,musicPage}=exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const tracks=[{id:'a',name:'One.mp3',contentId:'same'},{id:'alias',name:'Renamed.mp3',contentId:'same'},{id:'b',name:'Two.mp3',contentId:'other'},{id:'c',name:'Three.mp3'}];
const queue=()=>({id:'q',name:'Folder',trackIds:['a','b','c'],currentId:'a',position:42,shuffle:false,repeat:'off'});
test('one song once despite repeated ids, renamed content aliases or stale library ids',()=>{
  assert.deepEqual(plain(uniqueMusicIds(['a','a','alias','missing','b'],tracks)),['a','b']);
});
test('append and repeated merges preserve order and current playback without duplicates',()=>{
  const q=queue();const next=addMusicIds(q,['b','b','alias','c'],'end',tracks);
  assert.deepEqual(plain(next),q);assert.deepEqual(plain(q.trackIds),['a','b','c']);
});
test('play next moves an existing song and never queues another copy of the current song',()=>{
  const q=addMusicIds(queue(),['c','alias','c'],'next',tracks);
  assert.deepEqual(plain(q.trackIds),['a','c','b']);assert.equal(q.position,42);
});
test('play next respects selected order and works before playback has started',()=>{
  assert.deepEqual(plain(addMusicIds({...queue(),currentId:null},['c','b'],'next',tracks).trackIds),['c','b','a']);
});
test('folder queue ends inside its own scope without falling through to the whole library',()=>{
  assert.equal(nextQueueTrack({...queue(),currentId:'c'},true),null);
  assert.equal(nextQueueTrack({...queue(),currentId:'c',repeat:'all'},true),'a');
  assert.equal(nextQueueTrack({...queue(),currentId:'c',repeat:'one'},true),'c');
  assert.equal(nextQueueTrack({...queue(),currentId:'c',repeat:'one'},false),'a');
  assert.equal(nextQueueTrack({...queue(),trackIds:[],currentId:null},false),null);
});
test('shuffle produces a unique persisted order and playback stops at its end',()=>{
  const ids=shuffleMusicIds(['a','b','c','a'],()=>0);
  assert.deepEqual([...ids].sort(),['a','b','c']);
  const q={...queue(),shuffle:true,trackIds:ids,currentId:ids[0]};
  assert.equal(nextQueueTrack(q,true),ids[1]);
  assert.equal(nextQueueTrack({...q,currentId:ids[2]},true),null);
});
test('hierarchical browsing exposes direct children and flat mode preserves nested file paths',()=>{
  const songs=[{id:'1',name:'Root.mp3',relativePath:'Root.mp3'},{id:'2',name:'One.mp3',relativePath:'Album/One.mp3'},{id:'3',name:'Two.mp3',relativePath:'Album/Disc 2/Two.mp3'},{id:'4',name:'Other.mp3',relativePath:'Album2/Other.mp3'}];
  const root=musicFolderEntries(songs,'','',false);assert.deepEqual(plain(root.folders),['Album','Album2']);assert.equal(root.files.length,1);
  const album=musicFolderEntries(songs,'Album','',false);assert.deepEqual(plain(album.folders),['Album/Disc 2']);assert.equal(album.files[0].id,'2');
  assert.equal(musicFolderEntries(songs,'Album','',true).files.length,2);
  assert.deepEqual(plain(musicFolderEntries(songs,'Album','two',false).folders),['Album/Disc 2']);
});
test('content identity ignores filenames and metadata but detects different bytes across chunks',async()=>{
  const bytes=new Uint8Array(1024*1024+7).fill(3);const a=new Blob([bytes]);
  const first=await musicContentId(a);assert.equal(first,await musicContentId(new Blob([bytes])));
  bytes[1024*1024+6]=4;assert.notEqual(first,await musicContentId(new Blob([bytes])));
  const controller=new AbortController();controller.abort();await assert.rejects(musicContentId(a,controller.signal));
});

test('restored queues canonicalize legacy aliases without losing the listening position',()=>{
  const q=normalizeMusicQueue({...queue(),trackIds:['alias','a','b','missing'],currentId:'alias'},tracks);
  assert.deepEqual(plain(q.trackIds),['a','b']);assert.equal(q.currentId,'a');assert.equal(q.position,42);
  const removed=normalizeMusicQueue({...queue(),currentId:'missing',position:Infinity},tracks);
  assert.equal(removed.currentId,null);assert.equal(removed.position,0);
});
test('drag reorder moves rather than copies and ignores stale drag targets',()=>{
  assert.deepEqual(plain(moveMusicId(['a','b','c'],'c','a')),['c','a','b']);
  assert.deepEqual(plain(moveMusicId(['a','b'],'missing','a')),['a','b']);
});

test('removing the last song on a later page retains a visible previous page and correct queue indices',()=>{
 const ids=Array.from({length:97},(_,i)=>String(i));
 const before=musicPage(ids.length,3);assert.deepEqual(ids.slice(before.start,before.end),['96']);
 ids.pop();const after=musicPage(ids.length,3);assert.equal(after.page,2);assert.equal(after.pages,2);
 assert.equal(ids.slice(after.start,after.end).length,48);assert.equal(ids[after.start],'48');
 assert.equal(musicPage(0,5).page,1);assert.equal(musicPage(3,NaN).page,1);assert.equal(musicPage(50,-3).page,1);
});

test('folder search finds genuine title and artist tags without changing stored filenames',()=>{
 const songs=[{id:'tagged',name:'track001.flac',relativePath:'Album/track001.flac',title:'Circuit nights',artist:'Bench ensemble'}];
 const result=musicFolderEntries(songs,'','ensemble',false);assert.deepEqual(plain(result.folders),['Album']);
 assert.equal(musicFolderEntries(songs,'Album','circuit',false).files[0].name,'track001.flac');
});
