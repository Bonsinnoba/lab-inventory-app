import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { credentialVersionMatches, tokenCredentialVersion } from './credential-version.js';
import { authenticateToken } from './middleware/auth.js';
import { pool } from './db.js';
import { config } from './config.js';

test('legacy tokens match only version zero', () => {
  assert.equal(tokenCredentialVersion({}), 0);
  assert.equal(credentialVersionMatches({}, { credential_version: 0 }), true);
  assert.equal(credentialVersionMatches({}, { credential_version: 1 }), false);
});

test('credential claims must be exact nonnegative integers', () => {
  for (const value of [null, '0', -1, 0.5, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(credentialVersionMatches({ credentialVersion: value }, { credential_version: 0 }), false);
  }
  assert.equal(credentialVersionMatches({ credentialVersion: 2 }, { credential_version: 2 }), true);
  assert.equal(credentialVersionMatches({ credentialVersion: 1 }, { credential_version: 2 }), false);
  assert.equal(credentialVersionMatches({ credentialVersion: 3 }, { credential_version: 2 }), false);
  assert.equal(credentialVersionMatches({}, {}), false);
});

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('authentication differentiates invalid tokens, revoked sessions and DB outage', async (t) => {
  const query = t.mock.method(pool, 'query', async () => ({ rowCount: 1, rows: [{ id: 'user', role: 'member', is_active: true, credential_version: 2 }] }));
  const run = async (claims, path = '/me', useQuery = false) => {
    const token = jwt.sign(claims, config.jwtSecret, { expiresIn: '1m' });
    const req = { headers: useQuery ? {} : { authorization: `Bearer ${token}` }, path, query: useQuery ? { access_token: token } : {} };
    const res = response(); let next = false;
    await authenticateToken(req, res, () => { next = true; });
    return { req, res, next };
  };
  const accepted = await run({ userId: 'user', credentialVersion: 2 });
  assert.equal(accepted.next, true);
  assert.equal(accepted.req.user.credentialVersion, 2);
  for (const claims of [{ userId: 'user' }, { userId: 'user', credentialVersion: 1 }]) {
    const denied = await run(claims);
    assert.equal(denied.res.statusCode, 401);
    assert.equal(denied.res.body.error.code, 'SESSION_REVOKED');
    assert.equal(denied.next, false);
  }
  assert.equal((await run({ userId: 'user', credentialVersion: 2, purpose: 'resource-download' })).res.body.error.code, 'INVALID_TOKEN_PURPOSE');
  assert.equal((await run({ userId: 'user', credentialVersion: 2 }, '/me', true)).res.body.error.code, 'AUTH_REQUIRED');
  assert.equal((await run({ userId: 'user', credentialVersion: 2, purpose: 'resource-download' }, '/fixture/download', true)).next, true);
  assert.equal((await run({ userId: 'user', credentialVersion: 1, purpose: 'resource-download' }, '/fixture/download', true)).res.body.error.code, 'SESSION_REVOKED');
  query.mock.mockImplementation(async () => { throw new Error('test DB outage'); });
  const unavailable = await run({ userId: 'user', credentialVersion: 2 });
  assert.equal(unavailable.res.statusCode, 503);
  assert.equal(unavailable.res.body.error.code, 'AUTH_UNAVAILABLE');
  const invalid = response();
  await authenticateToken({ headers: { authorization: 'Bearer invalid' }, path: '/me', query: {} }, invalid, () => assert.fail());
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.error.code, 'INVALID_TOKEN');
});
