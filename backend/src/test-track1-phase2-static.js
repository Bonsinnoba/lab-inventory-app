import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`TRACK 1 PHASE 2 STATIC FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const audit = read('backend/src/middleware/audit.js');
const auth = read('backend/src/routes/auth.js');
const security = read('backend/src/middleware/security.js');

// Audit records retain request-level traceability without changing the audit table.
assert(/request_id/.test(audit), 'Audit metadata records request ID');
assert(/endpoint:\s*`\$\{req\.method\} \$\{req\.originalUrl\}`/.test(audit), 'Audit metadata records request endpoint');
assert(/auditMetadata/.test(audit), 'Audit metadata preserves caller-supplied metadata');

// Authentication security events must be auditable.
assert(/action:\s*'LOGIN_FAILED'/.test(auth), 'Failed logins generate audit events');
assert(/reason:\s*'unknown_user'/.test(auth), 'Unknown-user failures record a safe reason');
assert(/reason:\s*'invalid_password'/.test(auth), 'Invalid-password failures record a safe reason');
assert(/reason:\s*'account_disabled'/.test(auth), 'Disabled-account failures record a safe reason');
assert(/action:\s*'LOGIN'/.test(auth), 'Successful logins generate audit events');

// Existing security controls remain present.
assert(/export function loginRateLimit\(\)/.test(security), 'Login rate limiting remains enabled');
assert(/export function apiRateLimit\(\)/.test(security), 'API rate limiting remains enabled');
assert(/export function securityHeaders\(/.test(security), 'Security headers remain enabled');
assert(/export function requestTimeout\(/.test(security), 'Request timeout remains enabled');

console.log('\nTRACK 1 PHASE 2 STATIC REGRESSION TESTS PASSED');
