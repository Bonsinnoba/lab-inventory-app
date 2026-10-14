import fs from 'node:fs/promises';
import { DOCX_FILE_LIMIT } from './docx-converter.js';
let activeReads = 0;

// Bound bytes before parsing/IPC. A stat-only limit followed by readFile would
// still allow a file growing concurrently to allocate beyond the advertised cap.
export async function readDocxFile(filename) {
  if (activeReads >= 2) throw Object.assign(new Error('DOCX preview is busy. Retry shortly.'), { status: 503 });
  activeReads++;
  let file;
  try {
    file = await fs.open(filename, 'r');
    const before = await file.stat();
    if (!before.isFile() || before.size > DOCX_FILE_LIMIT) {
      throw Object.assign(new Error('DOCX preview supports files up to 16 MiB'), { status: 413 });
    }
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw Object.assign(new Error('DOCX changed while opening; retry'), { status: 409 });
      offset += bytesRead;
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw Object.assign(new Error('DOCX changed while opening; retry'), { status: 409 });
    }
    return buffer;
  } finally { try { await file?.close(); } finally { activeReads--; } }
}
