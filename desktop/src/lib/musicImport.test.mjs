import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./musicImport.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,DOMException,setTimeout});
const {droppedMusicFiles:scan,pickedMusicFiles:pick,MUSIC_SCAN_LIMIT}=exports;
const file=name=>({name,size:30,webkitRelativePath:''});
const entry=name=>({name,isFile:true,isDirectory:false,file:resolve=>resolve(file(name))});
function directory(name,children,batchSize=100){return{name,isFile:false,isDirectory:true,createReader(){let position=0;return{readEntries(resolve){const batch=children.slice(position,position+batchSize);position+=batch.length;resolve(batch);}};}};}
const transfer=(...entries)=>({items:entries.map(e=>({kind:'file',webkitGetAsEntry:()=>e})),files:[]});
const opts=()=>({signal:new AbortController().signal,yieldTask:async()=>{}});

test('nested folders and every readEntries batch preserve paths/order before import',async()=>{
 const root=directory('Music',[entry('One.wav'),directory('Disc 2',[entry('Two.flac')]),...Array.from({length:125},(_,i)=>entry(`${i}.mp3`))],30);
 const result=await scan(transfer(root),opts());assert.equal(result.length,127);assert.deepEqual(Array.from(result.slice(0,2),x=>x.path),['Music/One.wav','Music/Disc 2/Two.flac']);assert.equal(result.at(-1).path,'Music/124.mp3');
});
test('drop handles are captured in the event turn, before async callbacks',async()=>{
 let available=true;const e={...entry('One.wav'),file(resolve){queueMicrotask(()=>resolve(file('One.wav')));}};
 const data={items:[{webkitGetAsEntry(){assert.ok(available);return e;}}],files:[]};const work=scan(data,opts());available=false;assert.equal((await work)[0].path,'One.wav');
});
test('fallback file list and picker retain relative paths',async()=>{
 const f={...file('One.wav'),webkitRelativePath:'Album/One.wav'};
 assert.equal(pick([f])[0].path,'Album/One.wav');assert.equal((await scan({items:[],files:[f]},opts()))[0].file,f);
});
test('huge picker selections are rejected before mapping or writing',()=>{
 assert.throws(()=>pick({length:MUSIC_SCAN_LIMIT+1}),/smaller folders/);
});
test('entry budget counts folders as well as files and returns no partial success',async()=>{
 await assert.rejects(scan(transfer(directory('Root',[entry('a'),entry('b'),entry('c')])),{...opts(),maxEntries:3}),/no songs have been imported/);
 await assert.rejects(scan({items:{length:MUSIC_SCAN_LIMIT+1},files:[]},opts()),/smaller folders/);
});
test('excessive nesting stops at the configured boundary',async()=>{
 let e=entry('leaf');for(let i=0;i<10;i++)e=directory('dir',[e]);
 await assert.rejects(scan(transfer(e),{...opts(),maxDepth:4}),/nesting exceeds 4/);
});
test('cancel rejects immediately even when a directory callback never returns',async()=>{
 const c=new AbortController();let callback;
 const root={name:'Hang',isDirectory:true,isFile:false,createReader:()=>({readEntries(resolve){callback=resolve;}})};
 const pending=scan(transfer(root),{signal:c.signal});c.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 callback([entry('late.wav')]); // A late browser callback must not reopen review.
});
test('cancel during an outstanding file callback discards late completion',async()=>{
 const c=new AbortController();let callback;
 const pending=scan(transfer({...entry('song'),file(resolve){callback=resolve;}}),{signal:c.signal});c.abort();await assert.rejects(pending,error=>error.name==='AbortError');callback(file('late'));
});
test('file read errors propagate without silently dropping files',async()=>{
 await assert.rejects(scan(transfer({...entry('gone'),file(_resolve,reject){reject(Error('File disappeared'));}}),opts()),/File disappeared/);
});
test('large scans yield and cancellation prevents processing remaining entries',async()=>{
 const c=new AbortController();let yields=0,read=0;const entries=Array.from({length:120},(_,i)=>({...entry(`${i}.wav`),file(resolve){read++;resolve(file(`${i}.wav`));}}));
 await assert.rejects(scan(transfer(...entries),{signal:c.signal,yieldTask:async()=>{yields++;c.abort();}}),e=>e.name==='AbortError');assert.equal(yields,1);assert.equal(read,50);
});
test('empty folders are successful, pre-cancelled scans never access drop data',async()=>{
 assert.equal((await scan(transfer(directory('Empty',[])),opts())).length,0);const c=new AbortController();c.abort();await assert.rejects(scan({}, {signal:c.signal}),e=>e.name==='AbortError');
});
test('progress exposes discovery counts and invalid limit overrides fail closed',async()=>{
 const progress=[];await scan(transfer(entry('One')),{...opts(),onProgress:(...x)=>progress.push(x)});assert.deepEqual(progress.at(-1),[1,1]);
 for(const maxEntries of [0,-1,Infinity,NaN,MUSIC_SCAN_LIMIT+1])await assert.rejects(scan(transfer(entry('One')),{...opts(),maxEntries}),/Invalid folder scan limits/);
});
