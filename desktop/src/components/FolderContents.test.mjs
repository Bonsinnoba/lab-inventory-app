import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness(){
  const state=[];let slot=0;
  const react={useMemo:fn=>fn(),useState:initial=>{
    const index=slot++;state[index]??=initial;
    return[state[index],value=>{state[index]=value;}];
  },useRef:()=>({current:{scrollIntoView(){}}})};
  const cache=new Map();
  function load(url){
    if(cache.has(url.href))return cache.get(url.href);
    const exports={};cache.set(url.href,exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{
      if(name==='react')return react;
      if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
      if(name==='lucide-react')return{};
      if(name.startsWith('../lib/'))return load(new URL(name+'.ts',url));
      throw Error(name);
    }});return exports;
  }
  const Component=load(new URL('./FolderContents.tsx',import.meta.url)).default;
  return props=>{slot=0;return Component(props);};
}
function nodes(tree){
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree||typeof tree!=='object')return[];
  return[tree,...nodes(tree.props?.children)];
}
function text(node){return nodes(node).flatMap(n=>Array.isArray(n.props?.children)?n.props.children:[n.props?.children]).filter(x=>typeof x==='string').join(' ');}
test('folder pagination bounds mounted rows, opens exact files and resets on navigation',()=>{
  const render=harness();const opened=[],navigated=[];
  const files=Array.from({length:120},(_,i)=>({id:`f${i}`,kind:'file',relative_path:`file${i}.txt`,original_filename:`file${i}.txt`,size_bytes:12}));
  files.push({id:'child',kind:'file',relative_path:'sub/child.txt',original_filename:'child.txt',size_bytes:1});
  let props={files,directory:'',onNavigate:p=>navigated.push(p),onOpen:id=>opened.push(id),opening:null};
  let tree=render(props);
  const rows=()=>nodes(tree).filter(n=>n.type==='button'&&n.key!=null);
  assert.equal(rows().length,48);
  nodes(tree).find(n=>n.type==='button'&&text(n)==='Next page').props.onClick();tree=render(props);
  assert.equal(rows().length,48);
  const file=rows().find(n=>n.props.title);file.props.onClick();assert.equal(opened[0],file.key);
  props={...props,directory:'sub'};tree=render(props);
  assert.equal(rows().length,1);rows()[0].props.onClick();assert.equal(opened[1],'child');
  assert.ok(nodes(tree).some(n=>n.props?.['aria-label']==='Folder path'));
});
test('folder entries and page controls respect the upload/opening lock',()=>{
  const render=harness();const files=Array.from({length:100},(_,i)=>({id:`f${i}`,relative_path:`file${i}`,original_filename:`file${i}`,size_bytes:0}));
  const tree=render({files,directory:'',onNavigate(){},onOpen(){},opening:'f0',disabled:true});
  for(const button of nodes(tree).filter(n=>n.type==='button'))assert.equal(button.props.disabled,true);
});
