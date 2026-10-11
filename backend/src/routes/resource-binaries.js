import { createResourceBinaryStore, binaryError, binarySource } from '../resource-binaries.js';
import { STORAGE_DIR } from '../storage.js';
import { pool } from '../db.js';
import { credentialVersionMatches } from '../credential-version.js';
import { getUserPermissions } from '../middleware/permissions.js';
import { requireResourceRead } from '../middleware/resource-access.js';

const store = createResourceBinaryStore(STORAGE_DIR);

async function authorize(req) {
  // Hashing a large file can take time. Recheck current credentials, role,
  // global permission and ancestor/record visibility before returning bytes.
  const user = (await pool.query('SELECT id,role,is_active,credential_version FROM users WHERE id=$1', [req.user.userId])).rows[0];
  if (!user?.is_active) throw binaryError(401, 'ACCOUNT_DISABLED');
  if (!credentialVersionMatches(req.user, user)) throw binaryError(401, 'SESSION_REVOKED');
  const current = { ...req.user, role: user.role };
  const permissions = await getUserPermissions(user.id, user.role);
  if (!permissions.has('resources.view')) throw binaryError(403, 'PERMISSION_DENIED');
  const access = await requireResourceRead(req.params.id, current);
  if (!access.ok) throw binaryError(access.status, 'RESOURCE_ACCESS_REQUIRED');
  const resource = (await pool.query('SELECT * FROM resources WHERE id=$1', [req.params.id])).rows[0];
  if (!resource) throw binaryError(404, 'BINARY_UNAVAILABLE');
  return resource;
}

// Dependency injection supports focused boundary tests without a mock database.
export function createBinaryHandlers({ binaryStore = store, authorizeResource = authorize } = {}) {
  const handler = mode => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id)) {
        throw binaryError(400, 'INVALID_RESOURCE_ID');
      }
      const before = await authorizeResource(req);
      const result = mode === 'manifest' ? await binaryStore.manifest(before)
        : await binaryStore.chunk(before, req.headers['if-match'], req.headers.range);
      if (res.writableEnded || res.destroyed) return;
      const after = await authorizeResource(req);
      if (JSON.stringify(binarySource(before)) !== JSON.stringify(binarySource(after))) {
        throw binaryError(412, 'BINARY_CHANGED');
      }
      if (mode === 'manifest') return res.json(result);
      res.setHeader('ETag', result.etag);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes ${result.start}-${result.end}/${result.size}`);
      res.setHeader('Content-Length', result.bytes.length);
      res.setHeader('X-Chunk-SHA256', result.sha256);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
      return res.status(206).send(result.bytes);
    } catch (error) {
      if (res.writableEnded || res.destroyed) return;
      const status = error.status || 503;
      if (status === 416 && Number.isSafeInteger(error.size)) res.setHeader('Content-Range', `bytes */${error.size}`);
      if (status === 503) res.setHeader('Retry-After', '5');
      return res.status(status).json({ error: { code: error.status ? error.code : 'BINARY_UNAVAILABLE', message: 'Resource transfer unavailable; refresh its manifest before retrying.' } });
    }
  };
  return { manifest: handler('manifest'), chunk: handler('chunk') };
}

export const resourceBinaryHandlers = createBinaryHandlers();
