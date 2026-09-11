import assert from 'node:assert/strict';
import { requestId, securityHeaders, rateLimit } from './middleware/security.js';

function mockRes() {
  const headers = new Map();
  return {
    headers,
    setHeader(k, v) { headers.set(k, v); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const req = { get: () => undefined, ip: '127.0.0.1' };
const res = mockRes();
let nextCalled = false;
requestId(req, res, () => { nextCalled = true; });
assert.equal(nextCalled, true);
assert.match(req.requestId, /^[0-9a-f-]{36}$/);
assert.equal(res.headers.get('X-Request-ID'), req.requestId);

const headerRes = mockRes();
securityHeaders({}, headerRes, () => {});
assert.equal(headerRes.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(headerRes.headers.get('X-Frame-Options'), 'DENY');
assert.equal(headerRes.headers.get('Referrer-Policy'), 'no-referrer');

const limited = rateLimit({ windowMs: 60_000, max: 2, keyGenerator: () => 'security-test' });
for (let i = 0; i < 2; i++) {
  const r = mockRes();
  limited({ ip: '127.0.0.1' }, r, () => { r.next = true; });
  assert.equal(r.next, true);
}
const blocked = mockRes();
limited({ ip: '127.0.0.1' }, blocked, () => { blocked.next = true; });
assert.equal(blocked.statusCode, 429);
assert.equal(blocked.body.error.code, 'RATE_LIMITED');

console.log('Security foundation checks passed.');
