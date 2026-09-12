import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireResourceEditor } from '../middleware/resource-access.js';
import { config } from '../config.js';
import { inferFileType, resolveStoragePath } from '../storage.js';

const router = Router();
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

function isMarkdownResource(resource) {
  const name = (resource.original_filename || resource.name || '').toLowerCase();
  return resource.file_type === 'text' && (name.endsWith('.md') || name.endsWith('.markdown'));
}

async function getEditableResource(id, user) {
  const result = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
  if (!result.rowCount) return { status: 404, error: 'Resource not found' };
  const access = await requireResourceEditor(id, user);
  if (!access.ok) return { status: access.status, error: access.error };
  return { resource: result.rows[0] };
}

router.get('/:id/content', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isMarkdownResource(resource)) return res.status(400).json({ error: 'Only Markdown resources can be edited as text' });
    const filePath = resolveStoragePath(resource.storage_path);
    const content = await fs.readFile(filePath, 'utf8');
    res.type('text/plain').send(content);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to read resource content' });
  }
});

router.put('/:id/content', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isMarkdownResource(resource)) return res.status(400).json({ error: 'Only Markdown resources can be edited as text' });
    if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    if (Buffer.byteLength(req.body.content, 'utf8') > config.maxJsonMb * 1024 * 1024) return res.status(413).json({ error: 'Markdown content is too large' });

    const filePath = resolveStoragePath(resource.storage_path);
    const oldContent = await fs.readFile(filePath, 'utf8');
    await fs.writeFile(filePath, req.body.content, 'utf8');
    const sizeBytes = Buffer.byteLength(req.body.content, 'utf8');
    const result = await pool.query('UPDATE resources SET size_bytes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [sizeBytes, resource.id]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'resource', entityId: resource.id, oldValue: { content_size: Buffer.byteLength(oldContent, 'utf8') }, newValue: { content_size: sizeBytes, content_edited: true } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to save Markdown content' });
  }
});

router.put('/:id/file', pdfUpload.single('file'), async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (resource.file_type !== 'pdf') return res.status(400).json({ error: 'Only PDF resources can be replaced here' });
    if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
    const isPdf = req.file.mimetype === 'application/pdf' || path.extname(req.file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return res.status(400).json({ error: 'The replacement file must be a PDF' });

    const filePath = resolveStoragePath(resource.storage_path);
    await fs.writeFile(filePath, req.file.buffer);
    const fileType = inferFileType(req.file.mimetype, req.file.originalname);
    const result = await pool.query(
      `UPDATE resources
       SET original_filename = $1, mime_type = $2, size_bytes = $3, file_type = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [req.file.originalname, req.file.mimetype, req.file.size, fileType, resource.id]
    );
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'resource', entityId: resource.id, oldValue: { original_filename: resource.original_filename, size_bytes: resource.size_bytes }, newValue: { original_filename: req.file.originalname, size_bytes: req.file.size, pdf_replaced: true } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to replace PDF resource' });
  }
});

export default router;
