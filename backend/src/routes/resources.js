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
const TMP_DIR = path.join(STORAGE_DIR, '_incoming');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: TMP_DIR, filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${path.basename(file.originalname)}`) }), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 100 } });
function parentFields(body) { return { item_id: body.item_id || null, project_id: body.project_id || null, note_id: body.note_id || null }; }
function validateAtMostOneParent({ item_id, project_id, note_id }) { return [item_id, project_id, note_id].filter(Boolean).length <= 1; }
const KNOWLEDGE_CATEGORIES = new Set(['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other']);
function knowledgeMetadata(body) { const category = typeof body.category === 'string' && KNOWLEDGE_CATEGORIES.has(body.category) ? body.category : 'general'; const rawTags = Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? (() => { try { return JSON.parse(body.tags); } catch { return body.tags.split(','); } })() : []); const tags = Array.isArray(rawTags) ? rawTags.map(v => String(v).trim()).filter(Boolean).slice(0, 30) : []; return { category, description: typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '', tags }; }

router.get('/', async (req, res) => {
  const { item_id, project_id, note_id, parent_resource_id } = req.query; const conditions = []; const values = [];
  if (item_id) { values.push(item_id); conditions.push(`r.item_id = $${values.length}`); conditions.push(`r.id IS DISTINCT FROM (SELECT image_resource_id FROM items WHERE id = $${values.length})`); }
  if (project_id) { values.push(project_id); conditions.push(`r.project_id = $${values.length}`); }
  if (note_id) { values.push(note_id); conditions.push(`r.note_id = $${values.length}`); }
  if (parent_resource_id) { values.push(parent_resource_id); conditions.push(`r.parent_resource_id = $${values.length}`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : `WHERE r.parent_resource_id IS NULL`;
  try {
    if (project_id) { const access = await getProjectAccess(project_id, req.user); if (access.access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } }); }
    if (note_id) { const parentCheck = await validateResourceParent({ noteId: note_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); }
    if (item_id) { const parentCheck = await validateResourceParent({ itemId: item_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); }
    if (parent_resource_id) { const parentCheck = await validateResourceParent({ parentResourceId: parent_resource_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); }
    const result = await pool.query(`SELECT r.id, r.name, r.kind, r.file_type, r.original_filename, r.mime_type, r.size_bytes, r.local_media_path, r.local_media_filename, r.local_media_mime_type, r.local_media_size_bytes, r.local_media_downloaded_at, r.parent_resource_id, r.relative_path, r.url, r.thumbnail_url, r.category, r.description, r.tags, r.updated_at, r.created_at, r.item_id, r.project_id, r.note_id, i.name AS item_name, p.name AS project_name, n.title AS note_title FROM resources r LEFT JOIN items i ON r.item_id = i.id LEFT JOIN projects p ON r.project_id = p.id LEFT JOIN notes n ON r.note_id = n.id ${where} ORDER BY r.created_at DESC`, values);
    const visible = []; for (const row of result.rows) { const access = await getResourceAccess(row.id, req.user); if (access.access !== 'none' && !access.context?.invalid) visible.push(row); } res.json(visible);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch resources' }); }
});

router.get('/:id/access-url', async (req, res) => { try { const result = await pool.query('SELECT id, kind FROM resources WHERE id = $1', [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' }); const access = await requireResourceRead(req.params.id, req.user); if (!access.ok) return res.status(access.status).json({ error: access.error }); if (result.rows[0].kind !== 'file') return res.status(400).json({ error: 'Only file resources have access URLs' }); const accessToken = jwt.sign({ purpose: 'resource-download', resourceId: req.params.id, userId: req.user.userId }, config.jwtSecret, { expiresIn: '5m' }); res.json({ url: `${req.protocol}://${req.get('host')}/api/resources/${req.params.id}/download?access_token=${encodeURIComponent(accessToken)}` }); } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create resource access URL' }); } });
router.get('/:id', async (req, res) => { try { const result = await pool.query('SELECT id, name, kind, file_type, original_filename, mime_type, size_bytes, local_media_path, local_media_filename, local_media_mime_type, local_media_size_bytes, local_media_downloaded_at, parent_resource_id, relative_path, url, thumbnail_url, category, description, tags, updated_at, item_id, project_id, note_id, created_at FROM resources WHERE id = $1', [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' }); const access = await requireResourceRead(req.params.id, req.user); if (!access.ok) return res.status(access.status).json({ error: access.error }); res.json(result.rows[0]); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch resource' }); } });

router.get('/:id/manifest', async (req, res) => { try { const folder = await pool.query(`SELECT * FROM resources WHERE id = $1 AND kind = 'folder'`, [req.params.id]); if (!folder.rowCount) return res.status(404).json({ error: 'Folder resource not found' }); const access = await requireResourceRead(req.params.id, req.user); if (!access.ok) return res.status(access.status).json({ error: access.error }); const children = await pool.query(`SELECT id, relative_path, original_filename, size_bytes, mime_type FROM resources WHERE parent_resource_id = $1 ORDER BY relative_path ASC`, [req.params.id]); res.json({ folder: folder.rows[0].name, files: children.rows }); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to build manifest' }); } });

// Remaining resource upload/download/edit routes are unchanged.
