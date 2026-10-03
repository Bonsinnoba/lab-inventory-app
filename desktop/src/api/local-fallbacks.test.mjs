import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual API modules with injected IPC faults and an HTTP spy.
// This supplements source checks: a null Rust delete is a committed success,
// whereas null creates and rejected IPC must fail without a server mutation.
for (const [name,create,remove] of [['notes','createNote','deleteNote'],['knowledge','createFinding','deleteFinding'],['locations','createLocation','deleteLocation'],['projects','createProject','deleteProject']]) {
  for (const fault of ['null','reject']) test(`${name}: ${fault} IPC never falls through to HTTP`,async()=>{
    let writes=0;
    const source=readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports={};
    vm.runInNewContext(compiled,{exports,window:{__TAURI_IPC__:true},URLSearchParams,require:(dependency)=>{
      if(dependency==='@tauri-apps/api/tauri')return {invoke:async()=>{if(fault==='reject')throw new Error('disk unavailable');return null;}};
      if(dependency==='./http')return {apiFetch:async()=>{writes++;throw new Error('HTTP MUST NOT RUN');},getApiErrorMessage:async()=>''};
      return {};
    }});
    await assert.rejects(()=>exports[create]({name:'test',title:'test'}));
    if(fault==='null')await exports[remove]('test-id');else await assert.rejects(()=>exports[remove]('test-id'));
    assert.equal(writes,0);
  });
}

for (const moduleName of ['notes', 'knowledge', 'locations', 'projects']) {
  test(`${moduleName} does not turn a null desktop IPC result into an HTTP write`, () => {
    const source = readFileSync(new URL(`./${moduleName}.ts`, import.meta.url), 'utf8');
    assert.match(source, /if\s*\(result===null\)/);
    assert.match(source, /server fallback was not attempted/);
    assert.match(source, /return undefined as T/);
  });
}
