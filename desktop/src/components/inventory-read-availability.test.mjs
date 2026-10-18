import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';

function render(component, queries, session = {accountId:'account-a',generation:7}) {
  const keys = [], exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`./${component}.tsx`,import.meta.url),'utf8'), {
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if (p==='react') return React;
    if (p==='react/jsx-runtime') return jsx;
    if (p==='@tanstack/react-query') return {
      useQuery:({queryKey})=>{keys.push(queryKey);return {data:[],isLoading:false,isError:false,refetch:()=>{},...queries[queryKey[0]]}},
      useQueryClient:()=>({}), useMutation:()=>({}),
    };
    if (p==='lucide-react') return new Proxy({},{get:()=>()=>null});
    if (p==='../api/auth') return {captureAccountSession:()=>session};
    if (p==='../api/items') return {};
    if (p==='../contexts/ToastContext') return {useToast:()=>({showToast:()=>{}})};
    if (p==='../lib/utils') return {formatQuantity:n=>String(n)};
    throw Error(p);
  }});
  return {keys,html:renderToStaticMarkup(React.createElement(exports.default,{itemId:'item',item:{id:'item',current_quantity:10}}))};
}

test('field/assignment errors hide retained data while the authorized section remains visible',()=>{
  const row = {id:'history',field_name:'name',old_value:'before',new_value:'SECRET',changed_at:'2026-10-18'};
  const assignment = {id:'assignment',action:'UPDATE',actor_username:'AUTHORIZED',created_at:'2026-10-18'};
  const {html} = render('ItemHistoryPanel',{
    itemHistory:{isError:true,data:[row]},itemAssignmentHistory:{data:[assignment]},
  });
  assert.match(html,/Field history is unavailable/);
  assert.match(html,/AUTHORIZED/);
  assert.doesNotMatch(html,/SECRET|No changes recorded/);
  const reverse = render('ItemHistoryPanel',{
    itemHistory:{data:[{...row,new_value:'VISIBLE'}]},
    itemAssignmentHistory:{isError:true,data:[{...assignment,actor_username:'SECRET'}]},
  }).html;
  assert.match(reverse,/Assignment history is unavailable/);
  assert.match(reverse,/VISIBLE/);
  assert.doesNotMatch(reverse,/SECRET/);
});

test('missing history is not described as an empty history',()=>{
  const failed = render('ItemHistoryPanel',{itemHistory:{isError:true},itemAssignmentHistory:{isError:true}}).html;
  assert.doesNotMatch(failed,/No changes recorded/);
  assert.match(failed,/unavailable/);
  assert.match(render('ItemHistoryPanel',{}).html,/No changes recorded/);
  assert.match(render('ItemHistoryPanel',{itemAssignmentHistory:{isLoading:true}}).html,/Loading history/);
});

test('movement read failures hide retained rows and disable stock operations',()=>{
  for (const name of ['item-movements','item-custody','assignee-directory']) {
    const queries = {
      'item-movements':{data:[{id:'m',movement_type:'receive',quantity:1,reason:'SECRET'}]},
      'item-custody':{data:[{id:'c',outstanding_quantity:2,recipient_username:'SECRET'}]},
      'assignee-directory':{data:[{id:'u',username:'SECRET'}]},
    };
    queries[name].isError=true;
    const {html} = render('InventoryMovementPanel',queries);
    assert.match(html,/movement details are unavailable/);
    assert.doesNotMatch(html,/SECRET|Record Movement|No movement|No outstanding/);
  }
});

test('inventory queries are partitioned by account and login generation, not bearer token',()=>{
  for (const component of ['ItemHistoryPanel','InventoryMovementPanel']) {
    const {keys} = render(component,{}, {accountId:'account-b',generation:9,token:'never-in-cache-key'});
    for (const key of keys) {
      assert.equal(key.at(-2),'account-b');
      assert.equal(key.at(-1),9);
      assert.ok(!key.includes('never-in-cache-key'));
    }
  }
});
