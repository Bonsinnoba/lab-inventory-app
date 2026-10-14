import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const CHUNK = 1024 * 1024;
const revision = 'a'.repeat(64);
const url = 'http://labos-file.localhost/resource.capability';
function load({ size = 40 * CHUNK, alter, afterRead } = {}) {
  const calls = [], errors = [], delivered = [];
  let current = true;
  class Transport {
    constructor(length, initialData, progressiveDone) { Object.assign(this, { length, initialData, progressiveDone }); }
    onDataRange(begin, bytes) { delivered.push({ begin, bytes }); }
  }
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('./local-pdf-range.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, URL, AbortController, Uint8Array, fetch: async (target, options) => {
    calls.push({ target, options });
    const [start, requested] = options.headers.Range.slice(6).split('-').map(Number);
    const end = Math.min(requested, size - 1);
    const response = { status: 206, headers: new Headers({
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1), 'X-LabOS-File-Revision': revision,
    }), arrayBuffer: async () => { afterRead?.(() => { current = false; }); return new Uint8Array(end - start + 1).buffer; } };
    alter?.(response, calls.length);
    return response;
  }, require: name => {
    if (name === 'react-pdf') return { pdfjs: { PDFDataRangeTransport: Transport } };
    if (name === './auth') return { captureAccountSession: () => ({ accountId: 'a' }), isAccountSessionCurrent: () => current };
    throw Error(name);
  } });
  const controller = new AbortController();
  return { calls, errors, delivered, controller,
    open: (target = url) => exports.openLocalPdfRange(target, controller.signal, e => errors.push(e)),
    switchAccount: () => { current = false; },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('large PDFs start with a bounded local range, not a whole-file GET', async () => {
  const c = load(); const t = await c.open();
  assert.equal(t.length, 40 * CHUNK); assert.equal(t.initialData.length, CHUNK);
  assert.equal(c.calls[0].options.headers.Range, `bytes=0-${CHUNK - 1}`);
  assert.equal(t.progressiveDone, true); t.abort();
});
test('coalesced reads split into bounded chunks pinned to the first revision', async () => {
  const c = load(); const t = await c.open();
  t.requestDataRange(CHUNK, 4 * CHUNK); await settle();
  assert.equal(c.calls.length, 4); assert.equal(c.delivered[0].bytes.length, 3 * CHUNK);
  assert.equal(c.delivered[0].begin, CHUNK);
  for (const call of c.calls.slice(1)) assert.equal(new URL(call.target).searchParams.get('revision'), revision);
  t.abort();
});
test('small PDFs allow a final short initial chunk', async () => {
  const c = load({ size: 123 }); const t = await c.open();
  assert.equal(t.initialData.length, 123); t.abort();
});
test('remote URLs are rejected before fetch', async () => {
  const c = load(); await assert.rejects(c.open('http://localhost:4000/api/resource'), /native file URL/);
  assert.equal(c.calls.length, 0);
});
test('bad status, missing revision, malformed range and short bodies fail closed', async () => {
  for (const alter of [
    r => { r.status = 403; }, r => { r.status = 200; },
    r => r.headers.delete('X-LabOS-File-Revision'),
    r => r.headers.set('Content-Range', 'bytes 1-10/40'),
    r => r.headers.set('Content-Length', '1'),
    r => { r.arrayBuffer = async () => new Uint8Array(5).buffer; },
  ]) {
    const c = load({ alter }); await assert.rejects(c.open()); assert.equal(c.calls.length, 1);
  }
});
test('revision changes and size changes cannot deliver mixed PDF data', async () => {
  for (const alter of [
    r => r.headers.set('X-LabOS-File-Revision', 'b'.repeat(64)),
    r => r.headers.set('Content-Range', `bytes ${CHUNK}-${2 * CHUNK - 1}/${41 * CHUNK}`),
  ]) {
    const c = load({ alter: (r, n) => { if (n > 1) alter(r); } }); const t = await c.open();
    t.requestDataRange(CHUNK, 2 * CHUNK); await settle();
    assert.equal(c.errors.length, 1); assert.equal(c.delivered.length, 0);
    t.requestDataRange(CHUNK, 2 * CHUNK); await settle(); assert.equal(c.calls.length, 2);
  }
});
test('account changes before and during reads do not expose bytes', async () => {
  const c = load(); const t = await c.open(); c.switchAccount();
  t.requestDataRange(CHUNK, 2 * CHUNK); await settle();
  assert.equal(c.calls.length, 1); assert.equal(c.delivered.length, 0); assert.equal(c.errors.length, 1);
  const during = load({ afterRead: switchAccount => switchAccount() });
  await assert.rejects(during.open(), /Account changed/);
});
test('closing cancels pending work without reporting a false failure', async () => {
  const c = load(); const t = await c.open(); c.controller.abort();
  t.requestDataRange(CHUNK, 2 * CHUNK); await settle();
  assert.equal(c.calls.length, 1); assert.equal(c.errors.length, 0); assert.equal(c.delivered.length, 0);
});
test('oversized, invalid and excessive queued requests fail without allocation or fetch', async () => {
  for (const range of [[0, 17 * CHUNK], [-1, 1], [1, 1], [0, 41 * CHUNK], [0.5, 2]]) {
    const c = load(); const t = await c.open(); t.requestDataRange(...range); await settle();
    assert.equal(c.errors.length, 1); assert.equal(c.calls.length, 1);
  }
  const c = load(); const t = await c.open();
  for (let n = 0; n < 65; n++) t.requestDataRange(CHUNK, 2 * CHUNK);
  await settle(); assert.equal(c.errors.length, 1); assert.equal(c.calls.length, 1);
});
