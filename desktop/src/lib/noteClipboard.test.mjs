import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={},require=createRequire(import.meta.url);
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./noteClipboard.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require});
const image=(type='image/png',size=10)=>({type,size});
test('clipboard image selection handles Windows file items and files fallback without capturing text',()=>{
 const png=image(),text={type:'text/plain',size:5};
 assert.deepEqual(Array.from(exports.clipboardImages({items:[{kind:'string',getAsFile:()=>null},{kind:'file',getAsFile:()=>png}],files:[png]})),[png]);
 assert.deepEqual(Array.from(exports.clipboardImages({items:[],files:[png,text]})),[png]);
 assert.equal(exports.clipboardImages({items:[],files:[text]}).length,0);
});
test('clipboard rejects active SVG, empty, oversized and excessive image batches before saving',()=>{
 for(const files of [[image('image/svg+xml')],[image('image/png',0)],[image('image/png',20*1024*1024+1)],Array.from({length:5},()=>image())])assert.throws(()=>exports.validateClipboardImages(files));
 assert.doesNotThrow(()=>exports.validateClipboardImages([image(),image('image/jpeg'),image('image/webp'),image('image/gif',20*1024*1024)]));
});
