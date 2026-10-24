import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./ExperimentCollectionStatus.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}
}).outputText,{exports,require:createRequire(import.meta.url)});
const render=query=>renderToStaticMarkup(React.createElement(exports.default,{
  query:{isError:false,isPending:false,isFetching:false,refetch:()=>{},...query},
  label:'Revision records',empty:'No edits recorded yet.'
}));
test('failed initial read is unavailable, never falsely empty',()=>{
  const html=render({isError:true});
  assert.match(html,/are unavailable/);assert.match(html,/Retry/);
  assert.doesNotMatch(html,/No edits recorded yet/);
});
test('failed background refresh explicitly retains previously loaded data',()=>{
  for(const data of [[],[{id:'retained'}]]) {
    const html=render({isError:true,data});
    assert.match(html,/Showing the last loaded data/);
    assert.doesNotMatch(html,/No edits recorded yet/);
  }
});
test('pending and successful empty collections have distinct presentation',()=>{
  assert.match(render({isPending:true}),/Loading/);
  assert.doesNotMatch(render({isPending:true}),/No edits recorded yet/);
  assert.match(render({data:[]}),/No edits recorded yet/);
});
test('successful background refresh adds no loading notice for retained rows',()=>{
  assert.equal(render({data:[{id:'retained'}],isFetching:true}),'');
  assert.match(render({isError:true,isFetching:true}),/disabled/);
});
