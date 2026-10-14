import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mammoth from 'mammoth';
import { createDocxConverter, convertDocx, renderDocx, DOCX_FILE_LIMIT } from './docx-converter.js';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDocxFile } from './docx-file.js';
import { validateDocxHtml, DOCX_INPUT_LIMIT } from './docx-input.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6n9kAAAAASUVORK5CYII=';
// Fixture archive editing uses Mammoth's own installed ZIP dependency.
const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve('mammoth'))('jszip');
test('DOCX conversion preserves text, heading, table, hyperlink and embedded image', async () => {
  const buffer = await convertDocx(`<h1>LabOS check</h1><p><strong>Safety</strong> &amp; text <a href="https://example.com">Reference</a></p><table><tr><td>Cell A</td><td>Cell B</td></tr></table><p><img src="${png}" alt="test image"></p>`);
  assert.equal(buffer.subarray(0,2).toString(), 'PK');
  const rendered = await mammoth.convertToHtml({ buffer });
  for (const value of ['LabOS check', '<strong>Safety</strong>', '<table>', 'Cell A', 'Cell B', 'https://example.com', 'data:image/png;base64,']) assert.ok(rendered.value.includes(value), value);
});
test('DOCX validation rejects unsupported/mismatched images and complex markup', () => {
  for (const src of ['file:///etc/passwd', '//localhost/image.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,aWNucwAAAAA=']) {
    assert.throws(() => validateDocxHtml(`<img src="${src}">`));
  }
  for (const html of ['<svg><image href="http://localhost/"></svg>', '<style>@import "http://localhost/";</style>', '<div>'.repeat(65)]) assert.throws(() => validateDocxHtml(html));
  const sanitized = validateDocxHtml('<p style="color:red;background-image:url(http://localhost/)" onclick="bad()">Safe</p>');
  assert.ok(sanitized.includes('color:red'));
  assert.ok(!sanitized.includes('url('));
  assert.ok(!sanitized.includes('onclick'));
});
test('remote images are rejected without a network request, including encoded URLs', async () => {
  let hits = 0;
  const server = http.createServer((_req,res) => { hits++; res.end('no'); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    for (const prefix of ['http', 'h&#116;tp']) {
      await assert.rejects(convertDocx(`<img src="${prefix}://127.0.0.1:${server.address().port}/image.png">`), /remote images/);
    }
    assert.equal(hits, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('oversized input fails before spawning and malformed images fail in the worker', async () => {
  await assert.rejects(convertDocx('x'.repeat(DOCX_INPUT_LIMIT + 1)), error => error.status === 413);
  await assert.rejects(convertDocx('<img src="data:image/gif;base64,aWNucwAAAAA=">'), error => error.status === 422);
});
test('a stuck converter is killed; concurrency is bounded and the slot is reusable', async () => {
  const convert = createDocxConverter({ timeoutMs: 150, maxConcurrent: 1, workerUrl: new URL('./test-fixtures/docx-hanging-worker.cjs', import.meta.url) });
  const first = convert('<p>test</p>');
  const timedOut = assert.rejects(first, error => error.status === 504);
  await assert.rejects(convert('<p>second</p>'), error => error.status === 503);
  await timedOut;
  await assert.rejects(convert('<p>retry</p>'), error => error.status === 504);
  assert.ok((await convertDocx('<p>API still usable</p>')).length > 0);
});

test('isolated DOCX preview preserves supported formatting and embedded images', async () => {
  const buffer = await convertDocx(`<h1>Local-ready</h1><p><b>Bold text</b> and <a href="https://example.com">link</a></p><table><tr><td>Cell</td></tr></table><img src="${png}">`);
  const result = await renderDocx(buffer);
  for (const value of ['Local-ready', '<strong>Bold text</strong>', 'https://example.com', '<table>', 'Cell', 'data:image/png;base64,']) assert.ok(result.html.includes(value), value);
  assert.ok(Array.isArray(result.messages));
});

test('preview strips active hyperlink targets from uploaded DOCX markup', async () => {
  const buffer = await convertDocx('<p><a href="https://example.com">Reference</a></p>');
  const zip = await JSZip.loadAsync(buffer);
  const rels = 'word/_rels/document.xml.rels';
  zip.file(rels, (await zip.file(rels).async('string')).replace('https://example.com', 'javascript:alert(1)'));
  const rendered = await renderDocx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.ok(rendered.html.includes('Reference'));
  assert.ok(!rendered.html.includes('javascript:'));
});

test('external image references do not fetch network or local files', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.end('not an image'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const buffer = await convertDocx(`<p>External image test</p><img src="${png}">`);
    for (const target of [`http://127.0.0.1:${server.address().port}/secret.png`, 'file:///private/labos-secret.png']) {
      const zip = await JSZip.loadAsync(buffer);
      const rels = 'word/_rels/document.xml.rels';
      const original = await zip.file(rels).async('string');
      const replaced = original.replace(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*\/?\s*>/g, tag =>
        tag.replace(/\sTargetMode="[^"]*"/g, '').replace(/Target="[^"]*"/, `Target="${target}"`).replace(/\s*\/?\s*>$/, ' TargetMode="External"/>'));
      assert.notEqual(replaced, original);
      zip.file(rels, replaced);
      zip.file('word/document.xml', (await zip.file('word/document.xml').async('string')).replaceAll('r:embed=', 'r:link='));
      const result = await renderDocx(await zip.generateAsync({ type: 'nodebuffer' }));
      assert.ok(!result.html.includes('<img'));
      assert.ok(result.messages.some(m => m.message.includes('external file access is disabled')));
    }
    assert.equal(hits, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('preview rejects invalid and oversized binary input before starting the worker', async () => {
  await assert.rejects(renderDocx('not binary'), e => e.status === 400);
  await assert.rejects(renderDocx(Buffer.from('not DOCX')), e => e.status === 422);
  await assert.rejects(renderDocx(Buffer.alloc(DOCX_FILE_LIMIT + 1)), e => e.status === 413);
  await assert.rejects(renderDocx(Buffer.from([80, 75, 3, 4])), e => e.status === 422);
});

test('read and write conversion share a bounded slot and recover after render timeout', async () => {
  const convert = createDocxConverter({ timeoutMs: 150, maxConcurrent: 1, workerUrl: new URL('./test-fixtures/docx-hanging-worker.cjs', import.meta.url) });
  const timedOut = assert.rejects(convert.render(Buffer.from([80, 75, 3, 4])), e => e.status === 504);
  await assert.rejects(convert('<p>no parallel slot</p>'), e => e.status === 503);
  await timedOut;
  await assert.rejects(convert.render(Buffer.from([80, 75, 3, 4])), e => e.status === 504);
});

test('file reader bounds disk input and releases capacity after failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-docx-reader-'));
  try {
    const small = path.join(dir, 'small.docx');
    await fs.writeFile(small, Buffer.from([80, 75, 3, 4]));
    assert.deepEqual(await readDocxFile(small), Buffer.from([80, 75, 3, 4]));
    await assert.rejects(readDocxFile(path.join(dir, 'missing.docx')));
    const large = path.join(dir, 'large.docx'); const file = await fs.open(large, 'w');
    try { await file.truncate(DOCX_FILE_LIMIT + 1); } finally { await file.close(); }
    await assert.rejects(readDocxFile(large), e => e.status === 413);
    assert.equal((await readDocxFile(small)).length, 4);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
