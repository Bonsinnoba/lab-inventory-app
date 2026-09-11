import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { config } from './config.js';

dotenv.config();

// All uploaded files live under this directory on the server machine.
export const STORAGE_DIR = config.storageDir
  ? path.resolve(config.storageDir)
  : path.resolve(process.cwd(), 'storage');

export function sanitizeRelativePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Invalid relative path');
  }
  return normalized.split('/').filter(Boolean).join('/');
}

export function resolveStoragePath(relativePath) {
  const safeRelativePath = sanitizeRelativePath(relativePath);
  const root = path.resolve(STORAGE_DIR);
  const resolved = path.resolve(root, safeRelativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Infers our file_type enum value from a mime type / extension, so the
// frontend gets a consistent category to pick an icon/preview for.
export function inferFileType(mimeType, filename) {
  const ext = path.extname(filename || '').toLowerCase();

  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf';
  // Plain-text formats we can read and preview inline as text --
  // kept separate from 'document' below, which covers opaque binary
  // formats (.doc/.docx/.rtf/.odt) that need a real office viewer
  // and can't be inline-previewed the same way.
  if (['.md', '.txt'].includes(ext)) return 'text';
  if (['.doc', '.docx', '.rtf', '.odt'].includes(ext)) return 'document';

  return 'other';
}
