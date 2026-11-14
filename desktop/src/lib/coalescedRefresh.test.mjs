import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./coalescedRefresh.ts', import.meta.url),'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText, {exports});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

test('slow refresh coalesces hundreds of polls into one trailing read', async () => {
  const queue = exports.createCoalescedRefresh(); const wait = deferred(); const calls = [];
  const active = queue.run(async () => {calls.push('active'); await wait.promise;});
  await Promise.resolve();
  for (let i=0;i<500;i++) assert.equal(queue.run(async () => {calls.push(i);}), active);
  assert.deepEqual(calls, ['active']); wait.resolve(); await active;
  assert.deepEqual(calls, ['active',499]);
});
test('clearing queued reads supports unmount and a new-account trailing refresh', async () => {
  const queue = exports.createCoalescedRefresh(); const wait = deferred(); const calls = [];
  const active=queue.run(async () => { await wait.promise; }); await Promise.resolve();
  queue.run(async () => {calls.push('old account');}); queue.clear();
  queue.run(async () => {calls.push('new account');}); wait.resolve(); await active;
  assert.deepEqual(calls,['new account']);
  const next=queue.run(async () => {calls.push('cancelled');});queue.clear();await next;
  assert.deepEqual(calls,['new account']);
});
test('a failed read propagates and does not permanently wedge refresh', async () => {
  const queue = exports.createCoalescedRefresh();
  await assert.rejects(queue.run(async () => {throw Error('SQLite busy');}),/SQLite busy/);
  let ran=false;await queue.run(async () => {ran=true;});assert.equal(ran,true);
});
