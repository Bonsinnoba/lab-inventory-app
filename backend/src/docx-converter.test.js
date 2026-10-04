import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mammoth from 'mammoth';
import { createDocxConverter, convertDocx } from './docx-converter.js';
import { validateDocxHtml, DOCX_INPUT_LIMIT } from './docx-input.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6n9kAAAAASUVORK5CYII=';
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
