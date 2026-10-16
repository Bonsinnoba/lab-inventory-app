import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-dependencies.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const filter=exports.withoutBlockedResources;
const change=(id,entity,payload={},entity_type='resource')=>({change_id:id,entity_id:entity,entity_type,payload});

test('failed upload withholds transitive copies, edits and deletes, not independent work',()=>{
  const changes=[change('create','a'),change('copy','b',{copy:{source_id:'a',previous_change_id:'create'}}),change('copy2','c',{copy:{source_id:'b',previous_change_id:'copy'}}),change('edit','c',{edit:{previous_change_id:'copy2'}}),change('delete','c'),change('other','d'),change('note','a',{},'note')];
  assert.deepEqual(filter(changes,new Set(['a'])).map(c=>c.change_id),['other','note']);
  assert.equal(changes.length,7);
});
test('dependencies outside a batch are withheld by source identity without changing payloads',()=>{
  const changes=[change('copy','b',{copy:{source_id:'a',previous_change_id:'older-create'}})];
  const before=JSON.stringify(changes);
  assert.equal(filter(changes,new Set(['a'])).length,0);
  assert.equal(JSON.stringify(changes),before);
  assert.deepEqual(filter(changes,new Set()),changes);
});
test('reversed dependencies and malformed cycles terminate',()=>{
  const changes=[change('copy2','c',{copy:{source_id:'b',previous_change_id:'copy'}}),change('copy','b',{copy:{source_id:'c',previous_change_id:'copy2'}}),change('other','z',null)];
  assert.deepEqual(filter(changes,new Set(['b'])).map(c=>c.change_id),['other']);
  assert.deepEqual(filter(changes,new Set()),changes);
});

test('attachment predecessor is withheld together with failed content transfer',()=>{
  const changes=[change('edit','a'),change('attach','a',{attachment:{protocol:2,previous_change_id:'edit'}}),change('other','b')];
  assert.deepEqual(filter(changes,new Set(['a'])).map(c=>c.change_id),['other']);
  assert.deepEqual(filter(changes,new Set()),changes);
});

test('metadata predecessors join the dependency graph without changing saved payloads',()=>{
  const changes=[change('metadata','b',{metadata:{protocol:1,previous_change_id:'edit'}}),change('edit','a'),change('other','c')];
  const before=JSON.stringify(changes);
  assert.deepEqual(filter(changes,new Set(['a'])).map(c=>c.change_id),['other']);
  assert.equal(JSON.stringify(changes),before);
});
