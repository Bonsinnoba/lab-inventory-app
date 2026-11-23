import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import test from 'node:test';import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./assistantPresentation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('response navigation associates actual prompts without inventing missing questions',()=>{
  const messages=[{role:'model',content:'Older imported response'},{role:'user',content:'Inspect this project'},{role:'model',content:'Result'},{role:'model',content:'Continuation'},{role:'user',content:'Plan the next task'},{role:'model',content:''}];
  const result=exports.responsePrompts(messages);assert.equal(result.length,2);assert.equal(result[0].index,2);assert.equal(result[0].question,'Inspect this project');assert.equal(result[1].index,5);assert.equal(result[1].question,'Plan the next task');assert.equal(messages[1].content,'Inspect this project');
});
test('retry restoration cannot overwrite an unsent draft',()=>{
  assert.equal(exports.canRestorePrompt('My unsent work','Older prompt'),false);assert.equal(exports.canRestorePrompt('','Older prompt'),true);assert.equal(exports.canRestorePrompt('Older prompt','Older prompt'),true);assert.equal(exports.canRestorePrompt('','  '),false);
});
test('stream following distinguishes reading earlier messages from the bottom threshold',()=>{
  assert.equal(exports.nearConversationEnd(100,2000,500),false);assert.equal(exports.nearConversationEnd(1450,2000,500),true);assert.equal(exports.nearConversationEnd(1400,2000,500),false);assert.equal(exports.nearConversationEnd(0,300,500),true);
});
