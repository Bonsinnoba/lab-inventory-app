import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

export const BINARY_CHUNK_BYTES = 4 * 1024 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function binaryError(status, code) {
  return Object.assign(new Error(code), { status, code });
}

// Only database-owned storage paths are accepted. Never fetch resource.url.
export function binarySource(resource) {
  if (!resource || !UUID.test(resource.id)) throw binaryError(404, 'BINARY_UNAVAILABLE');
  const downloaded = resource.kind === 'link' && resource.local_media_path;
  const relativePath = resource.kind === 'file' ? resource.storage_path : downloaded;
  if (!relativePath || typeof relativePath !== 'string') throw binaryError(404, 'BINARY_UNAVAILABLE');
  const filename = downloaded ? resource.local_media_filename : resource.original_filename;
  return {
    relativePath,
    filename: path.posix.basename(String(filename || resource.name || resource.id).replaceAll('\\', '/')),
    // This transfer endpoint is an attachment, not an inline HTML/media renderer.
    mime: downloaded ? resource.local_media_mime_type : resource.mime_type,
    kind: downloaded ? 'downloaded-media' : 'uploaded-file',
  };
}

export function parseBinaryRange(header, size) {
  // Replication has explicit bounded offsets: no suffix/open/multi ranges.
  const match = typeof header === 'string' && /^bytes=(\d+)-(\d+)$/.exec(header);
  if (!match) throw binaryError(416, 'BINARY_RANGE_INVALID');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0
      || end < start || end >= size || end - start + 1 > BINARY_CHUNK_BYTES) {
    throw binaryError(416, 'BINARY_RANGE_INVALID');
  }
  return { start, end, length: end - start + 1 };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function signature(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

// Bounded file IO and digest cache, shared across callers of this server process.
// No database/metadata mutation: the digest identifies bytes, not updated_at.
export function createResourceBinaryStore(storageRoot) {
  const root = path.resolve(storageRoot);
  const revisions = new Map();
  let active = 0;

  async function openSource(resource) {
    const source = binarySource(resource);
    const relative = source.relativePath.replaceAll('\\', '/');
    if (relative.includes('\0') || relative.includes(':') || relative.startsWith('/')
        || relative.split('/').includes('..')) throw binaryError(404, 'BINARY_UNAVAILABLE');
    const filename = path.resolve(root, relative);
    if (!inside(root, filename)) throw binaryError(404, 'BINARY_UNAVAILABLE');
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(filename);
    if (!inside(realRoot, realFile)) throw binaryError(404, 'BINARY_UNAVAILABLE');
    const handle = await fs.open(realFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw binaryError(404, 'BINARY_UNAVAILABLE');
      const initial = signature(stat);
      const check = async () => {
        // An atomic replacement or in-place edit must invalidate this transfer.
        if (await fs.realpath(filename) !== realFile
            || signature(await fs.stat(realFile, { bigint: true })) !== initial
            || signature(await handle.stat({ bigint: true })) !== initial) {
          throw binaryError(412, 'BINARY_CHANGED');
        }
      };
      await check();
      return { handle, source, size: Number(stat.size), key: `${realFile}:${initial}`, check };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async function readExactly(file, buffer, position) {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.handle.read(buffer, offset, buffer.length - offset, position + offset);
      if (!bytesRead) throw binaryError(412, 'BINARY_CHANGED');
      offset += bytesRead;
    }
  }

  async function revision(file) {
    if (revisions.has(file.key)) return revisions.get(file.key);
    const hash = createHash('sha256');
    const deadline = Date.now() + 120_000;
    const buffer = Buffer.alloc(Math.min(HASH_BUFFER_BYTES, file.size));
    for (let position = 0; position < file.size; position += buffer.length) {
      if (Date.now() > deadline) throw binaryError(503, 'BINARY_BUSY');
      const part = buffer.subarray(0, Math.min(buffer.length, file.size - position));
      await readExactly(file, part, position);
      hash.update(part);
    }
    await file.check();
    const value = hash.digest('hex');
    if (revisions.size >= 256) revisions.delete(revisions.keys().next().value);
    revisions.set(file.key, value);
    return value;
  }

  async function withFile(resource, run) {
    if (active >= 2) throw binaryError(503, 'BINARY_BUSY');
    active += 1;
    let file;
    try {
      file = await openSource(resource);
      return await run(file);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) {
        throw binaryError(404, 'BINARY_UNAVAILABLE');
      }
      throw error;
    } finally {
      try { if (file) await file.handle.close(); } finally { active -= 1; }
    }
  }

  return {
    manifest: resource => withFile(resource, async file => {
      const sha256 = await revision(file);
      await file.check();
      return {
        protocol: 1, resource_id: resource.id, kind: file.source.kind,
        filename: file.source.filename, mime_type: file.source.mime || 'application/octet-stream',
        size_bytes: file.size, sha256, etag: `"sha256-${sha256}"`,
        chunk_bytes: BINARY_CHUNK_BYTES,
        transfer_path: `/api/resources/${resource.id}/binary`,
      };
    }),
    chunk: (resource, ifMatch, range) => {
      if (!ifMatch) throw binaryError(428, 'BINARY_REVISION_REQUIRED');
      if (typeof ifMatch !== 'string' || !/^"sha256-[a-f0-9]{64}"$/.test(ifMatch)) {
        throw binaryError(412, 'BINARY_CHANGED');
      }
      return withFile(resource, async file => {
        let offsets;
        try { offsets = parseBinaryRange(range, file.size); }
        catch (error) { error.size = file.size; throw error; }
        const sha256 = await revision(file);
        const etag = `"sha256-${sha256}"`;
        if (ifMatch !== etag) throw binaryError(412, 'BINARY_CHANGED');
        const bytes = Buffer.alloc(offsets.length);
        await readExactly(file, bytes, offsets.start);
        await file.check();
        return { bytes, etag, size: file.size, ...offsets, sha256: createHash('sha256').update(bytes).digest('hex') };
      });
    },
  };
}
