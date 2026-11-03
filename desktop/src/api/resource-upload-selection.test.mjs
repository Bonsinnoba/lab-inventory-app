import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-upload-selection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const file=(name)=>({name,webkitRelativePath:''});
const entry=(name)=>({name,isFile:true,isDirectory:false,file:ok=>ok(file(name))});
function folder(name,batches){return{name,isFile:false,isDirectory:true,createReader:()=>{let n=0;return{readEntries:ok=>ok(batches[n++]||[])}}};}
const drop=(...entries)=>({items:entries.map(e=>({kind:'file',webkitGetAsEntry:()=>e})),files:[]});
test('picker preserves every selected file and nested folder path',()=>{
 const selected=exports.filesFromPicker([file('a.pdf'),{name:'b.png',webkitRelativePath:'Lab/photos/b.png'}]);
 assert.equal(selected.length,2);assert.equal(selected[1].path,'Lab/photos/b.png');
});
test('drop walks all directory-reader batches, including nested directories and loose files',async()=>{
 const selected=await exports.filesFromDrop(drop(folder('Lab',[[entry('one.pdf')],[folder('nested',[[entry('two.png')]])]]),entry('loose.txt')));
 assert.deepEqual(Array.from(selected,x=>x.path),['Lab/one.pdf','Lab/nested/two.png','loose.txt']);
});
test('drop falls back to the complete FileList when entries are unavailable',async()=>{
 const selected=await exports.filesFromDrop({items:[],files:[file('a'),file('b')]});assert.equal(selected.length,2);
});
test('unreadable directories and empty folders fail visibly',async()=>{
 await assert.rejects(()=>exports.filesFromDrop(drop(folder('empty',[]))),/No files/);
 await assert.rejects(()=>exports.filesFromDrop(drop({name:'bad',isDirectory:true,createReader:()=>({readEntries:(_,fail)=>fail(Error('denied'))})})),/denied/);
});
test('selection limits are enforced for picker and recursive drop',async()=>{
 assert.throws(()=>exports.filesFromPicker(Array.from({length:201},()=>file('f'))),/200/);
 await assert.rejects(()=>exports.filesFromDrop(drop(folder('large',[Array.from({length:201},(_,i)=>entry('f'+i))]))),/200/);
});
