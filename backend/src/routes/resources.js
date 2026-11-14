import {changeResourceVisibility,changeResourceGrant,resourceSharingTransaction} from '../resource-sharing.js';
import {getResourceFolderManifest} from '../resource-folder-manifest.js';
import {browserResourceLink} from '../resource-browser-links.js';
import {browserResourceUpload} from '../resource-browser-uploads.js';
import {deleteResourceRecord} from '../resource-delete.js';
import {authorizeResourceMutation} from '../resource-sync-actor.js';
import {currentResourceActor} from '../resource-sync-actor.js';
import {requireFolderNamespace} from '../resource-folder-namespace.js';
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
import { getUserPermissions } from '../middleware/permissions.js';
import { getResourceAccess, getResourceContext, requireResourceRead, requireResourceEditor, validateResourceParent } from '../middleware/resource-access.js';
import { canManageEntityGrants, isVisibility } from '../middleware/visibility.js';
import { STORAGE_DIR, inferFileType, resolveStoragePath, sanitizeRelativePath } from '../storage.js';

import { ensureResourcePoster, prepareResourcePoster } from '../resource-posters.js';
import { resourceBinaryHandlers } from './resource-binaries.js';
import resourceUploadsRouter from './resource-uploads.js';

const router = Router();
router.use(resourceUploadsRouter);
router.get('/:id/binary-manifest', resourceBinaryHandlers.manifest);
router.get('/:id/binary', resourceBinaryHandlers.chunk);
router.get('/:id/thumbnail',async(req,res)=>{
  try{
    const access=await requireResourceRead(req.params.id,req.user);
    if(!access.ok)return res.status(access.status).json({error:access.error});
    const resource=(await pool.query('SELECT * FROM resources WHERE id=$1',[req.params.id])).rows[0];
    if(!resource)return res.sendStatus(404);
    const poster=await ensureResourcePoster(resource);
    const current=await requireResourceRead(req.params.id,req.user);
    if(!current.ok)return res.sendStatus(current.status);
    res.setHeader('Cache-Control','private, no-store');res.type('image/jpeg').sendFile(poster);
  }catch(error){res.status(error.status||503).json({error:{code:'PREVIEW_UNAVAILABLE',message:'Video preview unavailable; the video is unchanged'}});}
});
const TMP_DIR = path.join(STORAGE_DIR, '_incoming');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ storage: multer.diskStorage({ destination: TMP_DIR, filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}-${path.basename(file.originalname)}`) }), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 100 } });
function parentFields(body) { return { item_id: body.item_id || null, project_id: body.project_id || null, note_id: body.note_id || null, parent_resource_id: body.parent_resource_id || null }; }
function validateAtMostOneParent({ item_id, project_id, note_id, parent_resource_id }) { return [item_id, project_id, note_id, parent_resource_id].filter(Boolean).length <= 1; }
const KNOWLEDGE_CATEGORIES = new Set(['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other']);
function knowledgeMetadata(body) { const category = typeof body.category === 'string' && KNOWLEDGE_CATEGORIES.has(body.category) ? body.category : 'general'; const rawTags = Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? (() => { try { return JSON.parse(body.tags); } catch { return body.tags.split(','); } })() : []); const tags = Array.isArray(rawTags) ? rawTags.map(v => String(v).trim()).filter(Boolean).slice(0, 30) : []; return { category, description: typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '', tags }; }
router.get('/', async (req, res) => { const { item_id, project_id, note_id, parent_resource_id, include_descendants } = req.query; const conditions = []; const values = []; if (item_id) { values.push(item_id); conditions.push(`r.item_id = $${values.length}`); conditions.push(`r.id IS DISTINCT FROM (SELECT image_resource_id FROM items WHERE id = $${values.length})`); } if (project_id) { values.push(project_id); conditions.push(`r.project_id = $${values.length}`); } if (note_id) { values.push(note_id); conditions.push(`r.note_id = $${values.length}`); } if (parent_resource_id) { values.push(parent_resource_id); conditions.push(`r.parent_resource_id = $${values.length}`); } const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : include_descendants === 'true' ? '' : `WHERE r.parent_resource_id IS NULL`; try { if (project_id) { const access = await getProjectAccess(project_id, req.user); if (access.access === 'none') return res.status(403).json({ error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } }); } if (note_id) { const parentCheck = await validateResourceParent({ noteId: note_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); } if (item_id) { const parentCheck = await validateResourceParent({ itemId: item_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); } if (parent_resource_id) { const parentCheck = await validateResourceParent({ parentResourceId: parent_resource_id, user: req.user, requireEdit: false }); if (!parentCheck.ok) return res.status(parentCheck.status).json({ error: parentCheck.error }); } const result = await pool.query(`SELECT r.id, r.name, r.name_source, r.kind, r.file_type, r.original_filename, r.mime_type, r.size_bytes, r.parent_resource_id, r.relative_path, r.url, r.thumbnail_url, r.category, r.description, r.tags, r.visibility, r.updated_at, r.created_at, r.item_id, r.project_id, r.note_id, i.name AS item_name, p.name AS project_name, n.title AS note_title FROM resources r LEFT JOIN items i ON r.item_id = i.id LEFT JOIN projects p ON r.project_id = p.id LEFT JOIN notes n ON r.note_id = n.id ${where} ORDER BY r.created_at DESC`, values); const visible = []; for (const row of result.rows) { const access = await getResourceAccess(row.id, req.user); if (access.access !== 'none' && !access.context?.invalid) visible.push(row); } res.json(visible); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch resources' }); } });
router.get('/:id/access-url', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, kind FROM resources WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' });
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (result.rows[0].kind !== 'file') return res.status(400).json({ error: 'Only file resources have access URLs' });
    // Preserve the version authenticated by middleware. A concurrent reset must
    // revoke this link too, not upgrade it to the account's new authority.
    const accessToken = jwt.sign({
      purpose: 'resource-download', resourceId: req.params.id,
      userId: req.user.userId, credentialVersion: req.user.credentialVersion,
    }, config.jwtSecret, { expiresIn: '5m' });
    res.json({ url: `${req.protocol}://${req.get('host')}/api/resources/${req.params.id}/download?access_token=${encodeURIComponent(accessToken)}` });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create resource access URL' }); }
});
router.get('/:id', async (req, res) => { try { const result = await pool.query('SELECT id, name, name_source, kind, file_type, original_filename, mime_type, size_bytes, parent_resource_id, relative_path, url, thumbnail_url, category, description, tags, visibility, updated_at, item_id, project_id, note_id, created_at FROM resources WHERE id = $1', [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' }); const access = await requireResourceRead(req.params.id, req.user); if (!access.ok) return res.status(access.status).json({ error: access.error }); res.json(result.rows[0]); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch resource' }); } });
router.get('/:id/manifest',getResourceFolderManifest);
router.get('/:id/download', async (req, res) => { try { const result = await pool.query(`SELECT * FROM resources WHERE id = $1`, [req.params.id]); if (result.rows.length === 0) return res.status(404).json({ error: 'Resource not found' }); const resource = result.rows[0]; const access = await requireResourceRead(req.params.id, req.user); if (!access.ok) return res.status(access.status).json({ error: access.error }); if (req.user?.purpose === 'resource-download' && req.user.resourceId !== resource.id) return res.status(403).json({ error: 'Resource access token does not match this resource' }); if (resource.kind !== 'file') return res.status(400).json({ error: 'Only file resources can be downloaded directly — use /manifest for folders' }); const filePath = resolveStoragePath(resource.storage_path); const stat = await fsp.stat(filePath); const range = req.headers.range; const viewableInline = ['image', 'video', 'audio', 'pdf', 'text'].includes(resource.file_type); const forceDownload = req.query.download === 'true'; const disposition = viewableInline && !forceDownload ? 'inline' : 'attachment'; res.setHeader('Content-Type', resource.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(resource.original_filename || resource.name)}"`); if (range) { const [startStr, endStr] = range.replace(/bytes=/, '').split('-'); const start = parseInt(startStr, 10); const end = endStr ? parseInt(endStr, 10) : stat.size - 1; res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }); fs.createReadStream(filePath, { start, end }).pipe(res); } else { res.setHeader('Content-Length', stat.size); fs.createReadStream(filePath).pipe(res); } } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to download resource' }); } });
router.post('/',upload.single('file'),browserResourceUpload({metadata:knowledgeMetadata}));
router.post('/folder',async(req,res)=>{
 const parents=parentFields(req.body);let client;
 try{
  const name=typeof req.body.name==='string'?req.body.name.trim():'';
  if(!name||!validateAtMostOneParent(parents))return res.status(400).json({error:'Supply a name and one attachment destination'});
  client=await pool.connect();await client.query('BEGIN');
  const currentUser=await currentResourceActor(client,req.user);
  const permissions=await getUserPermissions(req.user.userId,currentUser.role,{client,lock:true});
  if(!permissions.has('resources.create')||!permissions.has('resources.view'))throw Object.assign(Error('Resource create and view permissions required'),{status:403});
  const parent=await validateResourceParent({itemId:parents.item_id,projectId:parents.project_id,noteId:parents.note_id,parentResourceId:parents.parent_resource_id,user:currentUser});
  if(!parent.ok)throw Object.assign(Error(parent.error?.message||'Folder destination is unavailable'),{status:parent.status});
  const record={name,...parents,relative_path:req.body.relative_path??null};
  await requireFolderNamespace(client,record);
  const metadata=knowledgeMetadata(req.body);
  const created=(await client.query("INSERT INTO resources(name,name_source,kind,file_type,item_id,project_id,note_id,parent_resource_id,relative_path,category,description,tags,uploaded_by) VALUES($1,'user','folder','schematic_folder',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[name,...[parents.item_id,parents.project_id,parents.note_id,parents.parent_resource_id],record.relative_path,metadata.category,metadata.description,metadata.tags,req.user.userId])).rows[0];
  await writeAuditLog({req,action:'CREATE',entityType:'resource',entityId:created.id,newValue:created,client,required:true});
  await client.query('COMMIT');res.status(201).json(created);
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});res.status(error.status||500).json({error:{code:error.code||'FOLDER_CREATE_FAILED',message:error.message||'Failed to create folder'}});}finally{client?.release();}
});
router.post('/:folderId/files',upload.array('files'),browserResourceUpload({folder:true,metadata:knowledgeMetadata}));
router.post('/link',browserResourceLink({metadata:knowledgeMetadata}));
// The V2 details editor uses the transactional reviewed sync handler. Keep an
// explicit error for older callers instead of silently accepting an unversioned
// write outside the mandatory audit/idempotency transaction.
router.put('/:id', (_req,res)=>res.status(409).json({error:{code:'RESOURCE_METADATA_INTENT_REQUIRED',message:'Submit resource details as a reviewed, retry-stable edit_metadata intent through /sync/push, then read the current authorized resource.'}}));
function sharingFailure(res,error){if(!error.status)console.error('Resource sharing transaction failed:',error);return res.status(error.status||500).json({error:{code:error.code||'RESOURCE_SHARING_FAILED',message:error.status?error.message:'Resource sharing could not be saved; no partial change was committed'}});}
router.put('/:id/visibility',async(req,res)=>{try{res.json(await resourceSharingTransaction(client=>changeResourceVisibility(client,req.params.id,req.body?.visibility,req.user,req)));}catch(error){sharingFailure(res,error);}});

async function requireResourceGrantManager(resourceId,user){
 const permissions=await getUserPermissions(user.userId,user.role);
 if(!permissions.has('resources.edit'))return {ok:false,status:403,error:'Permission required: resources.edit'};
 const context=await getResourceContext(resourceId);
 if(!context)return {ok:false,status:404,error:'Resource not found'};
 if(context.invalid)return {ok:false,status:409,error:'Resource has conflicting project ownership'};
 if(context.resource.visibility!=='restricted')return {ok:false,status:409,error:'Access grants apply only to restricted resources'};
 if(!(await canManageEntityGrants({projectId:context.projectId,user})))return {ok:false,status:403,error:'Only an administrator or project lead can manage other users’ grants'};
 return {ok:true,context};
}

router.get('/:id/access-grants',async(req,res)=>{try{const access=await requireResourceGrantManager(req.params.id,req.user);if(!access.ok)return res.status(access.status).json({error:access.error});const result=await pool.query("SELECT g.user_id,g.access_level,g.created_at,g.created_by,u.username FROM record_access_grants g JOIN users u ON u.id=g.user_id WHERE g.entity_type='resource' AND g.entity_id=$1 ORDER BY u.username",[req.params.id]);res.json(result.rows);}catch(err){console.error(err);res.status(500).json({error:'Failed to load resource access grants'});}});
router.put('/:id/access-grants/:userId',async(req,res)=>{try{res.json(await resourceSharingTransaction(client=>changeResourceGrant(client,req.params.id,req.params.userId,req.body?.access_level,req.user,req)));}catch(error){sharingFailure(res,error);}});
router.delete('/:id/access-grants/:userId',async(req,res)=>{try{await resourceSharingTransaction(client=>changeResourceGrant(client,req.params.id,req.params.userId,null,req.user,req));res.status(204).send();}catch(error){sharingFailure(res,error);}});
// Reassign an existing resource without re-uploading it. A resource has one direct parent.
router.put('/:id/attachment', async (req,res)=>{
 const permissions=await getUserPermissions(req.user.userId,req.user.role);
 if(!permissions.has('resources.edit'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: resources.edit'}});
 const parents=parentFields(req.body);
 if(!validateAtMostOneParent(parents))return res.status(400).json({error:'Choose only one attachment destination'});
 try{
  const existing=await pool.query('SELECT * FROM resources WHERE id=$1',[req.params.id]);
  if(!existing.rowCount)return res.status(404).json({error:'Resource not found'});
  const resource=existing.rows[0];
  if(resource.parent_resource_id)return res.status(409).json({error:'Nested resources must be moved using folder management'});
  const source=await requireResourceEditor(req.params.id,req.user);
  if(!source.ok)return res.status(source.status).json({error:source.error});
  const destination=await validateResourceParent({itemId:parents.item_id,projectId:parents.project_id,noteId:parents.note_id,user:req.user});
  if(!destination.ok)return res.status(destination.status).json({error:destination.error});
  const result=await pool.query('UPDATE resources SET item_id=$1,project_id=$2,note_id=$3,updated_at=now() WHERE id=$4 RETURNING *',[parents.item_id,parents.project_id,parents.note_id,req.params.id]);
  await writeAuditLog({req,action:'UPDATE',entityType:'resource',entityId:req.params.id,oldValue:resource,newValue:result.rows[0]});
  res.json(result.rows[0]);
 }catch(err){console.error(err);res.status(500).json({error:'Failed to update resource attachment'});}
});
async function visibleResourceFacetRows(user) {
  const result = await pool.query('SELECT id,category,tags FROM resources');
  const visible = [];
  // Facets must obey the same ancestor, attached-Note, and project rules as
  // the resource list. Keep concurrency bounded for large libraries.
  for (let offset = 0; offset < result.rows.length; offset += 16) {
    const batch = result.rows.slice(offset, offset + 16);
    const access = await Promise.all(batch.map(row => getResourceAccess(row.id, user)));
    for (let i = 0; i < batch.length; i++) {
      if (access[i].access !== 'none' && !access[i].context?.invalid) visible.push(batch[i]);
    }
  }
  return visible;
}
router.get('/meta/tags', async (req,res)=>{
  try {
    const rows = await visibleResourceFacetRows(req.user);
    res.json([...new Set(rows.flatMap(row => row.tags || []))].sort());
  } catch(err) {
    console.error(err);
    res.status(500).json({error:'Failed to fetch resource tags'});
  }
});
router.get('/meta/categories', async (req,res)=>{
  try {
    const rows = await visibleResourceFacetRows(req.user);
    const counts = new Map();
    for (const row of rows) counts.set(row.category, (counts.get(row.category) || 0) + 1);
    res.json([...counts].map(([category,count]) => ({category,count})).sort((a,b) =>
      a.category === null ? 1 : b.category === null ? -1 : String(a.category).localeCompare(String(b.category))));
  } catch(err) {
    console.error(err);
    res.status(500).json({error:'Failed to fetch resource categories'});
  }
});
router.delete('/:id',async(req,res,next)=>{
 let client;
 try{
  client=await pool.connect();await client.query('BEGIN');
  const user=await authorizeResourceMutation(client,{operation:'delete'},req.user);
  await deleteResourceRecord(client,req.params.id,user,{request:req});
  await client.query('COMMIT');res.status(204).send();
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});next(error);}finally{client?.release();}
});
export default router;
