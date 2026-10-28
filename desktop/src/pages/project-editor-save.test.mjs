import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./ProjectDetailPage.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function saveHandler(component,onSave){
 const declaration=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===component);
 let initializer;
 function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='save') initializer=node.initializer;
  ts.forEachChild(node,visit);
 }
 visit(declaration);
 assert.ok(initializer);
 const state={saving:false,editing:true,error:'old error'};
 const form={title:'Draft',description:'Keep this',assignee_id:'',due_date:'',hypothesis:'Working idea'};
 const context={form,e:{id:'experiment'},onSave,saving:false,
  setSaving:value=>{state.saving=value;context.saving=value},
  setEditing:value=>{state.editing=value},setSaveError:value=>{state.error=value},
  normalizeClientError:(error,fallback)=>({message:error?.message||fallback})};
 vm.runInNewContext(ts.transpileModule(`globalThis.save=${initializer.getText(file)}`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
 }).outputText,context);
 return {save:context.save,state,form};
}
for(const component of ['TaskCard','ExperimentCard']){
 test(`${component} waits for successful persistence before closing`,async()=>{
  let finish;let calls=0;let payload;
  const handler=saveHandler(component,value=>{calls++;payload=value;return new Promise(resolve=>{finish=resolve})});
  const pending=handler.save();
  assert.equal(handler.state.editing,true);
  assert.equal(handler.state.saving,true);
  assert.equal(handler.state.error,'');
  await handler.save();
  assert.equal(calls,1);
  finish();await pending;
  assert.equal(handler.state.editing,false);
  assert.equal(handler.state.saving,false);
  if(component==='TaskCard') {assert.equal(payload.due_date,null);assert.equal(payload.assignee_id,null)}
  else assert.equal(payload.id,'experiment');
 });
 test(`${component} retains draft and supports retry after rejection`,async()=>{
  let calls=0;
  const handler=saveHandler(component,async()=>{if(++calls===1)throw new Error('Permission changed')});
  const before=JSON.stringify(handler.form);
  await handler.save();
  assert.equal(handler.state.editing,true);
  assert.equal(handler.state.saving,false);
  assert.equal(handler.state.error,'Permission changed');
  assert.equal(JSON.stringify(handler.form),before);
  await handler.save();
  assert.equal(handler.state.editing,false);
  assert.equal(handler.state.error,'');
 });
}
test('edit callbacks expose mutation promises, while status actions retain mutation error handlers',()=>{
 assert.match(source,/onSave=\{\(data:any\)=>edit\.mutateAsync\(\{id:t\.id,\.\.\.data\}\)\}/);
 assert.match(source,/onSave=\{\(data:any\)=>edit\.mutateAsync\(data\)\}/);
 assert.match(source,/onUpdate=\{\(data:any\)=>edit\.mutate\(/);
 assert.match(source,/onStatus=\{\(data:any\)=>edit\.mutate\(/);
});

for(const [component,mutation,message] of [
 ['TaskCard','unlink','Failed to unlink experiment'],
 ['TaskCard','detach','Failed to detach resource'],
 ['ExperimentCard','detach','Failed to detach resource'],
 ['ExperimentCard','delM','Failed to delete measurement'],
 ['ExperimentCard','delO','Failed to delete observation'],
]){
 test(`${component} ${mutation} reports rejection instead of silently failing`,()=>{
  const declaration=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===component);
  let options;
  function visit(node){
   if(ts.isVariableDeclaration(node)&&node.name.getText(file)===mutation) options=node.initializer.arguments[0];
   ts.forEachChild(node,visit);
  }
  visit(declaration);
  const callback=options.properties.find(node=>node.name?.getText(file)==='onError');
  assert.ok(callback);
  const notices=[];
  const context={showToast:(...args)=>notices.push(args),normalizeClientError:(error,fallback)=>({message:error?.message||fallback})};
  vm.runInNewContext(ts.transpileModule(`globalThis.onError=${callback.initializer.getText(file)}`,{}).outputText,context);
  context.onError(new Error('Local write rejected'));
  context.onError({});
  assert.deepEqual(notices,[['Local write rejected','error'],[message,'error']]);
 });
}
