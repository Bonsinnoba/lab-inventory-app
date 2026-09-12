import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import HTMLtoDOCX from 'html-to-docx';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireResourceEditor } from '../middleware/resource-access.js';
import { config } from '../config.js';
import { inferFileType, resolveStoragePath } from '../storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

function extension(resource) {
  return path.extname(resource.original_filename || resource.name || '').toLowerCase();
}

function isMarkdownResource(resource) {
  const name = (resource.original_filename || resource.name || '').toLowerCase();
  return resource.file_type === 'text' && (name.endsWith('.md') || name.endsWith('.markdown'));
}

function isDocxResource(resource) {
  return resource.file_type === 'document' && extension(resource) === '.docx';
}

function isPdfResource(resource) {
  return resource.file_type === 'pdf' && extension(resource) === '.pdf';
}

async function getEditableResource(id, user) {
  const result = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
  if (!result.rowCount) return { status: 404, error: 'Resource not found' };
  const access = await requireResourceEditor(id, user);
  if (!access.ok) return { status: access.status, error: access.error };
  return { resource: result.rows[0] };
}

async function duplicateFileResource(resource, user, suffix = 'Edited') {
  const sourcePath = resolveStoragePath(resource.storage_path);
  const id = randomUUID();
  const originalName = resource.original_filename || resource.name;
  const parsed = path.parse(originalName);
  const newFilename = `${parsed.name} — ${suffix}${parsed.ext}`;
  const destinationDir = resolveStoragePath(id);
  const destinationPath = resolveStoragePath(`${id}/${newFilename}`);

  await fs.mkdir(destinationDir, { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);

  try {
    const result = await pool.query(
      `INSERT INTO resources
       (id, name, kind, file_type, original_filename, mime_type, size_bytes,
        storage_path, item_id, project_id, note_id, parent_resource_id, relative_path,
        category, description, tags, uploaded_by)
       VALUES ($1,'file',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id,
        resource.file_type,
        newFilename,
        resource.mime_type,
        resource.size_bytes,
        `${id}/${newFilename}`,
        resource.item_id || null,
        resource.project_id || null,
        resource.note_id || null,
        null,
        null,
        resource.category || 'general',
        resource.description || '',
        resource.tags || [],
        user?.userId || null,
      ]
    );
    const created = result.rows[0];
    await writeAuditLog({
      req: { user },
      action: 'CREATE',
      entityType: 'resource',
      entityId: created.id,
      newValue: { derived_from_resource_id: resource.id, original_filename: resource.original_filename, derived_filename: newFilename },
    });
    return created;
  } catch (err) {
    await fs.rm(destinationDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

router.get('/:id/content', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isMarkdownResource(resource)) return res.status(400).json({ error: 'Only Markdown resources can be edited as text' });
    const content = await fs.readFile(resolveStoragePath(resource.storage_path), 'utf8');
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

// Return a rendered HTML representation for DOCX viewing/editing.
router.get('/:id/docx', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isDocxResource(resource)) return res.status(400).json({ error: 'Only DOCX resources are supported' });
    const buffer = await fs.readFile(resolveStoragePath(resource.storage_path));
    const result = await mammoth.convertToHtml({ buffer }, {
      styleMap: [
        "p[style-name='Title'] => h1",
        "p[style-name='Heading 1'] => h2",
        "p[style-name='Heading 2'] => h3",
        "p[style-name='Heading 3'] => h4",
      ],
    });
    res.json({ html: result.value, messages: result.messages || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to render DOCX resource' });
  }
});

// Save edited DOCX HTML as a new LabOS resource. The original is never modified.
router.put('/:id/docx-copy', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isDocxResource(resource)) return res.status(400).json({ error: 'Only DOCX resources can be edited' });
    if (typeof req.body?.html !== 'string') return res.status(400).json({ error: 'html must be a string' });
    if (Buffer.byteLength(req.body.html, 'utf8') > config.maxJsonMb * 1024 * 1024) return res.status(413).json({ error: 'DOCX content is too large' });

    const buffer = await HTMLtoDOCX(req.body.html, null, { table: { row: { cantSplit: true } } });
    const id = randomUUID();
    const originalName = resource.original_filename || resource.name;
    const parsed = path.parse(originalName);
    const newFilename = `${parsed.name} — Edited.docx`;
    const destinationDir = resolveStoragePath(id);
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.writeFile(resolveStoragePath(`${id}/${newFilename}`), buffer);
    const sizeBytes = buffer.length;

    try {
      const result = await pool.query(
        `INSERT INTO resources
         (id, name, kind, file_type, original_filename, mime_type, size_bytes, storage_path,
          item_id, project_id, note_id, category, description, tags, uploaded_by)
         VALUES ($1,'file','document',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [id, newFilename, newFilename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes, `${id}/${newFilename}`,
          resource.item_id || null, resource.project_id || null, resource.note_id || null,
          resource.category || 'general', resource.description || '', resource.tags || [], req.user?.userId || null]
      );
      const created = result.rows[0];
      await writeAuditLog({ req, action: 'CREATE', entityType: 'resource', entityId: created.id, newValue: { derived_from_resource_id: resource.id, docx_edited: true } });
      res.status(201).json(created);
    } catch (err) {
      await fs.rm(destinationDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to save edited DOCX' });
  }
});

// Create a safe editable copy of a PDF. The original PDF is never modified.
router.post('/:id/pdf-copy', async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    if (!isPdfResource(found.resource)) return res.status(400).json({ error: 'Only PDF resources can be copied for editing' });
    const created = await duplicateFileResource(found.resource, req.user, 'Edited');
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create editable PDF copy' });
  }
});

// Replace a PDF's bytes. Kept as a low-level compatibility operation; the UI
// should prefer PDF copy/edit so originals remain immutable.
router.put('/:id/file', upload.single('file'), async (req, res) => {
  try {
    const found = await getEditableResource(req.params.id, req.user);
    if (!found.resource) return res.status(found.status).json({ error: found.error });
    const resource = found.resource;
    if (!isPdfResource(resource)) return res.status(400).json({ error: 'Only PDF resources can be replaced here' });
    if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
    const isPdf = req.file.mimetype === 'application/pdf' || path.extname(req.file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return res.status(400).json({ error: 'The replacement file must be a PDF' });
    await fs.writeFile(resolveStoragePath(resource.storage_path), req.file.buffer);
    const fileType = inferFileType(req.file.mimetype, req.file.originalname);
    const result = await pool.query(
      `UPDATE resources SET original_filename = $1, mime_type = $2, size_bytes = $3, file_type = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *`,
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
