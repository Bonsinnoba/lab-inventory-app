# LabOS shared synchronization contract

Phase 1 contract, 2026-10-03. Implementation status is in the audit and evidence ledger; this document does not imply every Phase 2 module already conforms.

## Identity, ownership and atomicity

- PostgreSQL is the shared laboratory authority. SQLite is an account-scoped local working copy, not another independent laboratory.
- Generate an entity UUID once, before the first local commit. Canonical representation is lowercase hyphenated UUID. Normalize legacy compact forms at boundaries; do not regenerate IDs when pulling or retrying. Existing compact change IDs remain opaque, valid retry identities until acknowledged.
- Generate one change ID per immutable intent. Retries retain the exact key and payload. An explicit conflict overwrite is a new intent and gets a new key; its predecessor remains resolved for traceability. New-key reuse of an existing entity UUID is a collision, not success.
- Commit business state and its outbox event in one SQLite transaction. If either fails, roll back both and surface the error. No desktop HTTP-write fallback on unavailable SQLite, rejected IPC or null return. A Rust unit-returning delete may return null after success; it is not permission to issue a second server delete.
- Stamp the active central account onto the outbox in SQLite, rather than trusting a caller-supplied author. The server derives the author from its authenticated active account, never from a submitted author ID. Switching accounts must not relabel, transmit or acknowledge another account's pending changes.
- Server mutation, idempotency receipt and required delete tombstone must commit atomically. Required financial/administrative audit events belong in that transaction. Older direct routes whose audit/tombstone writes remain separate are a Phase 2 transaction-hardening item, not a model to copy.

## Authorization and offline leases

- Ordinary lab read domains are available to active authenticated accounts. Record scope still applies: child visibility cannot broaden its parent project's visibility. A restricted grant is not a substitute for a domain mutation capability or project edit authority.
- Finance read and sensitive-finance read are separate capabilities; sensitive access requires both. User and audit permissions remain separate. Authorize the existing stored row before accepting any submitted destination/relationship changes.
- Privileged offline access lasts at most 24 hours after successful password authentication with the server. This includes admins and accounts delegated user administration, audit or sensitive-finance/import capabilities. Ordinary accounts retain the existing seven-day lease.
- A permission refresh may shorten a lease but cannot renew it, change its authentication timestamp or extend it after a downgrade. Malformed/missing authentication provenance fails closed. On expiry, stop authorized operations without erasing the account's work. Reauthenticate online to renew.
- Server revocation takes effect on the next authenticated request. Offline revocation cannot be instantaneous on a disconnected device; the lease is the bound, not a claim of immediate remote deletion.

## Replay, conflicts and deletion

- Lost acknowledgement: retry the original event. Already committed requests acknowledge success without replaying a stale record snapshot that could now be unauthorized.
- Permission, validation and version conflicts are not all transport errors. Keep the author's intent and show recovery; do not silently change role grants, reassign authors or replace UUIDs to force acceptance.
- Conflict listing uses the event's domain. If the current account no longer has permission to see the payload, expose only redacted recovery metadata. Retrying requires current domain write permission; explicit discard requires ownership, not renewed access to secret contents.
- Inventory explicit keep-local overrides use a new change ID. Other retries keep the original payload unchanged. Generic retries do not invent a merge strategy for every domain. Phase 2 supplies richer per-domain conflict UI and version tests.
- Delete is an intent referencing the stable entity UUID. Replay must not duplicate effects. Server deletes emit tombstones; local revocation eviction is not an outbound delete.
- Finance and Location pulls are complete authorized snapshots, explicitly marked `snapshot_complete: true`. A client rejects an unmarked snapshot rather than treating a truncated/older response as authority to erase cache. Missing synchronized IDs are evicted even if their tombstones have aged beyond the latest 1,000. Pending authored intents are preserved.
- Notes, Resources, Projects, Knowledge and Engineering expose authorized ID sets. Preserve pending edits while reconciling authorized server rows. Inventory remains cursor-driven; any future tombstone retention/compaction must introduce a minimum cursor and full-resync protocol, never silently advance past unseen deletes.
- Pending work and currently readable cache are distinct concepts. Phase 2 must finish the recovery-only representation of pending records after row-level revocation across every local domain. Preservation does not mean unrestricted display or sync under a different user.

## Remaining domain contracts

- Maintenance: add `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` plus update trigger in an idempotent migration, backfill existing rows, add stable ID/outbox CRUD and versioned apply, and return full scope or a correct cursor/tombstone feed. Test repeated migration and older-client handling on actual PostgreSQL before rollout.
- Binary resources: stage immutable bytes under a validated account/entity UUID path; persist checksum, size and upload intent locally before claiming success. Retry upload by stable asset ID/checksum. Commit metadata once; server job execution and thumbnail generation are separate effects. Editor copies get a new UUID, retain ancestry/visibility and establish creator grants atomically. Never replace a source file merely to represent a copy.
- Hybrid preferences: notifications follow the account; media volume and auto-pause follow the device. See `daily-use-preferences.md`. Device settings do not produce server events; account settings do.
- Identity, permission grants, project approvals/reservation coordination, AI generation and automation execution remain explicitly online-authoritative. Do not manufacture offline success for an operation the server must arbitrate. Phase 2 must add consistent online-only UX, idempotency and local refresh.
- Imports need a stable batch ID and row IDs, atomic local import/outbox, server replay protection and current stored-row permission checks. Preview is computation, not a committed import. A failed import must not leave success audit entries for rolled-back writes.

## Legacy data decision

The owner explicitly chose to clear the existing installation's databases and seed new test data; that reset was executed on 2026-10-03. No unattributed legacy row needs to be assigned to a user in this installation. This does not authorize future automatic resets. Upgrade code must retain unattributed rows separately and never adopt them for the next person who logs in. Export/recovery UI remains Phase 2; it is not a prerequisite for testing this fresh installation.

## Verification boundaries

The real PostgreSQL probes and disk-backed two-client Notes test exercise the shared model. Full domain conversions, cross-domain failure/concurrency matrices and all-entity second-client runs remain Phase 2. Full GUI clients, installer upgrades, recovery/restore and owner acceptance remain Phase 3. A repository source index is not a substitute for those runtime checks.
