import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(){
  let generation=0,signedIn=true;
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./account-read-gate.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,{exports,require:()=>({
    captureAccountSession:()=>signedIn?{generation}:null,
    isAccountSessionCurrent:s=>!!s&&signedIn&&s.generation===generation,
  })});
  return {gate:exports.createAccountReadGate(),switchAccount:()=>generation++,logout:()=>{signedIn=false;}};
}
test('newer refresh invalidates success, error and finally callbacks of older reads',()=>{
  const {gate}=load();const old=gate.begin(),latest=gate.begin();
  assert.equal(old(),false);assert.equal(latest(),true);
});
test('account switch and sign-out invalidate pending reads',()=>{
  const c=load();const old=c.gate.begin();c.switchAccount();assert.equal(old(),false);
  const next=c.gate.begin();assert.equal(next(),true);c.logout();assert.equal(next(),false);
  assert.equal(c.gate.begin()(),false);
});
test('unmount invalidation blocks completions; remount reads can proceed',()=>{
  const {gate}=load();const pending=gate.begin();gate.invalidate();
  assert.equal(pending(),false);assert.equal(gate.begin()(),true);
});
