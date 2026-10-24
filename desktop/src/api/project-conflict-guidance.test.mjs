import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./project-conflict-guidance.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports});
const guidance=exports.projectConflictGuidance;

test('history protection blocks blind deletion retries without promising restoration',()=>{
  for(const error_code of ['PROJECT_INVENTORY_HISTORY_PROTECTED','PROJECT_RECORDED_HISTORY_PROTECTED']){
    const result=guidance({entity_type:'project',operation:'delete',error_code});
    assert.equal(result.retryBlocked,true);assert.equal(result.acceptLabel,'Cancel deletion');
    assert.match(result.explanation,/archive/);assert.match(result.confirmation,/authorized sync/);
    assert.match(result.confirmation,/Other pending edits remain unchanged/);
  }
});
test('lifecycle conflict requires review rather than silent rebase',()=>{
  const result=guidance({entity_type:'project',operation:'update',error_code:'PROJECT_LIFECYCLE_CONFLICT'});
  assert.equal(result.retryBlocked,true);assert.equal(result.acceptLabel,'Use server status');
  assert.match(result.confirmation,/original payload remains retained/);
});
test('transient busy deletion remains retryable',()=>{
  assert.equal(guidance({entity_type:'project',operation:'delete',error_code:'PROJECT_HISTORY_BUSY'}).retryBlocked,false);
});
test('unrelated conflicts retain their existing domain actions',()=>{
  assert.equal(guidance({entity_type:'resource',operation:'delete',error_code:'PROJECT_RECORDED_HISTORY_PROTECTED'}),null);
  assert.equal(guidance({entity_type:'project',operation:'update',error_code:'PERMISSION_DENIED'}),null);
});
test('restricted project does not disclose the kind of recorded history',()=>{
  const result=guidance({entity_type:'project',operation:'delete',error_code:'PROJECT_RECORDED_HISTORY_PROTECTED',access_restricted:true});
  assert.match(result.explanation,/does not restore access/);assert.doesNotMatch(result.explanation,/Recorded history/);
});

const componentExports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/ProjectConflictActions.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,{exports:componentExports,require:name=>{
  if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='../api/project-conflict-guidance')return exports;
  throw Error(name);
}});
test('protected deletion renders disabled retry and explicit cancel action',()=>{
  const html=renderToStaticMarkup(React.createElement(componentExports.default,{
    conflict:{entity_type:'project',operation:'delete',error_code:'PROJECT_RECORDED_HISTORY_PROTECTED'},busy:false,onResolve(){}
  }));
  assert.match(html,/<button[^>]*disabled=""[^>]*>Retry local change<\/button>/);
  assert.match(html,/>Cancel deletion<\/button>/);assert.doesNotMatch(html,/>Dismiss</);
});
test('busy state disables both actions',()=>{
  const html=renderToStaticMarkup(React.createElement(componentExports.default,{
    conflict:{entity_type:'project',operation:'update',error_code:'PROJECT_LIFECYCLE_CONFLICT'},busy:true,onResolve(){}
  }));
  assert.equal((html.match(/disabled=""/g)??[]).length,2);
});
