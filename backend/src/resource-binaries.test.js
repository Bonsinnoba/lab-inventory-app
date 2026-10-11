import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BINARY_CHUNK_BYTES, binaryError, binarySource, createResourceBinaryStore, parseBinaryRange } from './resource-binaries.js';
import { createBinaryHandlers } from './routes/resource-binaries.js';

const id = '94f02f5c-16e6-4d45-8973-f2d72c4895a1';
const base = { id, kind: 'file', storage_path: 'clip.bin', original_filename: 'clip.bin', mime_type: 'application/octet-stream' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-binary-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('labos-binary-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const root = path.join(directory, 'storage');
  await fs.mkdir(root);
  return { directory, root, store: createResourceBinaryStore(root) };
}

test('manifest and bounded chunks reconstruct exact bytes with a content revision', async t => {
  const { root, store } = await fixture(t);
  const bytes = Buffer.alloc(BINARY_CHUNK_BYTES + 13, 37);
  await fs.writeFile(path.join(root, 'clip.bin'), bytes);
  const manifest = await store.manifest(base);
  assert.equal(manifest.sha256, sha(bytes));
  assert.equal(manifest.size_bytes, bytes.length);
  assert.equal(manifest.transfer_path, `/api/resources/${id}/binary`);
  assert.equal(manifest.storage_path, undefined);
  assert.equal(manifest.etag, `"sha256-${sha(bytes)}"`);
  const first = await store.chunk(base, manifest.etag, `bytes=0-${BINARY_CHUNK_BYTES - 1}`);
  const last = await store.chunk(base, manifest.etag, `bytes=${BINARY_CHUNK_BYTES}-${bytes.length - 1}`);
  assert.equal(first.sha256, sha(first.bytes));
  assert.deepEqual(Buffer.concat([first.bytes, last.bytes]), bytes);
  const renamed = await store.manifest({ ...base, name: 'new label', updated_at: '2099-01-01' });
  assert.equal(renamed.etag, manifest.etag);
});

test('replacement refuses an old revision; replay of unchanged chunks is identical', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'clip.bin'), 'old-content');
  const before = await store.manifest(base);
  const a = await store.chunk(base, before.etag, 'bytes=0-2');
  const b = await store.chunk(base, before.etag, 'bytes=0-2');
  assert.deepEqual(a, b);
  await fs.writeFile(path.join(root, 'replacement.bin'), 'new-content');
  await fs.rename(path.join(root, 'replacement.bin'), path.join(root, 'clip.bin'));
  await assert.rejects(() => store.chunk(base, before.etag, 'bytes=0-2'), { status: 412 });
  assert.notEqual((await store.manifest(base)).etag, before.etag);
});

test('empty files have a manifest but no readable range; missing files never become empty files', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'clip.bin'), '');
  const manifest = await store.manifest(base);
  assert.equal(manifest.sha256, sha(''));
  assert.equal(manifest.size_bytes, 0);
  await assert.rejects(() => store.chunk(base, manifest.etag, 'bytes=0-0'), { status: 416 });
  await assert.rejects(() => store.manifest({ ...base, storage_path: 'missing.bin' }), { status: 404 });
});

test('range and revision preconditions fail closed', async t => {
  const { store } = await fixture(t);
  assert.throws(() => store.chunk(base, undefined, 'bytes=0-1'), { status: 428 });
  for (const tag of ['*', 'W/"test"', '"abc"', ['a'], '"sha256-' + 'a'.repeat(64) + '","other"']) {
    assert.throws(() => store.chunk(base, tag, 'bytes=0-1'), { status: 412 });
  }
  for (const range of [null, 'bytes=-1', 'bytes=0-', 'bytes=0-1,3-4', 'bytes=2-1', 'bytes=0-10', 'bytes=9007199254740992-9007199254740993']) {
    assert.throws(() => parseBinaryRange(range, 10), { status: 416 });
  }
  assert.throws(() => parseBinaryRange(`bytes=0-${BINARY_CHUNK_BYTES}`, BINARY_CHUNK_BYTES + 1), { status: 416 });
});

test('only server-owned uploaded/downloaded files are sources; traversal is refused', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'clip.bin'), 'media');
  const linked = { id, kind: 'link', url: 'https://untrusted.invalid/video', local_media_path: 'clip.bin', local_media_filename: 'video.mp4', local_media_mime_type: 'video/mp4' };
  assert.equal((await store.manifest(linked)).kind, 'downloaded-media');
  assert.equal((await store.manifest(linked)).filename, 'video.mp4');
  assert.equal((await store.manifest(linked)).mime_type, 'video/mp4');
  assert.throws(() => binarySource({ id, kind: 'link', url: linked.url }), { status: 404 });
  assert.throws(() => binarySource({ ...base, kind: 'folder' }), { status: 404 });
  for (const storage_path of ['../escape', '/etc/passwd', 'C:\\secrets', 'file:clip.bin', 'sub/../../escape', 'clip.bin\0']) {
    await assert.rejects(() => store.manifest({ ...base, storage_path }), { status: 404 });
  }
});

test('a directory symlink/junction cannot escape the storage root', async t => {
  const { directory, root, store } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret'), 'not-resource-data');
  await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => store.manifest({ ...base, storage_path: 'escape/secret' }), { status: 404 });
});

function response() {
  return { headers: {}, code: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
}
const request = { params: { id }, headers: { 'if-match': 'revision', range: 'bytes=0-2' } };

test('transfer rechecks access after IO and does not disclose bytes after revocation', async () => {
  let checks = 0;
  const handlers = createBinaryHandlers({
    authorizeResource: async () => { if (++checks === 2) throw binaryError(403, 'RESOURCE_ACCESS_REQUIRED'); return base; },
    binaryStore: { chunk: async () => ({ bytes: Buffer.from('secret') }) },
  });
  const res = response();
  await handlers.chunk(request, res);
  assert.equal(checks, 2);
  assert.equal(res.code, 403);
  assert.equal(res.body.error.code, 'RESOURCE_ACCESS_REQUIRED');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('source changes during manifest preparation reject stale delivery', async () => {
  let checks = 0;
  const handlers = createBinaryHandlers({
    authorizeResource: async () => ({ ...base, storage_path: ++checks === 1 ? 'a' : 'b' }),
    binaryStore: { manifest: async () => ({ sha256: 'old' }) },
  });
  const res = response();
  await handlers.manifest(request, res);
  assert.equal(res.code, 412);
});

test('initial denied access never opens a file; transient failure is retryable and hides paths', async () => {
  let reads = 0;
  for (const error of [binaryError(401, 'SESSION_REVOKED'), new Error('secret internal storage path')]) {
    const handlers = createBinaryHandlers({ authorizeResource: async () => { throw error; }, binaryStore: { manifest: async () => { reads++; } } });
    const res = response();
    await handlers.manifest(request, res);
    assert.equal(res.code, error.status || 503);
    assert.ok(!JSON.stringify(res.body).includes('secret internal'));
    if (!error.status) assert.equal(res.headers['Retry-After'], '5');
  }
  assert.equal(reads, 0);
});
