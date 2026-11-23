import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import test from 'node:test';import assert from 'node:assert/strict';
function workspace(allowed){
 const exports={},calls=[];vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./MediaManager.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{
 if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='react-router-dom')return{Link:'link'};if(name==='lucide-react')return{};if(name==='./DailyUsePanel')return{default:'daily-panel'};throw Error(name);
 }});return{render:open=>exports.default({open,onOpenMusic:()=>calls.push('music'),canManageDownloads:allowed}),calls};
}
function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
test('hub keeps downloads navigation permission-gated and account/settings routes accessible',()=>{
 for(const allowed of [false,true]){const tree=nodes(workspace(allowed).render(true));const routes=tree.filter(n=>n.type==='link').map(n=>n.props.to);assert.equal(routes.includes('/downloads'),allowed);assert.ok(routes.includes('/resources'));assert.ok(routes.includes('/settings'));assert.equal(tree.filter(n=>n.type==='daily-panel').length,1);assert.equal(tree.find(n=>n.type==='daily-panel').props.embedded,true);}
});
test('opening music delegates only to the existing transport action',()=>{
 const h=workspace(true);assert.equal(h.render(false),null);const button=nodes(h.render(true)).find(n=>n.type==='button'&&n.props.className==='media-hub-card text-left');assert.deepEqual(h.calls,[]);button.props.onClick();assert.deepEqual(h.calls,['music']);
});
