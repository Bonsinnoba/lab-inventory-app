# Project blank-date sync diagnosis — October 26

Identity: LABOS-P2-PRIMARY. Scope: read-only diagnosis of owner-reported personal V1 error; no repair or deployment yet.

MODULE: Projects; Phase2 B3/B4, shared sync validation.

FILE: backend/src/routes/sync.js, applyProjectEntity create/update field projection; desktop project date-input/write path requires follow-up.

CURRENT WRITE PATH: desktop project edits persisted to V1 SQLite/outbox; sync sends immutable project events; server uses `record[field] ?? null` for SQL parameters. Empty strings survive that expression.

WHY IT BYPASSES OFFLINE-FIRST: this is not a demonstrated transport bypass. It is a local/server value-contract mismatch that prevents queued writes from being accepted. The global sync notification appears on Resources even though the rejected entities are projects.

RISK: repeated retries cannot clear the two changes; later dependent edits may remain blocked. Do not erase queue rows, force ACKs, or reset the database.

RECOMMENDED CHANGE: normalize explicitly blank optional project dates to SQL NULL at the apply boundary without changing the immutable submitted payload or receipt identity. Normalize new local inputs too. Preserve omitted-field semantics and reject genuinely malformed nonblank dates clearly. Test create/update/clear, dependent edits, replay, rollback and real PostgreSQL behavior. Review other date-writing paths separately rather than applying indiscriminate string normalization.

ACTUAL CHANGE MADE: documentation only. SQLite opened read-only with query_only; no payload or acknowledgement edits. Server logs read; no restart/deployment.

VERIFICATION: two pending V1 project update events observed:

- b5389150-b4da-4ee5-840d-dcf1429b6b36: start_date=2026-10-26, due_date=""; 16 recorded attempts.
- 97ad90d3-901f-42ea-b4b3-9ea5946da168: start_date="", due_date=""; 4 recorded attempts.

Both last_error values are `invalid input syntax for type date: ""`. Server source passes empty strings unchanged in project SQL create/update. No document contents, credentials or tokens were included in diagnostics. The pending events are preserved; no full data-integrity claim is inferred from this query.

## Owner-authorized implementation follow-up

The owner requested a fix and direct administrator approval. Source now projects
blank optional project/task start/due dates to SQL NULL without mutating event
payloads; the project editor emits null for empty optional dates. Nonblank invalid
dates still fail validation at PostgreSQL; broader friendly date validation is not
claimed complete.

Admin approval may start from draft/changes_requested/submitted Planning states;
ordinary leads still submit. Existing current-authority transaction checks,
displayed-plan token checks, native lease/permissions, dirty-plan rejection,
outbox identity and server-confirmed activation are retained. Native and composer
UI changed together; the old installed app cannot expose the new action yet.

Verification: 22 focused JavaScript tests passed (one PostgreSQL opt-in initially
skipped). The actual development PostgreSQL date test subsequently passed 2/2;
rollback-only direct approval probe passed blank-date creation, activation,
mandatory-audit rollback and repeated-state rejection. Development API remained
stopped, its DB was started solely for testing and restored stopped. No V1 data
was changed. Native compilation/tests and full desktop outage/reconnect acceptance
remain pending; these are not inferred from backend checks.

TypeScript and seven native review tests also passed, including draft approval,
no local activation, stale token rejection, nonadmin/expired denial, disk failure
rollback and durable replay. Read-only comparison against the running V1 image
confirmed only the intended hotfix differs in the two changed server modules.

## Authorized V1 server hotfix deployment

Owner confirmed all edits saved and authorized API update and desktop restart.
Desktop was closed gracefully. With the V1 API stopped, captured desktop data,
PostgreSQL dump, storage and protected server configuration at
`C:/Users/balik/LabOS-Backups/v1-project-hotfix-20261026`.
Backup is captured and checksummed, not restore-tested.

V1 API is now pinned to image
`sha256:d636cca4f09d028ece263094563dc5a5540858a6361d1b480d1c847bb74d4796`.
Health verified API/database/storage OK. Existing volumes retained; no data reset
or manual outbox acknowledgement performed. Previous image retained for rollback.

STATUS: SERVER HOTFIX DEPLOYED — DESKTOP BUILD/INSTALL AND LIVE REPLAY PENDING.
Updated desktop build is running (execution session 98823). Installed desktop
binary remains the prior version and is closed. Verify the original two pending
events through normal synchronization after reopening; do not infer success from
server health. Full offline/reconnect acceptance remains pending.
