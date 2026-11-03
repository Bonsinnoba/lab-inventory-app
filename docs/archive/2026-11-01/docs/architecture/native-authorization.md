# Native authorization exchange

Phase 2 implementation design, October 10, 2026.

Use a native authenticated exchange rather than renderer-supplied claims or a new
offline signing-key distribution system. Native login sends credentials directly
to the trusted server, then retrieves effective permissions with the returned
token. Only the typed, validated native response may publish credentials, identity,
permissions and a new lease in SQLite. Renderer parameters cannot select the server,
account ID, role or grants. Permission refresh independently calls that same server
and compares the account and captured native session; it never renews a lease.

The native API origin is fixed at build time with LABOS_NATIVE_API_BASE (default
http://localhost:4000/api). Deployments must build the renderer API base to match.
Only HTTPS, or explicit loopback HTTP for the development installation, is allowed.
Redirects and environment proxies are disabled for this exchange. This trusts the
configured server/TLS and the local development service, not an arbitrary renderer
URL. It does not protect a compromised OS or malicious process replacing that local
development service. Credentials and tokens must never be logged.

Only transport failure / server unavailability during initial login may fall back
to an existing valid offline password cache. Explicit credential denial, malformed
responses and failure after successful password verification cannot promote stale
permissions. Native request generations reject late login completion after logout,
another login or observed revocation. Successful offline login never extends expiry.

This closes an IPC privilege-escalation route, not physical-disk tampering. Existing
cached data is retained; previously provisioned authority is not retroactively
cryptographically proven. Secure storage/encryption, legacy authority transition,
direct transport coverage and actual desktop outage
acceptance remain independently tracked until verified. No database reset is allowed.

## Local password and clock safeguards

- Failed cached-password verification is persisted per cached account. The first
  four failures have no artificial wait; the fifth imposes 15 seconds, with
  exponential backoff capped at 15 minutes. Correct-password attempts during the
  wait remain blocked. Successful offline login or verified online login clears
  that account's counter. Restart and logout do not clear it; other accounts are
  unaffected. This does not replace server rate limiting or protect stolen hashes.
- Native connection opening records a persistent UTC high-water mark. Backward
  movement beyond five minutes invalidates cached leases without erasing business
  records or outbox events. Returning the clock forward does not resurrect leases.
  A verified online password login recovers only the authenticated account's
  lease and resets the clock baseline. This is not a tamper-proof trusted clock.
- The existing 24-hour privileged / seven-day ordinary limits are unchanged.
  Permission refresh, cold start and cached-password login never renew them.

Storage decision pending: Windows-protected key with an explicit encrypted recovery
backup is recommended; alternatives are device-only (risk of unrecoverable unsynced
work) or administrator-held recovery (custodian access). Do not migrate real cache
encryption or silently select a recovery custodian before the owner chooses.
