# Server credential revocation (Phase 2 slice)

Server-authoritative credential changes are intentionally online-only; passwords
must never enter the offline outbox. This slice does not change SQLite leases or
make renderer-supplied permission caches trustworthy.

## Contract

- `users.credential_version` is a nonnegative integer. Session JWTs and temporary
  resource-download JWTs carry the version observed during authentication.
- Every authenticated request compares the signed version against PostgreSQL,
  alongside the existing active-account check. A mismatch returns HTTP 401 with
  `SESSION_REVOKED`; database unavailability returns 503, not an invalid-token 401.
- A database trigger increments the version when the password hash changes or
  the account transitions from active to disabled. Re-enabling an account cannot
  revive its old tokens. Profile/role edits do not increment this version; current
  roles and permissions are already checked separately on the server.
- Version changes participate in the same transaction as the password/status
  update and required audit record. Rollback must restore all three. SQL writers
  cannot accidentally bypass the increment or lower an existing version.
- Migration starts existing accounts at version zero. A previously signed token
  with no version is treated as version zero ONLY; it stops working after the
  first credential invalidation. This avoids a mass forced logout at deployment
  without letting legacy tokens bypass later revocation. Explicit null/string,
  negative and fractional versions are rejected.
- Login signs the version read with the verified password hash, not a later
  version fetched after password verification. A reset racing login can therefore
  yield a rejected old-version token, never a fresh token from an old password.
- Successful password change/reset invalidates all older server tokens, including
  the caller's token if it belongs to the target account. The response requests
  sign-in again; no replacement token is silently minted. Requests already past
  middleware are not retroactively cancelled. The self-password route additionally
  rechecks the credential version under its user-row lock.

## Observed revocation bridge (October 10 implementation)

The shared desktop HTTP/auth adapters capture both their frontend session generation
and the native session's opaque compare-and-lock guard before authenticated network
requests. On a current `SESSION_REVOKED` or `ACCOUNT_DISABLED` response they ask
native code to invalidate only that exact account/session. The native transaction
clears its effective permissions and lease, marks cached access locked, and removes
the matching session. Business rows, outbox events and author identity are untouched.
Local login and restart cannot restore that locked cache. A new online password
login is required. Normal `INVALID_TOKEN` expiry clears the server session without
revoking an otherwise valid offline lease; network/503 failure is not revocation.

Successful self-password change uses the same lock and reauthentication path. A
lost response does not prove a credential change; later observed server rejection
must reconcile it. The frontend auth-expired event now exits the authenticated UI
and clears its in-memory query cache. Late permission loads cannot populate a new
account's UI. Captured native guards reject delayed locks/permission refreshes after
another login, including a newer login by the same account.

Permission refresh requires the same active native session and cannot reactivate
locked authorization or renew a lease. Online cache publication commits credential
and native-session updates atomically so a late lock cannot intervene between them.
Cached-password verification and offline session creation also share an immediate
transaction: a concurrent credential refresh cannot interleave between those steps.
The login bootstrap does not publish a new server token with the previous user's
identity while its permission request is still pending.

This bridge **reduces** cached access only. It does not authenticate permission
claims from the renderer, solve local database tampering, or make the existing
`cache_server_user` command trustworthy. Native-verified positive authorization is
still required. A failed SQLite lock transaction is surfaced as an error and rolls
back, not falsely reported as a persisted revocation. Direct transport paths outside
the shared adapters and full interactive desktop revocation acceptance remain in
the audit; automated component tests alone are not whole-system security sign-off.

## Later October 10 native-verification follow-up

The native authenticated exchange in `native-authorization.md` replaces the
renderer-asserted positive claims described above. Login generation guards,
persistent cached-password throttling and conservative clock-rollback lease
invalidation are implemented and tested. These do not encrypt the cache or migrate
renderer token storage. Earlier sections describe their dated implementation slice;
refer to the latest PHASE2_EVIDENCE.md for runtime/outage acceptance boundaries.

## Still open

An offline PC cannot learn a remote reset while disconnected. Existing offline
leases remain 24 hours for privileged accounts and seven days for ordinary users.
Complete observed-revocation acceptance, protected token/key storage, encryption,
legacy authorization-cache transition and remaining transport/native permission
coverage remain Phase 2 work. Cached password hashes are not replaced by a password-change request;
the matching cache is locked on confirmed success, and only a new successful online
login refreshes it. This is NOT end-to-end offline security acceptance. Preserve
pending authored work throughout the remaining changes.

Tests use namespaced fixtures in the existing PostgreSQL database. No user account
passwords, global secrets, business data or volumes are reset.
