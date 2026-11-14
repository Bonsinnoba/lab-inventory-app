import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseXlsx} from '../../../backend/src/lib/xlsx.js';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./workbook.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Blob,TextEncoder,Uint8Array,DataView,ArrayBuffer});
test('offline workbook round-trips literal formulas, unicode, numbers and wide columns',async()=>{
 const row=Array.from({length:30},(_,i)=>i===0?'=HYPERLINK("https://example.invalid")':i===1?'工程 🧪 & <lab>':i===2?17.25:`column ${i}`);
 const blob=exports.buildWorkbook([{name:'Instructions',rows:[['Source','Local snapshot']]},{name:'Inventory',rows:[row]}]);
 assert.match(blob.type,/spreadsheetml/);const bytes=Buffer.from(await blob.arrayBuffer()),parsed=parseXlsx(bytes);
 assert.deepEqual(parsed.sheets[1].rows[0],row);assert.equal(parsed.sheets[0].name,'Instructions');assert.equal(bytes.includes(Buffer.from('<f>')),false);
});
test('offline writer rejects ambiguous sheet names and excessive dimensions',()=>{
 assert.throws(()=>exports.buildWorkbook([{name:'A',rows:[]},{name:'a',rows:[]}]),/Invalid/);
 assert.throws(()=>exports.buildWorkbook([{name:'A/B',rows:[]}]),/dimensions/);
 assert.throws(()=>exports.buildWorkbook([{name:'A',rows:[Array(257).fill('x')]}]),/dimensions/);
});
