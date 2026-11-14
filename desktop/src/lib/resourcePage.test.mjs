import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resourcePage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
test('large matching set mounts at most 48 cards and every result remains reachable',()=>{
  const all=Array.from({length:10001},(_,i)=>i), seen=[];
  const pages=exports.resourcePage(all,0).pages;
  for(let i=0;i<pages;i++){
    const page=exports.resourcePage(all,i);assert.ok(page.rows.length<=48);seen.push(...page.rows);
  }
  assert.deepEqual(seen,all);assert.equal(all.length,10001);
});
test('refresh removals clamp stale pages and new filter results can start at page zero',()=>{
  assert.equal(exports.resourcePage([1,2],40).index,0);
  assert.deepEqual([...exports.resourcePage([],90).rows],[]);
  assert.equal(exports.resourcePage([],90).pages,1);
  for(const value of [-1,NaN,Infinity])assert.equal(exports.resourcePage([1],value).index,0);
  const filtered=Array.from({length:55},(_,i)=>i);
  assert.equal(exports.resourcePage(filtered,1).rows.length,7);
  assert.equal(exports.resourcePage(filtered,0).rows[0],0);
});
