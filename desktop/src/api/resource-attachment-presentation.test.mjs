import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-attachment-presentation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('offline attachments resolve IDs even without joined labels',()=>{
  assert.equal(exports.resourceAttachmentLabel({project_id:'p'},[{id:'p',name:'Lab project'}],[],[]),'Project: Lab project');
  assert.equal(exports.resourceAttachmentLabel({project_id:'p'},[],[],[]),'Project: Linked project');
  assert.equal(exports.resourceAttachmentLabel({note_id:'n'},[],[],[{id:'n',title:'Note'}]),'Note: Note');
  assert.equal(exports.resourceAttachmentLabel({item_id:'i'},[],[{id:'i',name:'Sensor'}],[]),'Item: Sensor');
  assert.equal(exports.resourceAttachmentLabel({project_name:'stale'},[],[],[]),'Unattached');
});
test('attachment changes invalidate library, scoped panels and project workspace',async()=>{
  const keys=[];
  await exports.invalidateResourceAttachments({invalidateQueries:async({queryKey})=>keys.push(queryKey.join('/'))});
  assert.deepEqual(keys,['resources','project-workspace']);
});
test('native link creation uses Tauri camelCase parent arguments',()=>{
  const source=readFileSync(new URL('./resources.ts',import.meta.url),'utf8');
  assert.match(source,/create_local_resource_link', \{ url, name, itemId:parent.item_id\?\?null, projectId:parent.project_id\?\?null, noteId:parent.note_id\?\?null/);
});
