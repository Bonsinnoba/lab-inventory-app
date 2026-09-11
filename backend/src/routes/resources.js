import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { getResourceAccess, requireResourceRead, requireResourceEditor, validateResourceParent } from '../middleware/resource-access.js';
import { STORAGE_DIR, inferFileType, resolveStoragePath, sanitizeRelativePath } from '../storage.js';

const router = Router();

// Uploads land in a scratch folder first (multer needs a destination
// before we know the DB-assigned resource id), then get moved into
// their final STORAGE_DIR/{resource_id}/... location once the DB row
// exists. diskStorage streams straight to disk — large video files
// never get buffered into memory.
const TMP_DIR = path.join(STORAGE_DIR, '_incoming');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${path.basename(file.originalname)}`),
  }),
  limits: {
    fileSize: config.maxUploadMb * 1024 * 1024,
    files: 100,
  },
});

// Every resource may belong to at most one of item/project/note (or be a
// child of a folder resource, checked separately per-route) — but it no
// longer has to belong to anything. Uploading without picking a parent
// creates a general, unattached resource in the shared library.
function parentFields(body) {
  return {
    item_id: body.item_id || null,
    project_id: body.project_id || null,
    note_id: body.note_id || null,
  };
}

function validateAtMostOneParent({ item_id, project_id, note_id }) {
  const count = [item_id, project_id, note_id].filter(Boolean).length;
  return count <= 1;
}

const KNOWLEDGE_CATEGORIES = new Set(['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other']);
function knowledgeMetadata(body) {
  const category = typeof body.category === 'string' && KNOWLEDGE_CATEGORIES.has(body.category) ? body.category : 'general';
  const rawTags = Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? (() => { try { return JSON.parse(body.tags); } catch { return body.tags.split(','); } })() : []);
  const tags = Array.isArray(rawTags) ? rawTags.map(v => String(v).trim()).filter(Boolean).slice(0, 30) : [];
  return { category, description: typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '', tags };
}

// GET /api/resources — list resources.
// Pass one of item_id / project_id / note_id / parent_resource_id to scope
// to a single parent (used by ResourcesPanel on item/project/note detail
// pages). Pass NO filters to get every top-level resource in the lab
// (used by the standalone Resources page) — each row includes
// attached_to_type/attached_to_name so it's still clear what it's linked to.
router.get('/', async (req, res) => {
  const { item_id, project_id, note_id, parent_resource_id } = req.query;
  const conditions = [];
  const values = [];

  if (item_id) {
    values.push(item_id);
    conditions.push(`r.item_id = $${values.length}`);
    // Exclude the item's dedicated profile picture (set via the
    // "Add/Change picture" control) from its general resources list --
    // it's not an attachment, it's the item's picture, and showing it
    // here too would just duplicate the thumbnail as a second entry.
    conditions.push(`r.id IS DISTINCT FROM (SELECT image_resource_id FROM items WHERE id = $${values.length})`);
  }
  if (project_id) { values.push(project_id); conditions.push(`r.project_id = $${values.length}`); }
  if (note_id) { values.push(note_id); conditions.push(`r.note_id = $${values.length}`); }
  if (parent_resource_id) { values.push(parent_resource_id); conditions.push(`r.parent_resource_id = $${values.length}`); }

  // No-filter "list everything" mode: only top-level resources (not
  // children of a folder — those are browsed via /:id/manifest instead).
  const where = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : `WHERE r.parent_resource_id IS NULL`;

  try {
    if (project_id) {
      const access = await getProjectAccess(project_id, req.user);
      if (access.access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } });
    }
    if (note_id) {
      const parentCheck = await validateResourceParent({ noteId: note_id, user: req.user, requireEdit: false });
      if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error });
    }
    if (item_id) {
      const parentCheck = await validateResourceParent({ itemId: item_id, user: req.user, requireEdit: false });
      if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error });
    }
    if (parent_resource_id) {
      const parentCheck = await validateResourceParent({ parentResourceId: parent_resource_id, user: req.user, requireEdit: false });
      if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error });
    }

    const result = await pool.query(
      `SELECT r.id, r.name, r.kind, r.file_type, r.original_filename, r.mime_type, r.size_bytes,
              r.parent_resource_id, r.relative_path, r.url, r.thumbnail_url, r.category, r.description, r.tags, r.updated_at, r.created_at,
              r.item_id, r.project_id, r.note_id,
              i.name AS item_name, p.name AS project_name, n.title AS note_title
       FROM resources r
       LEFT JOIN items i ON r.item_id = i.id
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN notes n ON r.note_id = n.id
       ${where}
       ORDER BY r.created_at DESC`,
      values
    );
    const visible = [];
    for (const row of result.rows) {
      const access = await getResourceAccess(row.id, req.user);
      if (access.access !== 'none' && !access.context?.invalid) visible.push(row);
    }
    res.json(visible);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch resources' });
  }
});

// GET /api/resources/:id/access-url — create a short-lived URL for media
// elements that cannot attach an Authorization header themselves.
router.get('/:id/access-url', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, kind FROM resources WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' });
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (result.rows[0].kind !== 'file') return res.status(400).json({ error: 'Only file resources have access URLs' });

    const accessToken = jwt.sign(
      { purpose: 'resource-download', resourceId: req.params.id, userId: req.user.userId },
      config.jwtSecret,
      { expiresIn: '5m' }
    );
    res.json({ url: `${req.protocol}://${req.get('host')}/api/resources/${req.params.id}/download?access_token=${encodeURIComponent(accessToken)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create resource access URL' });
  }
});

// GET /api/resources/:id — single resource by id (metadata only, no bytes).
// Needed anywhere a resource is referenced by id alone (e.g. a canvas block
// pointing at resource_id) without already knowing its parent to list against.
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, kind, file_type, original_filename, mime_type, size_bytes,
              parent_resource_id, relative_path, url, thumbnail_url,
              category, description, tags, updated_at, item_id, project_id, note_id, created_at
       FROM resources WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch resource' });
  }
});

// GET /api/resources/:id/manifest — for a folder resource, lists all
// descendant files with their relative paths (so a client can download
// the whole set and reconstruct the original folder structure locally).
router.get('/:id/manifest', async (req, res) => {
  try {
    const folder = await pool.query(`SELECT * FROM resources WHERE id = $1 AND kind = 'folder'`, [req.params.id]);
    if (folder.rows.length === 0) {
      return res.status(404).json({ error: 'Folder resource not found' });
    }
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const children = await pool.query(
      `SELECT id, relative_path, original_filename, size_bytes, mime_type
       FROM resources WHERE parent_resource_id = $1 ORDER BY relative_path ASC`,
      [req.params.id]
    );
    res.json({ folder: folder.rows[0].name, files: children.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to build manifest' });
  }
});

// GET /api/resources/:id/download — streams the file, with Range support
// so large video files can be scrubbed instead of downloaded in full
// before playback starts on the client's temp-cache copy.
router.get('/:id/download', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM resources WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    const resource = result.rows[0];
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (req.user?.purpose === 'resource-download' && req.user.resourceId !== resource.id) {
      return res.status(403).json({ error: 'Resource access token does not match this resource' });
    }
    if (resource.kind !== 'file') {
      return res.status(400).json({ error: 'Only file resources can be downloaded directly — use /manifest for folders' });
    }

    const filePath = resolveStoragePath(resource.storage_path);
    const stat = await fsp.stat(filePath);
    const range = req.headers.range;

    // Viewable types render inline (in an <img>/<video>/<audio> tag or an
    // in-app PDF viewer) by default. Pass ?download=true to force a real
    // "save as" download instead (e.g. for a "Download" button in the UI).
    const viewableInline = ['image', 'video', 'audio', 'pdf', 'text'].includes(resource.file_type);
    const forceDownload = req.query.download === 'true';
    const disposition = viewableInline && !forceDownload ? 'inline' : 'attachment';

    res.setHeader('Content-Type', resource.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(resource.original_filename || resource.name)}"`
    );

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to download resource' });
  }
});

// POST /api/resources — upload a single file, attached to an item/project/note
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected multipart field "file")' });
  }
  const parents = parentFields(req.body);
  if (!validateAtMostOneParent(parents)) {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'A resource can be attached to at most one of item_id, project_id, note_id' });
  }

  const parentCheck = await validateResourceParent({ itemId: parents.item_id, projectId: parents.project_id, noteId: parents.note_id, user: req.user });
  if (!parentCheck.ok) {
    await fsp.unlink(req.file.path).catch(() => {});
    return res.status(parentCheck.status).json({ error: parentCheck.error });
  }

  const client = await pool.connect();
  let resourceId = null;
  let finalPath = null;
  try {
    const fileType = inferFileType(req.file.mimetype, req.file.originalname);
    const metadata = knowledgeMetadata(req.body);

    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO resources (name, kind, file_type, original_filename, mime_type, size_bytes,
                               item_id, project_id, note_id, category, description, tags, uploaded_by)
       VALUES ($1,'file',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.body.name || req.file.originalname,
        fileType,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        parents.item_id, parents.project_id, parents.note_id, metadata.category, metadata.description, metadata.tags, req.user?.userId || null,
      ]
    );
    const resource = inserted.rows[0];
    resourceId = resource.id;

    const safeFilename = sanitizeRelativePath(path.basename(req.file.originalname));
    const finalDir = resolveStoragePath(resource.id);
    await fsp.mkdir(finalDir, { recursive: true });
    finalPath = resolveStoragePath(`${resource.id}/${safeFilename}`);
    await fsp.rename(req.file.path, finalPath);

    const relativeStoragePath = `${resource.id}/${safeFilename}`;
    const updated = await client.query(
      `UPDATE resources SET storage_path = $1 WHERE id = $2 RETURNING *`,
      [relativeStoragePath, resource.id]
    );
    await client.query('COMMIT');
    client.release();

    await writeAuditLog({ req, action: 'CREATE', entityType: 'resource', entityId: updated.rows[0].id, newValue: updated.rows[0] });
    res.status(201).json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await fsp.unlink(req.file.path).catch(() => {});
    if (finalPath) await fsp.unlink(finalPath).catch(() => {});
    if (resourceId) await fsp.rm(resolveStoragePath(resourceId), { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: err.message || 'Failed to upload file' });
  }
});

// POST /api/resources/folder — create an (initially empty) folder resource.
// Upload files into it afterward via POST /api/resources/:folderId/files
router.post('/folder', async (req, res) => {
  const parents = parentFields(req.body);
  if (!req.body.name || !validateAtMostOneParent(parents)) {
    return res.status(400).json({ error: 'name is required, and a resource can be attached to at most one of item_id/project_id/note_id' });
  }

  const parentCheck = await validateResourceParent({ itemId: parents.item_id, projectId: parents.project_id, noteId: parents.note_id, user: req.user });
  if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error });

  try {
    const metadata = knowledgeMetadata(req.body);
    const result = await pool.query(
      `INSERT INTO resources (name, kind, file_type, item_id, project_id, note_id, category, description, tags, uploaded_by)
       VALUES ($1,'folder','schematic_folder',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.body.name, parents.item_id, parents.project_id, parents.note_id, metadata.category, metadata.description, metadata.tags, req.user?.userId || null]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'resource', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create folder' });
  }
});

// POST /api/resources/:folderId/files — batch-upload files into a folder,
// preserving relative paths so the original directory structure (e.g. a
// schematics folder with subfolders) can be reconstructed on download.
// Client sends multipart field "files" (multiple) plus a JSON string
// field "relative_paths" — an array of paths, same order as the files.
router.post('/:folderId/files', upload.array('files'), async (req, res) => {
  const { folderId } = req.params;

  try {
    const folder = await pool.query(`SELECT * FROM resources WHERE id = $1 AND kind = 'folder'`, [folderId]);
    if (folder.rows.length === 0) {
      return res.status(404).json({ error: 'Folder resource not found' });
    }
    const folderAccess = await requireResourceEditor(folderId, req.user);
    if (!folderAccess.ok) {
      for (const file of req.files || []) await fsp.unlink(file.path).catch(() => {});
      return res.status(folderAccess.status).json({ error: folderAccess.error });
    }

    let relativePaths;
    try {
      relativePaths = JSON.parse(req.body.relative_paths || '[]');
    } catch {
      relativePaths = [];
    }

    const created = [];
    const createdIds = [];
    const finalPaths = [];
    const seenPaths = new Set();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const relPath = sanitizeRelativePath(relativePaths[i] || file.originalname);
        const normalizedRelPath = relPath.replaceAll('\\\\', '/');
        if (seenPaths.has(normalizedRelPath)) {
          throw new Error(`Duplicate relative path in upload: ${relPath}`);
        }
        seenPaths.add(normalizedRelPath);
        const fileType = inferFileType(file.mimetype, file.originalname);

        const inserted = await client.query(
          `INSERT INTO resources (name, kind, file_type, original_filename, mime_type, size_bytes,
                                   parent_resource_id, relative_path, uploaded_by)
           VALUES ($1,'file',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [path.basename(relPath), fileType, file.originalname, file.mimetype, file.size, folderId, relPath, req.user?.userId || null]
        );
        const resource = inserted.rows[0];
        createdIds.push(resource.id);

        const finalPath = resolveStoragePath(`${folderId}/${relPath}`);
        await fsp.mkdir(path.dirname(finalPath), { recursive: true });
        await fsp.rename(file.path, finalPath);
        finalPaths.push(finalPath);

        const updated = await client.query(
          `UPDATE resources SET storage_path = $1 WHERE id = $2 RETURNING *`,
          [`${folderId}/${relPath}`, resource.id]
        );
        created.push(updated.rows[0]);
      }
      await client.query('COMMIT');
      client.release();

      for (const row of created) {
        await writeAuditLog({ req, action: 'CREATE', entityType: 'resource', entityId: row.id, newValue: row });
      }
      res.status(201).json(created);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      for (const file of req.files || []) await fsp.unlink(file.path).catch(() => {});
      for (const finalPath of finalPaths) await fsp.unlink(finalPath).catch(() => {});
      // The folder itself is owned by the parent resource; never remove it
      // as part of a failed child upload.
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to upload folder contents' });
  }
});

// POST /api/resources/link — attach an external link (e.g. a YouTube video).
// For YouTube URLs, fetches the real thumbnail via YouTube's oEmbed endpoint.
router.post('/link', async (req, res) => {
  const parents = parentFields(req.body);
  const { url, name } = req.body;

  if (!url || !validateAtMostOneParent(parents)) {
    return res.status(400).json({ error: 'url is required, and a resource can be attached to at most one of item_id/project_id/note_id' });
  }

  const parentCheck = await validateResourceParent({ itemId: parents.item_id, projectId: parents.project_id, noteId: parents.note_id, user: req.user });
  if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error });

  const isYouTube = /(?:youtube\.com|youtu\.be)/.test(url);
  let thumbnailUrl = null;
  let resolvedName = name;

  if (isYouTube) {
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        thumbnailUrl = data.thumbnail_url || null;
        resolvedName = resolvedName || data.title;
      }
    } catch (err) {
      console.warn('Could not fetch YouTube oEmbed data:', err.message);
    }
  }

  try {
    const metadata = knowledgeMetadata(req.body);
    const result = await pool.query(
      `INSERT INTO resources (name, kind, file_type, url, thumbnail_url, item_id, project_id, note_id, category, description, tags, uploaded_by)
       VALUES ($1,'link',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [resolvedName || url, isYouTube ? 'youtube' : 'other', url, thumbnailUrl, parents.item_id, parents.project_id, parents.note_id, metadata.category, metadata.description, metadata.tags, req.user?.userId || null]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'resource', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create link resource' });
  }
});

// PUT /api/resources/:id — update knowledge metadata without replacing the resource.
router.put('/:id', async (req, res) => {
  const metadata = knowledgeMetadata(req.body);
  try {
    const access = await requireResourceEditor(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const result = await pool.query(
      `UPDATE resources SET category = $1, description = $2, tags = $3 WHERE id = $4 RETURNING *`,
      [metadata.category, metadata.description, metadata.tags, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' });
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'resource', entityId: req.params.id, newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update resource metadata' });
  }
});

// GET /api/resources/meta/tags and /categories are consumed by the Knowledge hub.
router.get('/meta/tags', async (req, res) => {
  try {
    const result = await pool.query(`SELECT DISTINCT unnest(tags) AS tag FROM resources WHERE array_length(tags,1) > 0 ORDER BY tag`);
    res.json(result.rows.map(r => r.tag));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch resource tags' }); }
});

router.get('/meta/categories', async (req, res) => {
  try {
    const result = await pool.query(`SELECT category, COUNT(*)::int AS count FROM resources GROUP BY category ORDER BY category`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch resource categories' }); }
});

// DELETE /api/resources/:id — removes the DB row(s) (folder children cascade)
// and the underlying file(s)/directory on disk.
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    const resource = result.rows[0];
    const access = await requireResourceEditor(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    await writeAuditLog({
      req,
      action: 'DELETE',
      entityType: 'resource',
      entityId: req.params.id,
      oldValue: resource,
    });

    const dirToRemove = path.join(STORAGE_DIR, resource.parent_resource_id ? resource.parent_resource_id : resource.id);
    if (!resource.parent_resource_id) {
      // top-level file or folder resource owns a directory named after its own id
      await fsp.rm(dirToRemove, { recursive: true, force: true });
    } else if (resource.storage_path) {
      // child file within a folder — remove just that file
      await fsp.rm(resolveStoragePath(resource.storage_path), { force: true });
    }

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete resource' });
  }
});

export default router;
