import { pool } from '../db.js';

export async function writeAuditLog({ req, actorUserId = null, action, entityType, entityId = null, oldValue = null, newValue = null, metadata = null, deviceId = null, client = pool, required = false }) {
  try {
    const auditMetadata = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...(req?.requestId ? { request_id: req.requestId } : {}),
      ...(req?.method && req?.originalUrl ? { endpoint: `${req.method} ${req.originalUrl}` } : {}),
      ...(deviceId ? { device_id: deviceId } : {}),
    };

    await client.query(
      `INSERT INTO audit_log
        (actor_user_id, action, entity_type, entity_id, old_value, new_value, metadata, ip_address, user_agent, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        actorUserId || req.user?.userId || null,
        action,
        entityType,
        entityId,
        oldValue == null ? null : JSON.stringify(oldValue),
        newValue == null ? null : JSON.stringify(newValue),
        Object.keys(auditMetadata).length ? JSON.stringify(auditMetadata) : null,
        req.ip || null,
        req.get?.('user-agent') || null,
        deviceId || null,
      ]
    );
  } catch (err) {
    // Audit failure must be visible, but should not turn a successful user
    // operation into a failed request. Critical actions can be made
    // transactional with the audit row later if the lab requires it.
    console.error('Audit log write failed:', err);
    if (required) throw err;
  }
}
