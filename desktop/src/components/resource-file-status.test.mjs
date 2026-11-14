import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./ResourceFileStatus.tsx',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,{exports,require:name=>{
 if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props})};
 if(name==='../lib/runtime')return {isTauriRuntime:()=>true};
 throw Error(name);
}});

test('current native file access takes precedence over a retained network error',()=>{
 const tree=exports.default({resource:{kind:'file',local_file_available:true,local_copy:{state:'ready',error:'Resource copy unavailable (HTTP 404)'}}});
 assert.equal(tree.props.children,'LOCAL');
 assert.equal(tree.props.title,'Verified file available on this PC');
 assert.match(tree.props.className,/ui-badge-ok/);
});

test('without current native access a retained copy error remains visible',()=>{
 const tree=exports.default({resource:{kind:'file',local_file_available:false,local_copy:{state:'stale',error:'Resource copy unavailable (HTTP 404)'}}});
 assert.equal(tree.props.children,'ERROR');assert.match(tree.props.title,/404/);
 assert.doesNotMatch(tree.props.className,/ui-badge-ok/);
});
