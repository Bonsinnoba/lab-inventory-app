# LabOS architecture, decisions and operating reference

## 2026-11-02 — A4/A5 resource export, range and recovery audit (PRIMARY)

MODULE: file consumers/export, resource dependencies and recovery (A4/A5/A2).
FILE: local_resource_export.rs, resource_file_response.rs, local_resource_uploads.rs,
resource_dependencies.rs; resources.ts, resource-dependencies.ts, ResourceViewerModal.tsx,
InventoryPage.tsx; native registration/Cargo filesystem feature and focused tests.
CURRENT WRITE PATH: external export is a user-selected copy of authorized native
bytes; it neither changes domain state nor needs an outbox event. Resource mutations
retain their SQLite/outbox/server path. Connected conflict retirement and recovery
identity archival share one SQLite transaction.
WHY IT BYPASSES OFFLINE-FIRST: the old viewer used whole-body renderer buffering and
desktop URL helpers could fall through to server URLs when local access was absent.
Exports exceeded the local service's 32 MiB whole-read bound; folder/copy dependencies
were incomplete, so rejected ancestry could leave descendants independently pending.
RISK: failed large exports, stale-account previews, accidental empty-URL app fetch,
partial destination overwrite, misleading range failures and stranded child intentions.
RECOMMENDED CHANGE: native bounded integrity-checked export, native-only desktop
file access, explicit unavailable state, correct bounded range protocol and durable
connected dependency/recovery evidence before retiring any intention.
ACTUAL CHANGE MADE: implemented those boundaries. Export paths originate in the
native Save dialog; no renderer path can select an arbitrary write target. Per-chunk
authorization plus exact source/digest checks precede atomic replacement. Failures
preserve the existing destination and clean only the unique export temporary file.
Range GET bodies remain capped at 4 MiB, whole reads at 32 MiB; HEAD has no body and
advertises complete length. Suffix ranges are supported; malformed/multipart/empty/
out-of-bounds ranges return 416 after authorization. Creation dependencies are derived
only from the captured ordered own-account outbox. The recovery table references
immutable payloads and retained file versions; it grants no restored access.
VERIFICATION: focused client/native and full native regressions PASS. Full frontend
rerun after final consumer review is recorded in WORK_LOG.md. No server writer was
changed; no substitute server database used. Running-desktop/dialog/media acceptance
is not inferred from native helpers, source compilation or browser tests.
STATUS: bounded source subchecks implemented; A4/A5/A2 remain PARTIAL. Remaining
mixed content/move and non-resource destination chains, legacy reconciliation,
consumer coverage, recovery UI/export, encryption and retention are not closed.

## 2026-11-02 — C1/C2 proposal synchronization audit (PRIMARY)

MODULE: assistant planning drafts and reviewed project graphs (C1/C2).
FILE: assistant-proposal-contract.js, assistant-proposals.js, routes/assistant-proposals.js,
routes/sync.js, sync-receipts.js, 20261102_assistant_proposals.sql; local_proposals.rs,
local_projects.rs, local_db.rs; assistant-proposals.ts, sync.ts, AssistantProposalsModal.tsx.
CURRENT WRITE PATH: desktop draft/approval -> atomic account-authored SQLite cache +
immutable proposal outbox event -> server authority/review validation -> canonical
project work handlers -> all effects/audits/receipt commit -> exact native ACK.
WHY IT BYPASSES OFFLINE-FIRST: domain writes no longer bypass this boundary. Online
model generation is an intentional provider operation; its persisted suggestion is
not lab execution. Browser writes use the same canonical server sync protocol.
RISK: stale approvals, unauthorized target context, duplicate generation/application,
partial graphs, speculative stock/results, missing receipt and lost editor contents.
RECOMMENDED CHANGE: bounded schemas, stable identities, owned persistent drafts,
reviewed revisions/digests, current authority and atomic graph/receipt application.
ACTUAL CHANGE MADE: implemented those contracts. Graph limits: 40 tasks, 20 experiments,
100 bundle-only links, 256 KiB canonical JSON. Version 1 accepts only planning text,
priorities, dates and graph links. New project is Planning/project-member visibility,
approver owner; tasks Todo and experiments Planned without results. No stock, cash,
reservation, grant or destructive lab operation is permitted. A generation request
has one UUID/result; explicit regeneration is separate. Failed/pending generations
never silently invoke the provider again. Draft origin is immutable and server-owned.
Browser uncertain intentions keep the exact payload for explicit retry; desktop
dependency ordering and exact graph receipt prevent premature acknowledgement.
VERIFICATION: shared JS/TS/Rust schema/digest fixtures, file-backed SQLite tests,
browser lost-receipt/session/partial-ACK checks, and real PostgreSQL production-router
failure injection PASS. Provider stubbed; fixtures rolled back. Frontend build PASS.
STATUS: PARTIAL. Deployment/outage/reconnect and independent-client acceptance,
live provider/model validation, full save-chain conflict recovery and form polish
remain. Existing recovery retains authored outbox history; no claim of a complete
proposal export/discard workflow. Proposal deletion has a server contract but no
native/UI delete action yet. C1/C2 do not enable chat tools or automatic acceptance.

## 2026-11-02 — C4 voice exception and deployment contract (PRIMARY)

MODULE: assistant/notebook voice input (C4).
FILE: assistant-transcription.js, routes/assistant-voice.js; assistant-voice.ts,
voiceCapture.ts and VoiceInputModal.tsx, integrated into AssistantChat/NotebookPage.
CURRENT WRITE PATH: ephemeral PC microphone recording -> explicit consented upload
-> authenticated server -> configured Gemini inline audio -> reviewable text.
WHY IT BYPASSES OFFLINE-FIRST: this is an approved online compute boundary, not a
domain mutation. Recording stays in memory; no local/server database, file-storage
or outbox audio write occurs. Explicit insertion changes a draft, whose eventual
save uses the ordinary repository/outbox; chat sending remains a separate action.
RISK: undisclosed processing/retention, stale-account transcripts, recording leaks,
uncertain upload retries and spoken content mistaken for executable instructions.
RECOMMENDED CHANGE: explicit provider disclosure, per-recording consent, bounded
cancellable capture/upload, review-only output and active-session fences.
ACTUAL CHANGE MADE: implemented those boundaries with a 6 MB server file cap,
60-second client recorder stop, supported MIME allowlist and per-account rate limit.
The server byte cap is not independent proof of a hostile upload's audio duration.
Provider requests have a deadline. Audio/model output invokes no lab tools. A retry
is explicit and may resend audio; cancellation cannot recall provider-received data.
VERIFICATION: 34 focused voice/audio tests, 2 config tests, and real PostgreSQL
production auth/multipart cases PASS. Provider stubbed; model quality, actual
recording permission/format support and deployed microphone behavior unverified.
STATUS: PARTIAL; disabled pending actual configuration and provider/hardware tests.

Configuration uses existing GEMINI_API_KEY plus LABOS_TRANSCRIPTION_ENABLED=true,
GEMINI_TRANSCRIPTION_MODEL (or explicit existing GEMINI_MODEL), and an accurate
LABOS_TRANSCRIPTION_PROVIDER_POLICY for the operator's actual service terms.
Do not invent a retention guarantee or paste credentials into the disclosure.
Changing model/disclosure changes consent identity. No automatic provider fallback.
The adapter uses inline generateContent audio supported by the existing SDK and
[Google's inline-audio documentation](https://ai.google.dev/gemini-api/docs/generate-content/audio).
Do not enable a model without verifying that account/model's audio support. API
JSON security headers do not prove the served frontend/WebView permits microphones;
verify the actual document policy and runtime in deployment acceptance.

## 2026-11-02 — C6 administrative HTTP audit (PRIMARY)

MODULE: users and permissions (C6).
FILE: desktop/src/api/administrative-http.ts, users.ts, permissions.ts.
CURRENT WRITE PATH: online API writes; previously asynchronous administrative
reads/writes lacked account/session fences around response/body publication.
WHY IT BYPASSES OFFLINE-FIRST: privileged administrative authority is intentionally
server-confirmed; it must never become a local grant or plaintext password outbox.
Own desktop permission reads previously could fall through to HTTP after local
read failure, obscuring the native authorization failure boundary.
RISK: a prior-account response could populate a new account's UI; local-only
credentials could attempt server administration; uncertain writes could be mistaken
for a local effect. These fences cannot undo a write already validly sent by its
original authenticated author before account change.
RECOMMENDED CHANGE: shared online-only, session-fenced administration; native-first
own permission snapshot, maintained by the separate auth refresh pipeline.
ACTUAL CHANGE MADE: added that shared request boundary, validated target replies,
removed native-error own-permission HTTP fallthrough, and left passwords nonqueued.
VERIFICATION: focused administration/auth/automation client batch 35 PASS,
TypeScript PASS. Follow-up server audit added transactional active actor/current permission and
credential checks under sorted actor/target locks in create, role/status, password
reset and granular permission replacement. Actual production-route PostgreSQL
probe PASS for mid-request disable/demotion/revocation denial, normal writes and
required-audit SQL failure rollback. Existing role/target policies remain.
STATUS: PARTIAL. Managed-user/target-profile offline caches, administrative CAS,
uncertain-result handling and server transactional authority/audit acceptance still
need closure; do not treat this as completion of C6 or new offline authority. The bounded server authority race is fixed;
administrative compare-and-set/idempotency and deployed GUI acceptance remain.

## 2026-11-02 — C3/C5 audit and contracts (PRIMARY)

MODULE: automation (C5).
FILE: desktop/src/api/automation.ts; desktop/src-tauri/src/local_automation.rs;
backend/src/routes/automation.js; backend/src/automation-run.js; shared sync handlers.
CURRENT WRITE PATH: before this batch desktop invoked POST /automation/run directly;
server used separate existence checks/inserts without one audit/receipt transaction.
WHY IT BYPASSES OFFLINE-FIRST: no durable desktop run intent or uncertain-result
reconciliation existed in this actual module. Server-only due reads failed offline.
RISK: lost requests, ambiguous execution, simultaneous duplicate reminders and
restricted task text delivered to recipients without checking project visibility.
RECOMMENDED CHANGE: SQLite authored intention -> outbox -> one permissioned,
idempotent server domain -> atomic confirmed receipt/ACK; cached local due projection.
ACTUAL CHANGE MADE: implemented that path for reminder runs; shared HTTP/outbox
server application locks current authority and serializes all reminder producers.
New runs dedupe both canonical date and existing legacy reminder keys. Only authorized
active recipients receive restricted-project task reminders. Run intent uses a UUID;
unknown network outcome retries the same original request. The server computes due
work when execution actually occurs; queuing never claims reminders were created.
VERIFICATION: selected client and native file-backed SQLite tests PASS; production
HTTP/outbox on actual isolated PostgreSQL PASS with audit/receipt SQL fault injection,
replay, legacy deduplication and private-recipient filtering; fixtures rolled back.
A further production HTTP test verified two overlapping actual PostgreSQL
transactions: both waited on the reminder lock; only one created the reminder
set, while both recorded their own receipts/audits. Committed test fixtures and
run-tagged reminder effects were explicitly cleaned from the acceptance copy.
STATUS: source and database concurrency verified; coordinated deployed
stopped-API desktop/reconnect acceptance open. Native commands need updated build.

MODULE: audio focus (C3).
FILE: resourceMediaFocus.ts, focusedSpeech.ts, voiceCapture.ts, musicTransport.ts,
ResourceViewerModal.tsx, NotebookPage.tsx, AssistantChat.tsx and App.tsx.
CURRENT WRITE PATH: device playback intent only; no domain/outbox/server mutation.
WHY IT BYPASSES OFFLINE-FIRST: not a business-write gap; actual viewer media bypassed
the existing shared audio coordinator and TTS completion read a mutable newer token.
RISK: competing playback, stale cancellation, accidental automatic restart and
cumulative dictation text duplicated or appended into a different note.
RECOMMENDED CHANGE: per-instance scoped owners with priority and generation fences;
differentiate manual from automatic pauses and stop old account/note capture.
ACTUAL CHANGE MADE: wired native media controls and scoped speech/dictation into
one device coordinator; explicit equal-priority playback wins, microphone preempts
speech, stale callbacks cannot stop newer owners, media time/volume are untouched.
VERIFICATION: 29 focused audio/music/dictation tests PASS; TypeScript and preceding
audio frontend build PASS. These are simulated media lifecycle checks, not audible
or microphone hardware verification.
STATUS: PARTIAL; embedded YouTube/provider control and real Tauri/audio transitions
remain. Browser dictation availability is feature-detected, not claimed offline
speech recognition. C4 consented server transcription remains a separate boundary.

## 2026-11-02 — project deletion evidence and canvas write contract

Project deletion uses one shared HTTP/native-sync effect inside the caller's
transaction, alongside required audit and retry receipt. sync_tombstones retains
project UUID scope without a project foreign-key cascade. The additive audience
table captures active readers at deletion; current projects.view is still required
on pull. Deleted private scopes are returned to that audience or current admins,
not every authenticated user. This grants deletion UUIDs only, never access to
live records or historical contents. Already-lost historical markers are not
invented. New migration is applied to the isolated acceptance database only.

Canvas blocks/connectors and canonical requirements use the same reviewed-base,
current-authority, atomic audit/receipt contract as task/experiment/BOM work.
Media endpoints require readable resources and ancestors in the same project or
permitted global context. Invalid geometry, cross-project endpoints and linked
requirement deletion are rejected. Requirement references do not create extra
demand or physical movements. Legacy immutable unversioned events retain their
compatibility and weaker concurrency guarantees. Expected snapshots compare
current fields; they are not a monotonic revision/ABA guarantee.

## 2026-11-01 — project access management and reconciliation

V2 source implementation; PostgreSQL/runtime acceptance and coordinated API/client
deployment are pending. Project membership and restricted-project grants are
server-confirmed administrative actions in both desktop and browser. They never
grant effective authority merely by persisting a local intention.

Membership requires a current active administrator with projects.edit. Grant
management preserves the owner/lead/admin policy with projects.edit and a currently
restricted project. The server locks the project and relevant actor/override/target
rows inside the write transaction. A request carries Idempotency-Key plus
expected_value: null for a missing entry, otherwise the reviewed member role or
grant level. This is compare-and-set of the current value, not a claim of a full
revision timeline or detection of every intermediate ABA change.

Mutation, required audit and sync_idempotency receipt commit together. Replay
rechecks current managerial authority and validates actor, project, operation,
target and payload. It acknowledges the original outcome without restoring an
old grant or deleting a newer membership. DELETE returns 204 publicly and stores
an explicit non-null JSON deletion acknowledgement in the receipt. Set operations
require an active target; removal may clean up access for an inactive user.

The client persists per-account retry keys and original bodies in tab session
storage before HTTP; uncertain results and refreshed displayed values reuse the
original request. Closing/clearing the tab can lose that retry storage; this is
not a durable administrative outbox. Local-only login cannot issue these writes.
Administrative reads and confirmations are fenced to the captured account.

On desktop, server confirmation is followed by a full authorized project pull
through the existing native merge, serialized with background synchronization.
The key is forgotten only after local reconciliation succeeds. A refresh failure
reports server-confirmed/local-refresh-pending and preserves retry identity.
Malformed/incomplete project snapshots do not become empty authoritative caches.

A pending project edit preserves authored root fields and its immutable outbox
payload, but it no longer freezes server permissions, membership, owner or
visibility. Removed/deleted scope forces no-access and restricted visibility while
retaining pending work in account-scoped storage for recovery. Later authorized
snapshots can restore visibility to that retained work. These pulls do not renew
offline login leases, acknowledge authored mutations or grant optimistic access.

## 2026-11-01 — damaged custody return repair contract

Implemented in V2 source; database/native/desktop acceptance and coordinated
deployment remain required. Additive migration:
backend/src/migrations/20261101_salvage_custody_repair.sql.

| Stage | Custody balance | Storeroom stock | Recovery state |
| --- | --- | --- | --- |
| Proposed damaged return | Unchanged | Unchanged | Quarantined, awaiting inspection |
| Approved damaged intake | Settled as damage for the received quantity | Unchanged | Back in quarantine with repair_received_at |
| Repair verification | Already settled; not settled again | Unchanged | Fresh usable-condition inspection with explicit repair notes |
| Explicit repaired-stock release | Unchanged | Original item credited once | Released, repair_completed_at recorded |

Damage settlement preserves the physical return's source custody, project, unit,
quantity and serial provenance. Repair intake does not create a duplicate asset
or refund expenses. Partial intake settles only that quantity. The quarantined
recovery remains the record of the damaged physical material until it can pass
inspection; it is not available inventory. Rejected/unrepaired material cannot
be released into usable stock.

The repaired return must reference its matching recorded damage settlement and
a database inspection timestamp later than intake, with repair_verification_notes.
The original item must still be usable and units must match. It receives a new
stock movement, not another custody settlement. The recovery lock and immutable
outer receipt prevent duplicate intake or repair credit. Domain effects, required
audit and receipt roll back together. Source costs, consumption history and
reviewed recovery valuation remain separate; no cash transaction is inferred.

Desktop uses the existing inspect/release native outbox operations. Browser uses
the same server apply functions with stable HTTP retry identity. Both carry the
version reviewed by the human. The UI distinguishes repair intake, repair
quarantine, repair-verification notes and final stock release. Deploy the
additive migration, API and coordinated desktop together before accepting this
workflow for actual use.

Consolidated: 2026-11-01. These contracts and runbooks preserve their original
scope and implementation caveats. [The plan](PLAN.md) controls current delivery;
[the work log](WORK_LOG.md) records what was actually checked and shipped.
No command in a historical runbook grants permission to reset current user data.
Resolve conflicting historical wording using the latest explicit owner decision
and dated evidence; do not silently treat a proposal as an approved contract.

## Source index
- [undated — Server credential revocation (Phase 2 slice)](#source-docsarchitecturecredential-revocation)
- [undated — Daily-use preference ownership contract (approved hybrid)](#source-docsarchitecturedaily-use-preferences)
- [undated — Native authorization exchange](#source-docsarchitecturenative-authorization)
- [undated — Offline DOCX runtime contract](#source-docsarchitectureoffline-docx-runtime)
- [undated — LabOS Offline-First Database Architecture](#source-docsarchitectureoffline-first-database)
- [undated — LabOS shared synchronization contract](#source-docsarchitectureoffline-sync-contract)
- [undated — Resource binary replication — Phase 2](#source-docsarchitectureresource-binary-replication)
- [undated — LabOS desktop write-path audit](#source-docsauditsoffline_first_write_path_audit)
- [undated — Phase 1 mutation source index — 2026-10-03](#source-docsauditsphase1_mutation_source_index)
- [undated — Lab pilot backup/restore readiness](#source-docsauditsv1_backup_restore_runbook)
- [undated — Clean personal V1 setup — 2026-10-26](#source-docsauditsv1_clean_personal_setup)
- [undated — V1 controlled lab pilot — approved October 24, 2026](#source-docsauditsv1_lab_pilot_release)
- [undated — Desktop frontend freshness](#source-docsdesktop_frontend_build)
- [undated — LabOS Local Backend Capability Matrix](#source-docslocal-backend-capabilities)
- [undated — LabOS Development Guide](#source-development)
- [undated — LabOS Release Process](#source-release)
- [undated — Desktop client — not built yet](#source-desktopreadme)
- [undated — LabOS v2.2 — Deployment & Operations](#source-deployreadme)

---

<a id="source-docsarchitecturecredential-revocation"></a>
## Server credential revocation (Phase 2 slice)

Original source: `docs/architecture/credential-revocation.md`. Retained historical scope/status.

<a id="source-docsarchitecturecredential-revocation--server-credential-revocation-phase-2-slice"></a>
### Server credential revocation (Phase 2 slice)

Server-authoritative credential changes are intentionally online-only; passwords
must never enter the offline outbox. This slice does not change SQLite leases or
make renderer-supplied permission caches trustworthy.

<a id="source-docsarchitecturecredential-revocation--contract"></a>
#### Contract

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

<a id="source-docsarchitecturecredential-revocation--observed-revocation-bridge-october-10-implementation"></a>
#### Observed revocation bridge (October 10 implementation)

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

<a id="source-docsarchitecturecredential-revocation--later-october-10-native-verification-follow-up"></a>
#### Later October 10 native-verification follow-up

The native authenticated exchange in `native-authorization.md` replaces the
renderer-asserted positive claims described above. Login generation guards,
persistent cached-password throttling and conservative clock-rollback lease
invalidation are implemented and tested. These do not encrypt the cache or migrate
renderer token storage. Earlier sections describe their dated implementation slice;
refer to the latest PHASE2_EVIDENCE.md for runtime/outage acceptance boundaries.

<a id="source-docsarchitecturecredential-revocation--still-open"></a>
#### Still open

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

---

<a id="source-docsarchitecturedaily-use-preferences"></a>
## Daily-use preference ownership contract (approved hybrid)

Original source: `docs/architecture/daily-use-preferences.md`. Retained historical scope/status.

<a id="source-docsarchitecturedaily-use-preferences--daily-use-preference-ownership-contract-approved-hybrid"></a>
### Daily-use preference ownership contract (approved hybrid)

Decision: `notifications_enabled` is a per-account preference. `auto_pause_music`
and `music_volume` are per-device preferences. This is the owner's choice for
the three fields currently exposed by Daily Use; it does not imply that other
assistant, notification-read, or media settings share this contract.

<a id="source-docsarchitecturedaily-use-preferences--current-state-and-migration-boundary"></a>
#### Current state and migration boundary

- Implemented in Phase 2: Tauri notification changes commit account-scoped
  SQLite state and an immutable outbox event atomically. Music values remain
  installation/account-local. Browser notification PATCH uses the same server
  apply/version rules; browser music values use account-scoped localStorage.
- Populated SQLite music values and PostgreSQL legacy media columns are
  retained. Browser migration is an explicit import and refuses to overwrite
  existing device values. Pending notifications are labelled pending, not synced.
- A PostgreSQL BEFORE INSERT notification gate suppresses new delivery when
  disabled or the account is inactive. Historical notifications remain intact.
  Automation counts only notifications actually inserted.
- Real PostgreSQL probing exposed and fixed a UUID/text parameter inference
  error in browser PATCH (2026-10-08). Automated disk-client, browser API and
  database evidence is tracked in `../audits/PHASE2_EVIDENCE.md`. Running two
  GUI clients and checking controls visually is still Phase 3 acceptance work.

<a id="source-docsarchitecturedaily-use-preferences--per-account-notification-preference"></a>
#### Per-account notification preference

1. PostgreSQL is authoritative for each authenticated `user_id`. The browser
   and desktop present the same value when online.
2. A Tauri change commits its account-scoped local value **and** an outbox
   event in one SQLite transaction. The event has a stable `change_id`, user
   ownership, a desired boolean value, and the last known server version.
3. Server apply is idempotent by `change_id` and compare-and-swaps the version.
   A different value at a newer version is a visible conflict; an old offline
   edit must not silently overwrite a newer setting from another device.
4. Pull returns the current value and version for the authenticated account.
   A pending local event is not overwritten by pull. On acknowledgement, the
   server value replaces local state; on conflict, the UI offers retry with
   current value or discard of the local intent.
5. Browser PATCH uses the same version/conflict rule and an idempotency key.
   Disabled or unauthenticated accounts cannot read or mutate preferences.

<a id="source-docsarchitecturedaily-use-preferences--per-device-media-preferences"></a>
#### Per-device media preferences

- Tauri keeps `auto_pause_music` and `music_volume` in account-scoped SQLite
  on that installation. These writes are deliberately **not** outbox events.
- Browser mode keeps them in account-scoped browser storage. A one-time,
  explicit compatibility import may seed that browser's local value from its
  existing PostgreSQL row; it must not overwrite an existing local setting.
- Both runtimes validate booleans and `music_volume` in `[0, 1]`. The setting
  applies immediately on the current device and stays different across
  devices by design. The UI should say so.
- The existing PostgreSQL music columns remain readable in backup/export
  during transition; removal requires a later migration and verification.

<a id="source-docsarchitecturedaily-use-preferences--verification-required-before-phase-2-sign-off"></a>
#### Verification required before Phase 2 sign-off

- Two desktop clients and a browser on the existing PostgreSQL service:
  offline notification edit, reconnect, same-change replay, concurrent edit
  conflict, account switch, disabled account, and server restart.
- Different music volume and auto-pause on two devices for the same account;
  changing either device leaves the other unchanged and survives restart.
- Fresh account defaults and upgrade from populated SQLite/PostgreSQL rows,
  with no loss or cross-account transfer of historical values.

---

<a id="source-docsarchitecturenative-authorization"></a>
## Native authorization exchange

Original source: `docs/architecture/native-authorization.md`. Retained historical scope/status.

<a id="source-docsarchitecturenative-authorization--native-authorization-exchange"></a>
### Native authorization exchange

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

<a id="source-docsarchitecturenative-authorization--local-password-and-clock-safeguards"></a>
#### Local password and clock safeguards

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

---

<a id="source-docsarchitectureoffline-docx-runtime"></a>
## Offline DOCX runtime contract

Original source: `docs/architecture/offline-docx-runtime.md`. Retained historical scope/status.

<a id="source-docsarchitectureoffline-docx-runtime--offline-docx-runtime-contract"></a>
### Offline DOCX runtime contract

Owner decision, October 13: bundle an isolated converter rather than reduce DOCX
editing to plain text. Users must not install Node or use a server for conversion.
This is an implementation contract, not a claim that offline DOCX is finished.

<a id="source-docsarchitectureoffline-docx-runtime--existing-foundation"></a>
#### Existing foundation

- Shared conversion worker can render DOCX to constrained HTML or generate DOCX
  from that HTML. The current API uses this worker for both directions.
- Two concurrent workers, no unbounded wait queue, 15-second timeout, 128 MiB V8
  heap setting, 16 MiB DOCX input/output and 4 MiB HTML limits. These are application
  bounds, not an OS sandbox or a guarantee on total process RSS/native allocations.
- Input/output markup uses the same allowlist. External image reads are disabled,
  active links/attributes removed, and embedded images validated. Child processes
  do not inherit database credentials, auth tokens or NODE_OPTIONS from the API.
- Disk reads are size-bounded before conversion; at most two file readers. The
  API rechecks resource edit authority after conversion before returning HTML.
- `desktop/scripts/package-docx-runtime.mjs` generates a separate development
  bundle from the installed converter dependency closure and the build machine's
  Node binary. It checks installed package versions against package-lock, retains
  package assets/licenses, rejects dependency symlinks, inventories file hashes,
  and never copies backend configuration/database/storage. Older bundles are not
  overwritten. This is not yet a signed release or automatic installer integration.

<a id="source-docsarchitectureoffline-docx-runtime--native-implementation-checkpoint-october-13"></a>
#### Native implementation checkpoint (October 13)

Desktop DOCX preview and Save as Copy now select native commands, without an API
fallback. The existing browser routes remain server-backed. `local_docx.rs`
resolves the pinned package, verifies its manifest/files, authorizes the account,
session, lease, resource edit scope and revision, and rechecks after conversion.
The native worker uses a single binary stdin/stdout frame and receives no paths
or credentials. Windows adds a kill-on-close job, one-process limit and 384 MiB
process-memory cap; conversion has a 20-second deadline, 128 MiB V8 heap, two
concurrent slots, 16 MiB DOCX and 4 MiB HTML limits. This is process containment,
not an OS filesystem/network sandbox or a complete hostile-document guarantee.

Generated copies are immutable managed PC files. The resource row, upload
descriptor, outbox event and request-to-copy mapping commit in one transaction.
The editor retains a request UUID across retries of the same source/revision/HTML;
native replay returns the existing authorized copy, rejecting changed payloads
and deleted copies. Server `create_copy` validation now supports explicit DOCX
format while preserving existing PDF events and receipt semantics.

October 13 source implementation permits copies of pending native uploads,
copies and content edits: `copy.previous_change_id` resolves the source revision
through a same-author/device/resource server receipt. Current edit authority,
scope and revision checks still apply. Conflicted predecessors block descendants;
explicit discard retires dependent intents but preserves authored bytes. This
follow-up is not yet deployed or accepted in a real offline/reconnect run.

Boundaries still open: pending metadata/attachment changes must synchronize before
a copy can be created; broader record-level edit grants are not fully cached;
reopening the editor starts a new save intent. Saved original bytes remain intact,
but unsaved editor content is not a crash-recovery draft. Word features outside
the supported HTML editor subset may not survive conversion. Release packaging
provenance/signing/notices and actual offline/reconnect acceptance are not closed.

<a id="source-docsarchitectureoffline-docx-runtime--implementation-contract-and-remaining-verification"></a>
#### Implementation contract and remaining verification

1. Resolve only the packaged runtime under the application's resource directory;
   do not search PATH, accept renderer executable paths or fall back to host Node.
   Pin the approved runtime/dependency bundle, retain distribution notices and
   verify reproducible release hashes/signatures during packaging.
2. Native commands authorize the active account, session, unexpired lease and
   resource edit scope. Read the actual managed PC file with a captured revision;
   metadata or server-only bytes are not sufficient for offline opening.
3. Use a bounded framed/stdin-stdout worker protocol. Do not supply renderer paths,
   credentials or unrestricted environment variables. Apply concurrency, timeout,
   input/output limits and process-tree termination on failure. Reauthorize after
   conversion; desktop worker isolation requires platform-specific hardening and
   must not be described as sandboxed before that is verified.
4. For Save as Copy, generate stable resource/change UUIDs once, preserve source
   visibility/attachment/provenance, and fsync/hash an immutable generated DOCX.
   Publish the local row, source revision and resumable upload descriptor plus
   outbox event in one SQLite transaction. No direct API copy/write fallback.
   Extend the existing derived-copy server validator intentionally for DOCX.
   Server publication rechecks current source authority and
   receipt identity. Original bytes are never overwritten.
5. Cancellation/failure retains the original and unsaved editor content. Recovery
   files must remain account-scoped; no cleanup of authored versions without the
   agreed retention/recovery contract. No auto-retry with a different change ID.

<a id="source-docsarchitectureoffline-docx-runtime--acceptance"></a>
#### Acceptance

Run the packaged runtime from outside the repository with no host Node dependency.
Test real offline opening/edit/copy/save, restart, queued transfer and reconnect
against existing PostgreSQL. Include formatting, embedded images, unsupported
features, corrupt ZIP/XML, high compression, external relationships, unsafe links,
hang/crash, disk-full, permission/lease expiry, account switching, conflict,
replay/lost acknowledgement and unchanged original. Collect independent failures
in the phase-end sweep before grouped correction/retest. A worker-only smoke test
is not native desktop or database acceptance.

---

<a id="source-docsarchitectureoffline-first-database"></a>
## LabOS Offline-First Database Architecture

Original source: `docs/architecture/offline-first-database.md`. Retained historical scope/status.

<a id="source-docsarchitectureoffline-first-database--labos-offline-first-database-architecture"></a>
### LabOS Offline-First Database Architecture

<a id="source-docsarchitectureoffline-first-database--status"></a>
#### Status

Architecture foundation and the first local inventory repository boundary are established on `main`.

The target architecture is:

```text
                 CENTRAL SERVER
        LabOS Backend + PostgreSQL
                       ▲
                       │ Sync/API
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      PC A           PC B           PC C
     SQLite          SQLite         SQLite
      LabOS           LabOS          LabOS
```

Each desktop installation must remain usable without internet access. PostgreSQL is the shared central database; SQLite is the local working database for each desktop installation.

<a id="source-docsarchitectureoffline-first-database--current-state"></a>
#### Current state

The existing backend is PostgreSQL-specific. `backend/src/db.js` creates a `pg.Pool`, and the API routes query PostgreSQL directly. The existing migration history also contains PostgreSQL-specific features such as UUID generation, `TIMESTAMPTZ`, arrays, JSONB, GIN indexes, views, PL/pgSQL functions and triggers.

The desktop now has a local SQLite foundation and a first local inventory repository. Application-wide migration to SQLite is **not** complete yet.

<a id="source-docsarchitectureoffline-first-database--local-sqlite-responsibilities"></a>
#### Local SQLite responsibilities

SQLite will become the desktop application's working store for data that the user needs while offline.

<a id="source-docsarchitectureoffline-first-database--local-first-data"></a>
##### Local-first data

- inventory items and inventory metadata
- inventory movements
- maintenance records
- purchases and purchase batches/lines
- project data
- project tasks and experiments
- project item allocations
- notes and note revisions
- resources and resource metadata
- resource versions/attachments metadata
- knowledge/discovery data
- local activity/history needed by the user
- locally generated reports and derived values

<a id="source-docsarchitectureoffline-first-database--local-sync-infrastructure"></a>
##### Local sync infrastructure

Every desktop database contains:

- `device_identity` — stable identifier for the installation
- `sync_state` — synchronization cursors/state
- `sync_outbox` — durable local operations waiting to reach the server
- `local_schema_migrations` — SQLite-specific schema versioning

The outbox is deliberately introduced before full synchronization. Local writes will eventually commit the business change and its corresponding outbox record in the same SQLite transaction.

<a id="source-docsarchitectureoffline-first-database--postgresql-responsibilities"></a>
#### PostgreSQL responsibilities

The central PostgreSQL database remains authoritative for shared/server state:

- users and authentication state
- roles and permission definitions
- server-side authorization policy
- centrally synchronized laboratory data
- cross-device history
- central audit trail
- global configuration
- server-side derived/reporting views where useful

User/permission state may be cached locally so the desktop can continue operating offline, but changes to authorization policy originate from the server and are synchronized to clients.

<a id="source-docsarchitectureoffline-first-database--synchronization-model"></a>
#### Synchronization model

Do not synchronize mutable totals as the primary operation where possible.

For example, an inventory action should be represented as an operation such as:

```text
change_id
 device_id
 entity_type = inventory_movement
 entity_id
 operation = create
 payload = movement details
 created_at
```

The server can then apply the operation idempotently and derive/update the shared inventory state.

This is safer than sending:

```text
current_quantity = 117
```

because two offline devices can otherwise overwrite each other's work.

Every synchronization operation therefore needs a stable idempotency key (`change_id`). Retrying the same operation after a network failure must not duplicate the business action.

<a id="source-docsarchitectureoffline-first-database--inventory-local-repository-foundation"></a>
#### Inventory local repository foundation

The desktop now has a SQLite-specific inventory module at `desktop/src-tauri/src/local_inventory.rs`.

It provides:

- a local inventory item table
- a local append-oriented movement table
- local inventory listing
- controlled item upsert for hydration/bootstrap
- atomic inventory quantity adjustment
- movement recording in the same transaction as the quantity update
- a durable `sync_outbox` record in that same transaction
- stable `change_id` and movement identifiers generated locally
- validation preventing zero adjustments and negative resulting quantities

The important transaction boundary is:

```text
SQLite transaction
  ├─ update local quantity
  ├─ append inventory movement
  └─ enqueue sync operation
       ↓
     COMMIT
```

If the transaction fails, none of those three effects should be committed.

`current_quantity` is retained as a local working value for fast reads, while movement operations are the synchronization facts. The future server sync layer should transmit the movement operation rather than treating a local quantity snapshot as the business operation.

<a id="source-docsarchitectureoffline-first-database--excel-workflows"></a>
#### Excel workflows

Excel import/export remains a first-class feature.

Imports must be capable of completing offline:

```text
Excel file
   ↓
local parse + validation
   ↓
preview
   ↓
SQLite transaction
   ↓
business records + sync outbox
   ↓
server synchronization when online
```

A failed internet connection must not invalidate a successfully validated local import.

<a id="source-docsarchitectureoffline-first-database--data-categories"></a>
#### Data categories

| Area | Local SQLite | Central PostgreSQL | Sync model |
|---|---|---|---|
| Inventory | Yes | Yes | Operations/events |
| Stock movements | Yes | Yes | Append-oriented operations |
| Purchases | Yes | Yes | Transaction/batch operations |
| Finance transactions | Yes | Yes | Ledger operations |
| Projects | Yes | Yes | Entity changes + membership |
| Tasks/experiments | Yes | Yes | Entity changes |
| Notes | Yes | Yes | Versioned/entity changes |
| Resources | Yes | Yes | Entity + metadata/version operations |
| Knowledge | Yes | Yes | Entity changes; local search index |
| Users | Cached | Authoritative | Server → client |
| Roles/permissions | Cached snapshot | Authoritative | Server → client |
| Audit trail | Local pending events | Authoritative central record | Append-only sync |
| Reports | Derived locally | Derived centrally where needed | Usually no direct sync |
| Search indexes | Local | Central | Rebuildable/derived |

<a id="source-docsarchitectureoffline-first-database--sqlite-specific-design"></a>
#### SQLite-specific design

The desktop SQLite database uses WAL mode for local concurrency and crash-safe transactional behavior. SQLite supports foreign keys and full-text search through FTS5, so the local implementation does not need to abandon relational integrity or search functionality.

The local schema should be designed independently from PostgreSQL-specific DDL. Do **not** attempt to execute the existing PostgreSQL migration files against SQLite.

Instead:

```text
PostgreSQL migrations          SQLite migrations
        │                              │
        ▼                              ▼
central schema                  local schema
        │                              │
        └──────── shared logical model ┘
```

The logical entities remain aligned, while engine-specific DDL is allowed to differ.

<a id="source-docsarchitectureoffline-first-database--postgresql-specific-features-that-require-deliberate-mapping"></a>
#### PostgreSQL-specific features that require deliberate mapping

The current migration history includes features that cannot simply be copied into SQLite:

- `UUID` + `gen_random_uuid()`
- `TIMESTAMPTZ`
- PostgreSQL arrays such as `TEXT[]`
- `JSONB`
- GIN indexes
- `TSVECTOR` / `to_tsvector`
- PL/pgSQL functions
- PostgreSQL triggers
- PostgreSQL views and casts
- PostgreSQL-specific locking/query syntax

For SQLite, use portable logical representations where appropriate:

- UUIDs stored as canonical text values
- ISO-8601 timestamps stored as text
- JSON stored as JSON text
- tags stored as normalized child rows or JSON where justified
- FTS5 for local full-text search
- application-level timestamp/update handling where a trigger is unnecessary
- portable SQL for repository queries

<a id="source-docsarchitectureoffline-first-database--repositorydata-layer-rule"></a>
#### Repository/data-layer rule

The React UI must not know whether data comes from SQLite or PostgreSQL.

The intended boundary is:

```text
UI
 ↓
LabOS data/repository API
 ↓
local SQLite adapter
 ↓
sync engine
 ↓
LabOS backend API
 ↓
PostgreSQL adapter
```

The desktop should therefore stop growing direct assumptions about PostgreSQL response formats and SQL behavior.

<a id="source-docsarchitectureoffline-first-database--implementation-sequence"></a>
#### Implementation sequence

1. Keep the existing PostgreSQL backend working.
2. Introduce the local SQLite database foundation. **Done.**
3. Define the canonical logical entity/operation contracts. **Inventory operation boundary started.**
4. Build SQLite migrations for the local working schema. **Inventory local schema foundation started.**
5. Move inventory first because it is the clearest offline-first workload. **Repository foundation started; UI migration remains.**
6. Add purchases and Excel imports.
7. Add projects/notes/resources/knowledge.
8. Add the durable sync engine and server idempotency handling.
9. Add central-to-local synchronization for shared changes.
10. Remove unnecessary desktop dependence on the local HTTP PostgreSQL-backed API.
11. Keep PostgreSQL as the central shared database.

<a id="source-docsarchitectureoffline-first-database--non-goals"></a>
#### Non-goals

This architecture change does **not** mean:

- replacing PostgreSQL with SQLite on the server
- running PostgreSQL on every user's PC
- copying the entire PostgreSQL database file to each PC
- making the desktop directly connect to PostgreSQL
- implementing conflict resolution before the operation model exists
- duplicating business logic into unrelated local and server implementations

The goal is one LabOS application with a local transactional working copy and a durable synchronization boundary.

---

<a id="source-docsarchitectureoffline-sync-contract"></a>
## LabOS shared synchronization contract

Original source: `docs/architecture/offline-sync-contract.md`. Retained historical scope/status.

<a id="source-docsarchitectureoffline-sync-contract--labos-shared-synchronization-contract"></a>
### LabOS shared synchronization contract

Phase 1 contract, 2026-10-03. Implementation status is in the audit and evidence ledger; this document does not imply every Phase 2 module already conforms.

<a id="source-docsarchitectureoffline-sync-contract--identity-ownership-and-atomicity"></a>
#### Identity, ownership and atomicity

- PostgreSQL is the shared laboratory authority. SQLite is an account-scoped local working copy, not another independent laboratory.
- Generate an entity UUID once, before the first local commit. Canonical representation is lowercase hyphenated UUID. Normalize legacy compact forms at boundaries; do not regenerate IDs when pulling or retrying. Existing compact change IDs remain opaque, valid retry identities until acknowledged.
- Generate one change ID per immutable intent. Retries retain the exact key and payload. An explicit conflict overwrite is a new intent and gets a new key; its predecessor remains resolved for traceability. New-key reuse of an existing entity UUID is a collision, not success.
- Commit business state and its outbox event in one SQLite transaction. If either fails, roll back both and surface the error. No desktop HTTP-write fallback on unavailable SQLite, rejected IPC or null return. A Rust unit-returning delete may return null after success; it is not permission to issue a second server delete.
- Stamp the active central account onto the outbox in SQLite, rather than trusting a caller-supplied author. The server derives the author from its authenticated active account, never from a submitted author ID. Switching accounts must not relabel, transmit or acknowledge another account's pending changes.
- Server mutation, idempotency receipt and required delete tombstone must commit atomically. Required financial/administrative audit events belong in that transaction. Older direct routes whose audit/tombstone writes remain separate are a Phase 2 transaction-hardening item, not a model to copy.

<a id="source-docsarchitectureoffline-sync-contract--authorization-and-offline-leases"></a>
#### Authorization and offline leases

- Ordinary lab read domains are available to active authenticated accounts. Record scope still applies: child visibility cannot broaden its parent project's visibility. A restricted grant is not a substitute for a domain mutation capability or project edit authority.
- Finance read and sensitive-finance read are separate capabilities; sensitive access requires both. User and audit permissions remain separate. Authorize the existing stored row before accepting any submitted destination/relationship changes.
- Privileged offline access lasts at most 24 hours after successful password authentication with the server. This includes admins and accounts delegated user administration, audit or sensitive-finance/import capabilities. Ordinary accounts retain the existing seven-day lease.
- A permission refresh may shorten a lease but cannot renew it, change its authentication timestamp or extend it after a downgrade. Malformed/missing authentication provenance fails closed. On expiry, stop authorized operations without erasing the account's work. Reauthenticate online to renew.
- Server revocation takes effect on the next authenticated request. Offline revocation cannot be instantaneous on a disconnected device; the lease is the bound, not a claim of immediate remote deletion.

<a id="source-docsarchitectureoffline-sync-contract--replay-conflicts-and-deletion"></a>
#### Replay, conflicts and deletion

- Lost acknowledgement: retry the original event. Already committed requests acknowledge success without replaying a stale record snapshot that could now be unauthorized.
- Permission, validation and version conflicts are not all transport errors. Keep the author's intent and show recovery; do not silently change role grants, reassign authors or replace UUIDs to force acceptance.
- Conflict listing uses the event's domain. If the current account no longer has permission to see the payload, expose only redacted recovery metadata. Retrying requires current domain write permission; explicit discard requires ownership, not renewed access to secret contents.
- Legacy inventory explicit keep-local overrides use a new change ID. New inventory protocol-2 edits reject automatic overwrite: refresh, review and reapply instead. Ordinary retries keep the original payload unchanged. Discarding an inventory conflict also discards connected pending edits, including shared bulk batches, after confirmation; unrelated items remain queued.
- New desktop inventory item/bulk/movement intents carry per-target integer versions and predecessor change IDs. PostgreSQL resolves predecessor outcomes only for the same author and device. Metadata, absolute stock adjustment, transfer and deletion require matching versions; additive stock deltas can combine. The item update trigger advances versions for all SQL writers, but legacy immutable events and imports are not thereby converted to version-checked/idempotent writes.
- Browser item CRUD, bulk, movement and storage endpoints share the inventory apply transaction and require captured versions plus stable retry keys. Per-account browser intents persist in tab session storage before HTTP; uncertain retries, including after refresh to a newer displayed version, reuse the original key/body/base. This is online-only retry recovery, not a durable browser outbox: closing/clearing session storage loses that recovery identity. Old callers missing keys/versions fail closed.
- Delete is an intent referencing the stable entity UUID. Replay must not duplicate effects. Server deletes emit tombstones; local revocation eviction is not an outbound delete.
- Finance and Location pulls are complete authorized snapshots, explicitly marked `snapshot_complete: true`. A client rejects an unmarked snapshot rather than treating a truncated/older response as authority to erase cache. Missing synchronized IDs are evicted even if their tombstones have aged beyond the latest 1,000. Pending authored intents are preserved.
- Notes, Resources, Projects, Knowledge and Engineering expose authorized ID sets. Preserve pending edits while reconciling authorized server rows. Inventory remains cursor-driven; any future tombstone retention/compaction must introduce a minimum cursor and full-resync protocol, never silently advance past unseen deletes.
- Pending work and currently readable cache are distinct concepts. Phase 2 must finish the recovery-only representation of pending records after row-level revocation across every local domain. Preservation does not mean unrestricted display or sync under a different user.

<a id="source-docsarchitectureoffline-sync-contract--remaining-domain-contracts"></a>
#### Remaining domain contracts

- Maintenance: add `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` plus update trigger in an idempotent migration, backfill existing rows, add stable ID/outbox CRUD and versioned apply, and return full scope or a correct cursor/tombstone feed. Test repeated migration and older-client handling on actual PostgreSQL before rollout.
- Binary resources: stage immutable bytes under a validated account/entity UUID path; persist checksum, size and upload intent locally before claiming success. Retry upload by stable asset ID/checksum. Commit metadata once; server job execution and thumbnail generation are separate effects. Editor copies get a new UUID, retain ancestry/visibility and establish creator grants atomically. Never replace a source file merely to represent a copy.
- Hybrid preferences: notifications follow the account; media volume and auto-pause follow the device. See `daily-use-preferences.md`. Device settings do not produce server events; account settings do.
- Identity, permission grants, project approvals/reservation coordination, AI generation and automation execution remain explicitly online-authoritative. Do not manufacture offline success for an operation the server must arbitrate. Phase 2 must add consistent online-only UX, idempotency and local refresh.
- Imports need a stable batch ID and row IDs, atomic local import/outbox, server replay protection and current stored-row permission checks. Preview is computation, not a committed import. A failed import must not leave success audit entries for rolled-back writes.

<a id="source-docsarchitectureoffline-sync-contract--inventory-import-and-history-implementation-2026-10-09"></a>
##### Inventory import and history implementation (2026-10-09)

- A reviewed workbook freezes explicit `create`/`update` rows, canonical entity
  UUIDs, the account, snapshot base, integer versions and one batch/change UUID.
  Generated IDs do not imply updates. Desktop commit merges workbook fields
  without dropping other item metadata, and writes one `item/import` protocol-2
  event in the same SQLite transaction. Repeated native commit with the same
  key/body is a no-op; key reuse with changed rows fails.
- PostgreSQL locks all targets in UUID order, checks import plus row-specific
  permissions and stock authority, and applies all rows/audit/history with one
  receipt or rolls the transaction back. The receipt's per-item outcomes can be
  predecessors of later local edits. Pending import targets participate in pull
  preservation and explicitly confirmed connected-chain discard.
- Browser inventory imports use the reviewed JSON plan, not a multipart write.
  An uncertain re-preview retains the original retry key, create IDs and bases
  while tab session storage survives. This is not a browser offline queue.
  Legacy queued payloads are not rewritten into the new protocol.
- Local inventory/history permission, parse and persistence errors propagate.
  History refresh merges server rows while preserving pending local movements;
  cached history is available offline/after transport or 5xx failure, but never
  used to hide a 401/403. An account-scoped cache marker distinguishes a downloaded
  empty history from history never downloaded. These are derived cache writes,
  not authored business changes, so no outbox event is appropriate.
- Initial empty inventory is valid only after the server explicitly returns a
  complete initial snapshot. An empty incremental page must not erase the cache.
  A first-ever offline installation cannot assume the shared inventory is empty:
  it must download once before editing. Native pending protection still applies
  to explicitly confirmed empty refreshes.

<a id="source-docsarchitectureoffline-sync-contract--legacy-data-decision"></a>
#### Legacy data decision

The owner explicitly chose to clear the existing installation's databases and seed new test data; that reset was executed on 2026-10-03. No unattributed legacy row needs to be assigned to a user in this installation. This does not authorize future automatic resets. Upgrade code must retain unattributed rows separately and never adopt them for the next person who logs in. Export/recovery UI remains Phase 2; it is not a prerequisite for testing this fresh installation.

<a id="source-docsarchitectureoffline-sync-contract--verification-boundaries"></a>
#### Verification boundaries

The real PostgreSQL probes and disk-backed two-client Notes test exercise the shared model. Full domain conversions, cross-domain failure/concurrency matrices and all-entity second-client runs remain Phase 2. Full GUI clients, installer upgrades, recovery/restore and owner acceptance remain Phase 3. A repository source index is not a substitute for those runtime checks.

---

<a id="source-docsarchitectureresource-binary-replication"></a>
## Resource binary replication — Phase 2

Original source: `docs/architecture/resource-binary-replication.md`. Retained historical scope/status.

<a id="source-docsarchitectureresource-binary-replication--resource-binary-replication-phase-2"></a>
### Resource binary replication — Phase 2

Status (2026-10-12): **server transfer foundation, desktop staging and initial
automatic server-to-PC worker implemented; live acceptance pending.** The guarded
reader now supports both authored files and verified derived PC copies.
Metadata/poster rows alone still do not prove originals exist offline.

<a id="source-docsarchitectureresource-binary-replication--october-12-native-pc-copy-worker"></a>
#### October 12 — native PC-copy worker

After an authorized metadata pull, a separate background coordinator rotates
through uploaded files and completed downloaded links. Each native invocation
verifies server-token identity against the active native account, uses the
compiled trusted API origin (no redirects or manifest-provided URL), fetches a
manifest and transfers at most one 4 MiB chunk. Up to eight rounds run per pass;
missing/busy sources wait for a later metadata pass. Outbox acknowledgements do
not wait for these copies.

SQLite stores account/resource/origin/content digest, metadata revision, verified
offset, state and errors. Chunk response revision/range/length/hash are checked;
bytes are fsynced before offset commit. Whole-file size/hash verification precedes
atomic rename into `resource-copies/<account>/<resource>/<sha256>.content`.
Restart recovery validates an existing complete file after an interrupted rename
or SQLite commit. Incomplete `.partial` files never enter the reader. A changed
manifest resets progress without mixing content versions. Existing corrupt final
files are preserved with an explicit recovery error, not silently overwritten.

The session-capability reader checks current account/lease/permission, current
metadata revision, known visibility denials and pending authored changes. New
authored upload files remain in their separate storage; this worker does not
delete or replace them. Resource cards expose verified PC availability, progress
and copy errors. Observed credential revocation uses the existing auth lock path.

Remaining: physical derived-copy reclamation on revocation/deletion, retention and
quota policy, protected/encrypted storage recovery, native scoped editor copies,
large-file seek compatibility, and end-to-end outage/interruption/two-account
acceptance. Logical access denial is implemented; physical byte erasure is NOT
claimed. The current reader still conservatively invalidates a metadata revision
until a successful manifest refresh, even when its content hash is unchanged.

<a id="source-docsarchitectureresource-binary-replication--desktop-authored-uploads-october-11-continuation"></a>
#### Desktop-authored uploads — October 11 continuation

Single-file desktop uploads copy bytes to managed
`resource-files/<account UUID>/<change UUID>/content` in the app data directory,
not backend/storage. Native chunks recheck account/session/lease/permission. The
file is fsynced and size/SHA-256 verified before one SQLite transaction publishes
metadata plus the authored outbox event. Native failure never falls back to HTTP.

Sync resumes 1 MiB server chunks with stable resource/change IDs. Server staging
validates offsets and repeated bytes; publication verifies the final hash. Resource
creation, audit entry and existing idempotency receipt share the sync transaction.
Uncertain outcomes retain files and pending work. The new resource_upload_staging
migration was initially blocked by Docker. After the Windows restart on October
11, the updated API was deployed and the migration verified in actual PostgreSQL;
API/database/storage health passed. Functional offline/reconnect acceptance remains
pending.

Local URLs are session-bound capabilities, not filesystem paths. Each read checks
current authority, record existence and known revocation. Dot-separated capability
paths accommodate Windows Tauri URL encoding. After acknowledgement the reader
conservatively requires the recorded metadata revision, so later metadata edits
can invalidate access until revision reconciliation is implemented.

Folder selections now use the same native staging, with one SQLite finalization
transaction for up to 200 children. Nested relative paths are metadata only and
are validated before staging and on native/server boundaries. Selection/local
path collisions are rejected; server sync creates serialize same-path checks.
The parent folder is a separate create and can remain empty after failure. Each
child has its own server receipt; server-side publication is not folder-atomic.
Desktop folder manifests read SQLite rather than HTTP. Live acceptance is pending.

Remaining boundaries: editor copies, live acceptance of server-file replication,
offline video-poster extraction and native scoped note/folder grants. Non-admin
note/folder attachments currently fail closed. The reader supports bounded forward
ranges, not suffix ranges; non-range reads above 32 MiB are rejected. WebView and
large-file compatibility, quotas, interrupted staging recovery, physical retention
and recoverable encryption remain open. Authored files are preserved, not purged.
No live desktop/offline/reconnect acceptance is claimed for this implementation.

<a id="source-docsarchitectureresource-binary-replication--implemented-server-contract"></a>
#### Implemented server contract

These are authenticated read endpoints under the existing resources.view gate.
They additionally check current account activation, credential version, current
role/permission, resource visibility and ancestor access before file IO and again
before delivery. Only session Bearer authentication is supported: query-string
tokens and download-purpose tokens do not authorize these new endpoints.

`GET /api/resources/:id/binary-manifest` returns:

```json
{
  "protocol": 1,
  "resource_id": "94f02f5c-16e6-4d45-8973-f2d72c4895a1",
  "kind": "uploaded-file",
  "filename": "example.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 123456,
  "sha256": "<64 lowercase hex characters>",
  "etag": "\"sha256-<same digest>\"",
  "chunk_bytes": 4194304,
  "transfer_path": "/api/resources/94f02f5c-16e6-4d45-8973-f2d72c4895a1/binary"
}
```

The digest identifies bytes, not metadata timestamps. Renaming/tagging a record
does not alter it. Uploaded files and completed server-downloaded link media use
the same contract. Folders are traversed as resource records; arbitrary external
links are never fetched by this endpoint. No physical storage path is returned.

`GET /api/resources/:id/binary` requires both headers:

```http
Authorization: Bearer <session token>
If-Match: "sha256-<manifest digest>"
Range: bytes=0-123455
```

The response is 206, application/octet-stream, attachment, private/no-store with
ETag, Content-Range, Content-Length and X-Chunk-SHA256. A range must have explicit
inclusive start/end and be at most 4 MiB. No suffix, open, multiple or oversized
ranges. Empty files have a valid manifest/digest and require no chunk request.

| Outcome | Client handling |
| --- | --- |
| 401/403 | Stop, apply existing session/visibility handling; never publish received bytes after local authority is lost. |
| 404 | File missing/not binary; do not turn absence into an empty file. Reconcile metadata/visibility. |
| 412 | Source changed or revision invalid; obtain a fresh manifest, never combine revisions. |
| 416 | Invalid range; repair offset/chunk calculation using a fresh manifest if needed. |
| 428 | Missing If-Match; obtain the manifest first. |
| 408/network interruption | Retry with backoff; retain only previously verified chunks. |
| 503 | Temporary failure or bounded IO capacity reached; respect Retry-After. |

The same range/revision is safely repeatable; reads create no outbox events,
resources, jobs, audit mutations or server-side download executions. File contents
are hashed with a 1 MiB buffer; at most two file operations per process and 256
cached digest/stat entries. File identity/size/high-resolution modification and
change timestamps invalidate cached digests. Range bytes are buffered, verified
against unchanged file identity, and hashed before returning. Resolved paths must
stay within storage, including symlink/junction resolution. Application-managed
storage is trusted against hostile concurrent filesystem administrators; this is
not an operating-system sandbox against someone controlling the storage tree.

Hashing has a 120-second work bound and can finish after a shorter HTTP timeout,
warming the bounded digest cache for a later request. Ended/disconnected responses
are not written a second time. A cold very-large-file load/timeouts and worker
content replacement still require deployment load tests.

<a id="source-docsarchitectureresource-binary-replication--native-implementation-requirements-acceptance-checklist"></a>
#### Native implementation requirements — acceptance checklist

1. Pull manifests for every authorized file/downloaded link, not only opened cards.
   Treat missing/busy sources as incomplete, not zero data or successful mirroring.
2. Native transfer ownership must bind account, current native session, resource,
   server origin and content digest. Construct transfer URLs from the configured
   API origin/resource ID; never trust a returned absolute URL or redirected host.
3. Write chunks to an account-scoped staging file; persist verified offsets and
   expected manifest in SQLite. Verify response status, revision, range, length
   and digest. Keep partial bytes private. Resume after restart only for the same
   revision and current authority. Final whole-file SHA-256 and size are mandatory.
4. Publish with an atomic rename and reconciled SQLite state. Restart recovery
   must handle interruption before/after file publication. Never display
   "Available offline" before verification/publication. Do not silently evict a
   promised offline copy; disk-full must be explicit, preserving authored files.
5. Serve local video/PDF/audio through a bounded native range reader with current
   lease/account/permission/revocation checks. No unguarded raw file URL or
   all-files asset permission, and no whole-video base64/Blob allocation.
6. Visibility revocation removes derived copies/access locally without an outbound
   delete and without discarding authored pending work. User-authorized deletion
   must separately preserve the existing tombstone/outbox/server reconciliation.
7. Complete editor staging and verify the new single-file/folder upload paths;
   read-only server replication is separate from authored domain creation.

The unresolved recoverable protected-storage/encryption design remains a separate
security requirement. Do not add a device-only key that can irretrievably lose
authored work. Retention, thumbnails and transfer progress must use the same
account/resource identity, with explicit incomplete/stale states.

<a id="source-docsarchitectureresource-binary-replication--acceptance-still-required"></a>
#### Acceptance still required

The October 12 editor slice uses the same managed upload store for PDF copies:
`resource/create_copy` holds a new resource/change identity, a protocol-1 upload
descriptor, and a source ID/revision. The server rechecks source edit authority,
attachment and visibility before inserting the derived resource and receipt.
Original bytes are never overwritten. Markdown opening reads verified native
bytes (UTF-8, at most 4 MiB). The follow-up Markdown writer saves immutable
versions under the same resource ID, publishing local metadata and an
`resource/edit_content` intent in one SQLite transaction. Each pending save
references its predecessor's change ID; the server uses that owned receipt's
revision for compare-and-swap. Transfer uses the resources.edit boundary and
the existing resumable upload protocol. A stale server revision is a conflict,
never an automatic overwrite. Discarding a conflicted edit chain preserves all
physical versions. Markdown now has account-guarded saved-version review, export
and explicit loading into the editor for a new reviewed save. This is not a
forced overwrite or recovery after lost authorization. The latest 100 local
Markdown versions are listed; older bytes are retained.
Opening captures a revision; saving from a stale editor leaves its text intact.
Pending native file creation/copy can now precede content edits in the same
receipt chain; the original create payload stays immutable. Pending metadata or
attachment operations still block content editing. Verified local bytes and
cached editor authority are required.
The October 13 source implementation extends the same receipt chain to PDF/DOCX
copies of pending uploads/copies/content edits. `copy.previous_change_id` is bound
to the authenticated author/device/source and resolved before checking the live
source revision. Native queue selection holds conflicted descendants before its
batch limit; upload failures withhold transitive copies in the current pass.
Discard confirmation explicitly covers dependent copies/edits; intent retirement
preserves all authored bytes. Metadata/folder/attachment chains and recovery UI
remain open; this follow-up has not yet been deployed or outage-tested.
PDF replacement now stages 1 MiB chunks locally (maximum 500 MiB), validates the
PDF header, and uses edit_content with format=pdf. Metadata, editor version and
outbox publication are atomic; prior bytes and the resource identity/filename
are preserved. Partial staging is not published; invalid or stale saves leave
the existing resource unchanged. Header validation is not a complete PDF parser
or safety certification. Desktop PDF viewing now uses a native-only PDF.js range
transport rather than a whole-file GET: 1 MiB chunks, serial processing, at most
16 MiB per assembled request and 64 queued requests, with a 500 MiB document cap.
The native reader returns an opaque immutable-path/size revision; subsequent
ranges pin it and recheck native authority. This prevents combining saved file
versions during a preview, not tampering by a hostile filesystem administrator.
The client validates ranges/revisions/lengths and cancels on closure/session
change. Missing local copies are explicit with no desktop PDF server fallback.
Large-file PDF.js/WebView rendering, media suffix ranges and general Download/
export remain acceptance/work items. DOCX conversion/save now uses the native
bundled worker and local copy/outbox path on desktop; see offline-docx-runtime.md
for the current boundaries. Real desktop outage/reconnect acceptance remains OPEN.
Local staging failures preserve possible recovery bytes; reclamation is still open.

The focused file/handler checks do not exercise PostgreSQL. The phase-end sweep
must use the existing PostgreSQL service and actual desktop with Docker API stopped:
uploads, completed downloaded media, images/PDF/audio/video, large/empty files,
restart/resume, uncertain chunk acknowledgement, replacement, deletion, scoped
members, revoked/disabled accounts, two accounts/devices, storage-full and recovery.
Validate the final hash on PC and local seek/playback offline, then reconnect and
verify no duplicate resources or resurrected deletes. Preserve the current data.

---

<a id="source-docsauditsoffline_first_write_path_audit"></a>
## LabOS desktop write-path audit

Original source: `docs/audits/OFFLINE_FIRST_WRITE_PATH_AUDIT.md`. Retained historical scope/status.

<a id="source-docsauditsoffline_first_write_path_audit--labos-desktop-write-path-audit"></a>
### LabOS desktop write-path audit

The remaining findings in this audit are scheduled in
`docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md`.

Status: Phase 1 implementation/verification checkpoint delivered, 2026-10-03.
The operation-level source index is in PHASE1_MUTATION_SOURCE_INDEX.md; fresh
verification and the remaining security blocker are in PHASE1_EVIDENCE.md.
This is not a claim that every desktop module is now offline-first or that
release security is signed off. Finding 33 remains open. The source index
includes read/helpers and mutation candidates; runtime evidence is separately
identified rather than inferred from the index.

<a id="source-docsauditsoffline_first_write_path_audit--actual-postgresql-test-dataset-2026-10-03"></a>
##### Actual PostgreSQL test dataset — 2026-10-03

The earlier add-only seed run was superseded by the owner's explicit request
to clear the databases and reseed. Only the LabOS PostgreSQL volume and LabOS
local SQLite/WebView state were reset. Other applications' databases and the
LabOS uploaded-media volume were preserved. The current actual PostgreSQL
service contains 2 accounts, 48 items, 6 projects, 18 notes and 9 resources
(verified after the final probes). The seed also supplies 48 initial movements,
16 maintenance records, 30 tasks, 12 experiments and 18 requirements.
The namespaced live probes remove their own rows/files. The disk-backed two-client
note test deletes its note through the API and intentionally leaves its audit,
idempotency and tombstone evidence. It does not reset the app's SQLite cache.
Seed placeholder links are not downloadable-video test fixtures.

<a id="source-docsauditsoffline_first_write_path_audit--findings"></a>
#### Findings

The inventory below distinguishes a deliberate browser HTTP path from a Tauri
fallback. A Tauri command that throws does **not** fall through in the common
`localInvoke` helpers; a command returning `null` can. A `void` Tauri command
normally returns `undefined`, which is treated as successful. The remaining
null-return and Rust transaction paths still require failure injection.

<a id="source-docsauditsoffline_first_write_path_audit--1-inventory-crud-bulk-actions-and-movements"></a>
##### 1. Inventory CRUD, bulk actions, and movements

```text
MODULE: Inventory
FILE: desktop/src/api/items.ts; desktop/src/api/inventory-http.ts; desktop/src-tauri/src/inventory_sync_state.rs; desktop/src-tauri/src/local_inventory.rs; backend/src/inventory-apply.js; backend/src/inventory-sync.js; backend/src/inventory-http.js; backend/src/routes/sync.js; backend/src/migrations/20261009_inventory_versions.sql
CURRENT WRITE PATH: New desktop item CRUD/bulk/movements atomically commit SQLite state plus versioned outbox events. Browser item/storage/movement routes share the versioned PostgreSQL apply transaction, required audit/history, receipt and tombstones. Browser retry identities persist per account in tab session storage; browser remains online-only.
WHY IT BYPASSES OFFLINE-FIRST: Local-write fallback and listed browser split paths are closed. Newly reviewed imports now also use protocol 2. Previously queued immutable events retain their original semantics; no automatic payload rewrite occurs.
RISK: Legacy-event recovery and broader relationship/cache edge cases remain. Browser retry persistence survives tab reload, not clearing/closing its session storage; it is not a durable offline queue. Offline history can be stale; a first installation still needs one successful inventory download.
RECOMMENDED CHANGE: Preserve the transactional/versioned reference; finish legacy recovery and remaining inventory relationships. Test every remaining mutation rather than infer domain-wide completion.
ACTUAL CHANGE MADE: Account/base snapshot guards, canonical IDs, pending intent preservation, repaired IPC and ACK cursor reset. Added server integer versions, same-author/device predecessor outcomes, ordered target locks, stale bulk/delete rollback, additive-delta handling, transactional audit/history/tombstones and microsecond cursors. Browser routes now require stable keys/IDs and displayed versions; storage uses the same path. Retry after refresh reuses the original persisted body/base even when the displayed version advanced. Versionless caches fail closed; versioned conflicts disallow automatic overwrite and discard only confirmed connected batches.
VERIFICATION: October 9 latest: 65 desktop API tests, TypeScript, 37 native tests (7 opt-in live tests skipped by default), explicit inventory suite 9/9 including two disk clients against PostgreSQL. Actual PostgreSQL import/browser/version probes pass rollback, replay, permissions, predecessor ownership and 600-row pagination. History cache/read permissions and explicit empty initialization have native/API tests. Backend 55/55 after DOCX option correction. Detailed scope and limitations are in PHASE2_EVIDENCE.md.
STATUS: New inventory imports, pending-safe history refresh and explicitly confirmed empty-server initialization now verified in addition to the earlier protocol-2 slice. Broader relationships and legacy recovery remain open. No inventory-wide or Phase 2 sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--2-canvas-mutations"></a>
##### 2. Canvas mutations

```text
MODULE: Project canvas
FILE: desktop/src/api/canvas.ts; desktop/src/components/ProjectCanvas.tsx
CURRENT WRITE PATH: Tauri -> local project commands/outbox; browser -> HTTP API.
WHY IT BYPASSES OFFLINE-FIRST: A delete without projectId skipped the local command; any local command returning null also fell through to HTTP. The current canvas UI supplies projectId, but the API did not enforce that boundary.
RISK: Server-only block/connector mutations and stale local canvas after retry or pull.
RECOMMENDED CHANGE: Require a successful local command on Tauri; reject missing project context instead of writing to the server.
ACTUAL CHANGE MADE: Added fail-closed Tauri guards to block/connector create, update, and delete. Browser HTTP behavior is unchanged.
VERIFICATION: Current ProjectCanvas deletion call sites pass projectId; desktop TypeScript check passed. Offline/restart/delete sync test is pending.
STATUS: Guard implemented; end-to-end verification pending.
```

<a id="source-docsauditsoffline_first_write_path_audit--3-daily-use-preferences"></a>
##### 3. Daily-use preferences

```text
MODULE: System preferences
FILE: desktop/src/api/system.ts; desktop/src-tauri/src/local_system.rs; backend/src/routes/system.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Tauri notification edit -> atomic account-scoped SQLite state + outbox -> versioned PostgreSQL apply -> pending-aware pull. Music stays device/account-local. Browser notifications use versioned idempotent PATCH; music uses localStorage.
WHY IT BYPASSES OFFLINE-FIRST: Original fallback and missing outbox are removed. Device-only music intentionally has no outbox under the approved hybrid contract.
RISK: Historical risk was divergent notification state and server-only writes after local failure. Concurrent stale edits now surface conflicts; pending work is retained until resolved.
RECOMMENDED CHANGE: Use the owner-approved hybrid contract in docs/architecture/daily-use-preferences.md: notifications_enabled per-account with transactional outbox, versioned server apply and pull; auto_pause_music and music_volume account-scoped per-device without an outbox. Preserve legacy server values during migration.
ACTUAL CHANGE MADE: Hybrid local/server repositories, additive version migration, shared browser/sync apply with atomic required audit + idempotency, predecessor handling, pending-aware pull, conflict protections, actual notification-delivery gate, explicit legacy music import and immediate player preference updates. Fixed browser PATCH UUID/text SQL inference from actual PostgreSQL failure.
VERIFICATION: Actual PostgreSQL probe and two disk-backed SQLite clients pass restart/replay/chained edits/conflict/account isolation/browser HTTP/device media checks. Native preference atomicity tests, browser fail-closed/retry tests and TypeScript check pass. Current commands and limitations: PHASE2_EVIDENCE.md.
STATUS: Hybrid data path implemented and automated database/client verification passed; GUI interaction/visual acceptance remains Phase 3. Not whole-phase sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--4-maintenance-records"></a>
##### 4. Maintenance records

```text
MODULE: Inventory maintenance
FILE: desktop/src/api/maintenance.ts; desktop/src/api/items.ts; desktop/src-tauri/src/local_maintenance.rs; desktop/src/components/MaintenancePanel.tsx; backend/src/maintenance-sync.js; backend/src/routes/maintenance.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Desktop -> immediate SQLite mutation + immutable authored outbox -> shared versioned PostgreSQL apply -> complete pending-aware pull. Browser -> versioned/idempotent HTTP using the same apply function.
WHY IT BYPASSES OFFLINE-FIRST: Original direct desktop HTTP mutations are replaced. Missing local response/error fails closed, with no server fallback.
RISK: Original offline failure, duplicate uncertain retry and stale operations views are addressed. Conflicting concurrent edits require explicit recovery, not automatic overwrite.
RECOMMENDED CHANGE: Add account-scoped local maintenance state with atomic outbox writes, server change-id idempotency, pull/reconciliation, and delete handling. Add an updated_at/version contract before merging concurrent edits.
ACTUAL CHANGE MADE: Additive version/authorship/tombstone migration; local CRUD/outbox transaction; UUID normalization; dependency chain/version checks; authenticated author and required audit in the same server transaction as idempotency; complete pull with pending-delete preservation; operations overview integration; explicit conflict-chain discard; browser uncertain retry retains identity.
VERIFICATION: Actual PostgreSQL probe and two disk SQLite clients pass offline create/update, restart/replay, repeated pull, concurrent conflict, delete/replay, cascade tombstone and permission checks. Three native unit tests and three API fail-closed/retry tests pass. See PHASE2_EVIDENCE.md for scope and commands.
STATUS: Core offline-first vertical slice implemented and automated verification passed; full GUI/release acceptance remains Phase 3.
```

<a id="source-docsauditsoffline_first_write_path_audit--4b-operations-suppliers"></a>
##### 4b. Operations suppliers

```text
MODULE: Operations suppliers
FILE: desktop/src/api/catalog.ts; desktop/src-tauri/src/local_catalog.rs; backend/src/catalog-sync.js; backend/src/routes/operations.js
CURRENT WRITE PATH: Desktop supplier CRUD uses atomic SQLite state plus authored outbox; browser uses shared PostgreSQL apply with stable ID/key and expected version.
WHY IT BYPASSES OFFLINE-FIRST: The previous direct desktop HTTP writes had no local repository. That path is replaced; no HTTP fallback on null/rejected IPC.
RISK: Historical uncertain retries could duplicate suppliers; stale edits and linked-item cleanup require ordered reconciliation.
RECOMMENDED CHANGE: Preserve shared catalog apply, canonical UUIDs, version/dependency checks, full snapshots and deletion guards; finish broader inventory relationship reconciliation.
ACTUAL CHANGE MADE: Supplier local repository and sync pull/push; immutable predecessor chain; PostgreSQL version/tombstone migration; transactionally required audit/idempotency; admin-only delete and linked-item timestamp advancement; browser replay identity and UI captured versions.
VERIFICATION: Two native unit tests, four API boundary tests, actual PostgreSQL parallel/replay/conflict/permission/delete probe, and two disk-client restart/replay/conflict/delete test passed (October 8). No GUI acceptance claimed.
STATUS: Supplier CRUD slice verified; broader inventory relationship/cache behavior remains Phase 2 work.
```

<a id="source-docsauditsoffline_first_write_path_audit--5-requirements-without-project-context"></a>
##### 5. Requirements without project context

```text
MODULE: Operations requirements
FILE: desktop/src/api/operations.ts; desktop/src/api/projects.ts
CURRENT WRITE PATH: Requirements with project_id use local project methods; browser-only calls without project_id use HTTP. Desktop calls without project_id now fail closed.
WHY IT BYPASSES OFFLINE-FIRST: Previously, the branch was based only on an optional property, not the desktop runtime. A missing ID silently changed storage architecture. A null local command result also fell through to HTTP.
RISK: Server-only requirement, ambiguous retry, local/server divergence.
RECOMMENDED CHANGE: Require project_id for desktop requirement mutations or introduce a separate explicit online-only workflow; never silently fall through.
ACTUAL CHANGE MADE: Desktop create/update/delete now require project context; the project requirement API also rejects a null local-write result instead of calling HTTP. Added 18 deterministic, labeled requirements to the live PostgreSQL seed for read/sync checks.
VERIFICATION: No direct call sites for the operations wrapper were found in desktop/src. The local project commands use the project_resource_requirement outbox type, and backend sync has its handler. Desktop TypeScript check and production build passed. Live PostgreSQL contains 18 requirements across 6 projects, with zero orphaned project/item references; rerunning the seed inserted zero rows. The balika desktop SQLite cache contains the same 6 projects and 18 requirements. Failure-injection and push/retry tests remain pending.
STATUS: Guard implemented; runtime verification pending.
```

<a id="source-docsauditsoffline_first_write_path_audit--6-resource-files-attachments-metadata-and-grants"></a>
##### 6. Resource files, attachments, metadata, and grants

```text
MODULE: Resources
FILE: desktop/src/api/resources.ts
CURRENT WRITE PATH: Core local resource create/delete paths exist, but uploads, file replacement/editor copies, attachment moves, some metadata, visibility, and grant changes use direct HTTP writes.
WHY IT BYPASSES OFFLINE-FIRST: Binary content and server-authoritative access-control operations have no unified local transaction/outbox contract; some writes refresh local cache only after remote success.
RISK: Offline failure or server-only state; metadata/file split-brain after an uncertain response; retry may create another copy. Access grants must not be authorized by a stale client cache.
RECOMMENDED CHANGE: Classify binary editing versus authorization separately. Add durable local media staging and idempotent upload IDs for content; keep grant changes explicitly online/server-authoritative and refresh or invalidate the account cache after success.
ACTUAL CHANGE MADE: None in this slice.
VERIFICATION: Source-path audit only; thumbnail/download regression and real-PostgreSQL retry tests pending.
STATUS: Open; do not blanket-convert grants to offline writes.
```

<a id="source-docsauditsoffline_first_write_path_audit--7-download-manager"></a>
##### 7. Download manager

```text
MODULE: Media downloads
FILE: desktop/src/api/mediaDownloads.ts
CURRENT WRITE PATH: Immediate desktop queue has a local outbox path; scheduled jobs, job mutations, settings, and thumbnail writes call HTTP directly.
WHY IT BYPASSES OFFLINE-FIRST: Server job execution and local queue creation are mixed behind one module.
RISK: Uncertain retry can queue or start a duplicate job; local resource thumbnail/status can lag a completed server action.
RECOMMENDED CHANGE: Separate local scheduling intent from server execution. Give queue/start requests stable idempotency keys, and reconcile final job plus resource metadata into SQLite after completion/deletion.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source-path audit only; real-PostgreSQL job/retry/delete tests pending.
STATUS: Open.
```

<a id="source-docsauditsoffline_first_write_path_audit--8-collaboration-assistant-and-automation"></a>
##### 8. Collaboration, assistant, and automation

```text
MODULE: Collaboration; assistant; automation
FILE: desktop/src/api/comments.ts; desktop/src/api/notifications.ts; desktop/src-tauri/src/local_comments.rs; backend/src/comment-sync.js; desktop/src/components/AssistantChat.tsx; desktop/src/api/automation.ts
CURRENT WRITE PATH: Comments create/delete and notification reads now commit local state + immutable account outbox. Browser comments share idempotent server apply. Assistant/automation effects remain server-authoritative HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Comment/read-marker direct writes are replaced. Assistant generation and automation execution deliberately need server authority but still lack a complete retry/cache contract.
RISK: Duplicate comments/notifications, unauthorized author deletion, revoked cached content and lost unsent work; remaining assistant/automation retries can repeat effects.
RECOMMENDED CHANGE: Keep immutable comments with authenticated authorship and author/admin deletion, current parent authorization, full scoped pull, pending-delete retention and tombstones. Separately harden online effects.
ACTUAL CHANGE MADE: Comment repository, atomic outbox, canonical UUIDs, dependent deletes, no deleted-ID resurrection, server audit/idempotency/notification transaction, reauthorization before replay, visibility snapshots and revoked-content eviction without deleting authored outbox intent. Full-chain discard confirmation matches recovery behavior.
VERIFICATION: Two native comment unit tests and three API boundary tests passed; actual PostgreSQL parallel replay/exactly-once notification/author/parent/revocation/delete probe passed; two disk SQLite clients exercised offline create, restart, lost ACK, repeated pull and cross-client deletion against PostgreSQL (October 8).
STATUS: Comment/read-marker slices verified automatically; assistant/automation online-effect hardening and broader recovery/UI acceptance remain open.
```

<a id="source-docsauditsoffline_first_write_path_audit--9-administrative-accountpermission-mutations"></a>
##### 9. Administrative account/permission mutations

```text
MODULE: Users, authentication, and permissions
FILE: desktop/src/api/auth.ts; desktop/src/api/users.ts; desktop/src/api/permissions.ts; desktop/src-tauri/src/local_auth.rs; backend/src/routes/auth.js
CURRENT WRITE PATH: Server-authoritative HTTP account, profile, password, role and permission changes; local credentials and permission snapshots are cached for desktop offline sign-in/reads.
WHY IT BYPASSES OFFLINE-FIRST: These writes deliberately do not originate from the outbox because an offline client cannot safely grant privileges.
RISK: After a successful server change, another account's local permission cache may remain stale until refreshed. A password change or administrator reset does not immediately replace a different installation's cached offline credential; offline sign-in currently permits that credential until its seven-day expiry. Retry and revocation timing need an explicit security policy.
RECOMMENDED CHANGE: Keep writes online-only, label that state in UI, invalidate/refetch local permission snapshots on success, and test revocation across active sessions. Decide whether the seven-day offline sign-in lease is acceptable or must be shortened/disabled for sensitive roles. On a user's own password change, refresh or invalidate this installation's local credential without leaving the previous hash active.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source classification only; two-account actual-PostgreSQL revocation test pending.
STATUS: Intentional server authority; credential/cache-coherence and offline-revocation policy open.
```

<a id="source-docsauditsoffline_first_write_path_audit--10-inventory-excel-import-on-missing-local-snapshot"></a>
##### 10. Inventory Excel import on missing local snapshot

```text
MODULE: Inventory import
FILE: desktop/src/api/excel.ts; desktop/src/api/inventory-http.ts; desktop/src/api/inventory-pull.ts; desktop/src-tauri/src/local_excel.rs; desktop/src-tauri/src/inventory_sync_state.rs; backend/src/inventory-sync.js; backend/src/inventory-http.js; backend/src/routes/excel.js
CURRENT WRITE PATH: Workbook preview freezes explicit create/update rows, canonical UUIDs, captured versions and one batch ID. Desktop imports atomically persist the merged SQLite snapshot and one immutable item/import event. Browser submits the same versioned JSON plan to shared PostgreSQL apply with a persisted retry key.
WHY IT BYPASSES OFFLINE-FIRST: Earlier missing-cache/server fallback is removed. Native invocation/parse/permission failures propagate, not masquerade as cache misses. Cache/pull writes are derived state and intentionally do not produce business outbox events.
RISK: Legacy queued import payloads retain their old semantics. Browser retry recovery lasts only as long as tab session storage. Inventory import accepts at most 500 rows and 10 MiB workbooks; old multipart mutation callers must migrate to reviewed JSON plans. Finance/purchase import conversion remains separate.
RECOMMENDED CHANGE: Retain immutable batch/row IDs and per-row authorization, exact preview bases, atomic local/outbox and server transactions. Never initialize a missing cache as empty solely because a local read failed.
ACTUAL CHANGE MADE: Fixed generated-UUID creates being classified as updates; canonicalized duplicate checks; preserved non-workbook fields on updates. Added import/view/create/edit/stock permission checks, quantity validation, all-target ordered locks, atomic per-row audit and single receipt, predecessor support and pending-pull/discard integration. Native IPC retry returns the previous batch result without reapplying. Browser uncertain re-preview retains original IDs/body. Empty first pull initializes only with snapshot_complete=true; first-use offline without a server snapshot still fails closed.
VERIFICATION: Three native import tests, three workbook API tests, browser re-preview/retry test and four pull-page tests pass. Actual PostgreSQL probe verifies rollback after an earlier row created, permission-denied rollback, parallel replay, mismatched-key rejection, single sync receipt and dependent edits. Two disk-client restart/lost-ACK import test passes. Existing shared database was not cleared to simulate an empty installation; empty-response behavior was tested at the API/native boundary.
STATUS: New inventory import path implemented and verified October 9; legacy recovery, workbook parser hardening and GUI acceptance remain separate open work.
```

<a id="source-docsauditsoffline_first_write_path_audit--11-storage-containers-and-item-storage"></a>
##### 11. Storage containers and item storage

```text
MODULE: Storage containers and item storage
FILE: desktop/src/api/phase4.ts; desktop/src/api/catalog.ts; desktop/src/api/inventory-http.ts; desktop/src-tauri/src/local_catalog.rs; backend/src/catalog-sync.js; backend/src/inventory-http.js; backend/src/routes/phase4.js
CURRENT WRITE PATH: Desktop container/item-storage writes use atomic local/outbox paths. Browser containers use shared catalog apply; browser item-storage edits and the legacy storage URL now use shared versioned inventory apply with required audit/idempotency.
WHY IT BYPASSES OFFLINE-FIRST: Earlier container and storage bypasses are removed; desktop failures never select the browser route.
RISK: Broader relationship/cache reconciliation and legacy writers remain separate inventory work; UI acceptance remains pending.
RECOMMENDED CHANGE: Preserve catalog/item versions and relationship constraints; finish remaining import/relationship paths and visual acceptance.
ACTUAL CHANGE MADE: Container repository/version/tombstone/linked-item guard retained. Storage-label UI captures its displayed version and retains its selected container. Both item update and storage PATCH require expected versions and stable browser retry keys; desktop still uses its outbox.
VERIFICATION: Catalog PostgreSQL/two-disk-client evidence from October 8 retained. October 9 actual PostgreSQL browser probe passes storage CAS and replay; desktop fail-closed API tests and TypeScript pass. No GUI sign-off.
STATUS: Container CRUD and item-storage browser mutation slice verified; broader inventory relationship/cache work remains open.
```

<a id="source-docsauditsoffline_first_write_path_audit--12-project-workflow-actions-outside-the-local-project-repository"></a>
##### 12. Project workflow actions outside the local project repository

```text
MODULE: Project review, reservations, members, grants, experiment repeat
FILE: desktop/src/api/projects.ts; backend/src/routes/projects.js; backend/src/routes/project-workspace.js
CURRENT WRITE PATH: Core project/task/experiment/BOM/link/measurement/observation/attachment mutations invoke local commands on Tauri. Review decisions, reservation request/decision/fulfillment, membership, visibility/grants and experiment repeat use direct HTTP. Reservation fulfillment sends a caller request_id; most other HTTP POSTs do not carry a stable retry key.
WHY IT BYPASSES OFFLINE-FIRST: The direct calls have no local intent/outbox operation. Membership, grants and review approval may be deliberately server-authoritative; reservation request and experiment repeat require separate classification. Local-command null returns can still reach the HTTP branch for several core mutations.
RISK: Offline failure, uncertain-response duplicate actions, stale project workspace after remote success, or an accidental server-only core mutation on a null local result.
RECOMMENDED CHANGE: Keep authorization changes server-authoritative with explicit online UI and cache invalidation. Decide workflow-action authority, add idempotency to effectful online actions, and fail closed on Tauri for every offline-capable local null result. Test every core project sub-record's Rust write/outbox transaction.
ACTUAL CHANGE MADE: Existing requirement guard is recorded in Finding 5; none for the remaining actions in this slice.
VERIFICATION: Desktop source-path review; no complete two-client/PostgreSQL retry matrix yet.
STATUS: Open — mixed offline-capable and server-authoritative actions.
```

<a id="source-docsauditsoffline_first_write_path_audit--13-excel-and-purchasefinance-imports"></a>
##### 13. Excel and purchase/finance imports

```text
MODULE: Import/export
FILE: desktop/src/api/excel.ts; desktop/src/api/excel-finance.ts; desktop/src/api/purchases.ts; backend/src/routes/excel.js; backend/src/routes/excel-finance.js; backend/src/routes/excel-purchases.js
CURRENT WRITE PATH: Inventory imports now use an immutable atomic protocol-2 batch locally and shared versioned apply in the browser (Finding 10). Finance and purchase imports still POST workbooks directly from the desktop. Preview POSTs parse only; exports and templates are reads.
WHY IT BYPASSES OFFLINE-FIRST: Finance/purchase imports can create multiple database records without a local batch/outbox representation or atomic desktop reconciliation. The upload response alone is not a durable local commit.
RISK: Partial or repeated imports after network uncertainty, duplicate purchases/transactions, and finance or inventory cache divergence. Export projections and audit logging require independent security review.
RECOMMENDED CHANGE: Give each import an immutable batch ID, row IDs, server idempotency and reconciliation or a fully local parsed/outbox path; classify previews separately from writes. Preserve import-specific permission gates.
ACTUAL CHANGE MADE: Inventory batch/outbox/HTTP replay conversion and actual PostgreSQL tests in Finding 10. No finance/purchase import conversion in this slice.
VERIFICATION: Source classification only for finance/purchases; PostgreSQL repeat-upload, rollback and cache checks pending.
STATUS: Open.
```

<a id="source-docsauditsoffline_first_write_path_audit--14-knowledge-record-visibility-and-write-paths"></a>
##### 14. Knowledge record visibility and write paths

```text
MODULE: Findings, results, relationships, search and sync pull
FILE: desktop/src/api/knowledge.ts; desktop/src/api/sync.ts; desktop/src-tauri/src/local_knowledge.rs; backend/src/routes/knowledge.js
CURRENT WRITE PATH: Tauri finding/result/relationship writes use local commands whose save helper can enqueue an outbox event in the same SQLite transaction; browser writes use HTTP. Server list/search/sync-pull for findings/results/calculations previously filtered by project membership, not the record's lab/project/restricted visibility. Knowledge overview/tags also used only project membership. Relationships were listed without checking either endpoint.
WHY IT BYPASSES OFFLINE-FIRST: The Tauri write branch itself is local-first; the security defect was in remote read projections. The HTTP branch on an unexpected null local result remains a fallback risk. Relationships and knowledge aggregate reads still lack the full per-record/ancestor visibility contract.
RISK: Restricted findings/results/calculations could leak through list, search or sync pull. Overview counts/recents/tags and relationship endpoints could disclose restricted Notes/Resources. The desktop previously retained revoked cached findings/results and accidentally removed pending local knowledge edits during tombstone cleanup. An HTTP fallback could leave a local-only view stale.
RECOMMENDED CHANGE: Reuse the shared visibility predicate across record reads and Notes aggregates; use effective Resource access (including folder ancestors and attached Notes) for Resource aggregates. Fail closed on unexpected Tauri null writes. Filter relationships by both endpoints and test revocation cleanup.
ACTUAL CHANGE MADE: Findings/results/calculations list, search and sync-pull queries now use visibilityReadSql. Search SQL now supplies the aliases its predicate references. Overview/tags use Note visibility SQL and effective Resource access. Relationship lists/pull filter both endpoints, and direct create/delete require readable endpoints and project edit. Duplicate HTTP create no longer reassigns an existing relationship's project. Finding/result update/delete require restricted edit grants, and project-owned create/edit paths require actual project edit access. Linked finding titles are visibility-gated; experiment titles are temporarily omitted rather than risking an unauthorized join. Knowledge pull now returns visible-ID snapshots; Tauri requires them and removes unauthorized cached rows while preserving pending local edits. SQLite inspection errors fail the pull rather than silently dropping rows. Knowledge sync update/delete now authorize the existing server row's project and restricted visibility, rather than trusting the submitted project_id; a different change ID cannot silently reuse an existing entity ID. Sync create now persists the requested visibility and gives the creator an edit grant for restricted findings/results; visibility changes on update reject explicitly pending a grant-aware transition design. Non-admin Knowledge and Note pulls no longer receive tombstone IDs because authorized visible-ID snapshots already drive cache eviction. No local-write fallback rewrite yet.
VERIFICATION: Source regression tests, Node syntax check, desktop TypeScript check and Rust cargo check pass. On actual PostgreSQL, unique restricted finding/Note/Resource/relationship probes were hidden from member list/search/sync pull/overview/tags/relationships, shown after view grants, then hidden after revocation; pull visible IDs matched returned rows. A separate isolated researcher/project probe showed view-only grants cannot update a restricted finding, edit grants can, loss of project membership blocks edit even with a spoofed null project_id, and hidden relationship endpoints reject sync create/delete. All exact probe rows were removed. Desktop two-account cache eviction and offline retry still need runtime verification.
STATUS: Server visibility and sync mutation boundary repaired; linked-record projections, offline retry and two-client matrix remain open.
```

<a id="source-docsauditsoffline_first_write_path_audit--15-notification-and-assistant-ui-writes"></a>
##### 15. Notification and assistant UI writes

```text
MODULE: Notification read state; assistant conversation/context
FILE: desktop/src/api/notifications.ts; desktop/src-tauri/src/local_notifications.rs; backend/src/notification-sync.js; desktop/src/api/experience.ts; desktop/src/api/collaboration.ts; desktop/src/components/AssistantChat.tsx
CURRENT WRITE PATH: Both notification API aliases delegate to the local-first repository on desktop; browser uses frozen IDs and stable idempotency keys. Assistant component writes remain direct HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Notification bypass is removed. Assistant online-effect writes still need a domain API/retry/cache contract.
RISK: Read-all retry could acknowledge later arrivals, cross-account markers or hidden content; assistant optimistic context/history can diverge.
RECOMMENDED CHANGE: Monotonic read acknowledgements for an explicit frozen ID set, account ownership and current visibility filtering; separately centralize online assistant effects and error states.
ACTUAL CHANGE MADE: Atomic local read/outbox, pending-aware full pull, revoked notification-content eviction while retaining ID-only outbox intent; PostgreSQL monotonic timestamps and shared idempotent aliases; future arrivals excluded from retries.
VERIFICATION: Native atomicity/account/revocation unit and three API boundary tests passed. Actual PostgreSQL ownership/visibility/parallel retry/timestamp/deleted-record probe and two-disk-client offline/restart/concurrent-read/lost-ACK/later-arrival/browser-parity test passed (October 8).
STATUS: Notification read-state slice verified automatically; assistant changes remain open.
```

<a id="source-docsauditsoffline_first_write_path_audit--16-uuids-and-retry-keys-outside-notesresources"></a>
##### 16. UUIDs and retry keys outside Notes/Resources

```text
MODULE: Cross-domain identity and replay
FILE: desktop/src/api/local-inventory.ts; desktop/src/api/excel.ts; desktop/src-tauri/src/local_knowledge.rs; desktop/src-tauri/src/local_engineering.rs; desktop/src-tauri/src/local_locations.rs; backend/src/routes/sync.js
CURRENT WRITE PATH: Inventory and Excel generate entity UUIDs in TypeScript; Rust knowledge/engineering/locations generate UUIDs for records and separate outbox change IDs. The server sync endpoint stores change_id with device, user, operation and payload ownership checks. Direct HTTP endpoints often rely on server-generated IDs and have no equivalent retry key.
WHY IT BYPASSES OFFLINE-FIRST: Identity creation is scattered by module; direct HTTP POST retries do not participate in sync_idempotency. A new client ID and change ID for the same logical user action can create a second row despite per-change idempotency.
RISK: Duplicates on uncertain response, cross-device identity drift, or non-replayable direct imports/actions.
RECOMMENDED CHANGE: Define one canonical UUID representation and persisted logical-operation ID; preserve it across retries and API modes. Explicitly test create, update, delete and replay for every entity family, including browser HTTP writes.
ACTUAL CHANGE MADE: Inventory/browser/import paths use canonical UUIDs, immutable retry payloads and stable batch keys. Import creates have explicit operation labels rather than treating every generated ID as an update. Browser lost-ACK re-preview reuses the original generated IDs and bases.
VERIFICATION: Native duplicate-normalization and retry tests, desktop browser-reload/re-preview tests, actual PostgreSQL import/browser/version probes and two-client restart tests pass for inventory. Full per-domain replay tests remain pending.
STATUS: Inventory identity/replay slice verified; no claim of repository-wide normalization.
```

<a id="source-docsauditsoffline_first_write_path_audit--17-engineering-scope-and-record-mutation-authority"></a>
##### 17. Engineering scope and record mutation authority

```text
MODULE: Engineering calculations and tests
FILE: desktop/src/api/engineering.ts; desktop/src/api/sync.ts; desktop/src-tauri/src/local_engineering.rs; backend/src/routes/engineering.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Tauri create/delete calculation and create/update/delete test commands write SQLite plus outbox; browser writes use HTTP. Server lists and compare previously checked project access but ignored each record's visibility. Delete/update routes likewise checked project edit but not restricted-record edit grants.
WHY IT BYPASSES OFFLINE-FIRST: Core Tauri writes do not deliberately bypass the outbox, but the server read/mutation authority could diverge from a restricted local record. Browser direct POST retries do not use sync change IDs.
RISK: Restricted calculations/tests leak to ungranted project members; a project editor with domain permission can mutate a restricted engineering record without an edit grant. Browser retry may duplicate a calculation or test.
RECOMMENDED CHANGE: Apply both project and record visibility to every read, and require a restricted edit grant for mutation. Preserve domain permissions. Verify sync pull and offline replay separately; make browser POST idempotent if retained.
ACTUAL CHANGE MADE: Calculation/test lists and compare now apply canReadEntity after project access. Calculation delete and test update/delete require canEditRestrictedEntity for restricted records. Compare strips the visibility field it fetched only for authorization. Engineering sync pull now applies both record visibility and project access and returns visible-ID snapshots. Desktop pull requires the snapshot and evicts revoked cached rows without discarding pending local edits. Engineering sync update/delete now authorize the existing server row's project and restricted visibility, ignore client-supplied actor/project changes, and reject a new change ID colliding with an existing entity ID. Sync create persists requested visibility and grants the restricted creator edit access; visibility transitions on update reject pending a grant-aware design. Non-admin Engineering pulls no longer receive tombstone IDs; the snapshot still removes deleted/revoked cached rows.
VERIFICATION: 43 backend source/security tests, Node syntax, desktop TypeScript and Rust cargo checks pass. Against the existing PostgreSQL service, uniquely named calculation/test rows were hidden from a non-admin in list/compare/sync pull, visible after grants, and hidden after revocation. A restricted sync create was hidden from the member, gave its creator an edit grant, replayed with the same change ID, rejected a second change ID using the same entity ID, and replayed delete without restoring the row. The probe removed its exact rows, grants, tombstone and idempotency entries. Delegated-editor mutation denial and desktop two-client revocation/retry remain unverified.
STATUS: Server sync/read guards and local snapshot reconciliation implemented; complete role and desktop matrix open.
```

<a id="source-docsauditsoffline_first_write_path_audit--18-sync-push-authority-versus-submitted-payload"></a>
##### 18. Sync push authority versus submitted payload

```text
MODULE: Cross-domain sync push authorization
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts
CURRENT WRITE PATH: Desktop outbox POSTs to /sync/push with entity ID, operation and a submitted record. Server validates the user's domain permission and a change-id replay key, then dispatches domain handlers. Knowledge and Engineering handlers previously used the submitted project_id for authorization before loading the existing row. A create with an already-used entity ID returned the existing row as if the new change succeeded.
WHY IT BYPASSES OFFLINE-FIRST: The outbox is present, but server replay could mutate a row outside the sender's actual scope or acknowledge a different logical create. The submitted record is not authoritative for ownership, and change-id idempotency does not cover a second change ID for the same entity ID.
RISK: Unauthorized update/delete of project-scoped or restricted records, false sync success, and local/server identity divergence. A later replay could echo stored response_json after record access was revoked. Relationship endpoint permissions are still not mirrored in the sync handler.
RECOMMENDED CHANGE: Authorize update/delete from the locked current server row, validate create against the target project and endpoint scope, reject ID collision unless the exact change ID already replayed, and keep immutable actor/project fields server-owned. Return a minimal acknowledgement on push/replay and pull authorized current rows separately. Add role-matrix tests for delegated editor, view-only grantee, revoked user and deleted project.
ACTUAL CHANGE MADE: Knowledge and Engineering update/delete now check the existing project's edit authority and restricted edit grant. New create IDs cannot silently alias an existing row; same change-id replay still succeeds through sync_idempotency. Engineering create actor is server-owned, and Engineering update cannot change project or actor. Finding/result sync create preserves validated visibility with a restricted creator grant; unsupported visibility transitions fail explicitly. All sync pushes/replays now return an acknowledgement without echoing current or stored entity snapshots; the desktop already ignores result data and pulls authorized state separately. A shared relationship-access helper now gates both direct HTTP and sync create/delete on readable endpoints and project scope.
VERIFICATION: Static handler tests pass. Actual PostgreSQL Engineering probe passed restricted create, same-change replay, different-change collision, delete replay and exact cleanup. The isolated researcher/project probe passed restricted view/edit, stored-project, relationship endpoint and disabled-account checks against actual PostgreSQL; it removed its temporary user, project, records, grants, idempotency and audit entries. A real revocation replay response and desktop two-client cache check remain open.
STATUS: Relationship and existing-row boundary repaired; full two-client matrix open.
```

<a id="source-docsauditsoffline_first_write_path_audit--19-null-local-ipc-results-on-core-desktop-mutations"></a>
##### 19. Null local IPC results on core desktop mutations

```text
MODULE: Notes, Knowledge, Locations and Projects
FILE: desktop/src/api/notes.ts; desktop/src/api/knowledge.ts; desktop/src/api/locations.ts; desktop/src/api/projects.ts
CURRENT WRITE PATH: In Tauri, each module invokes a local Rust command and checks its result against null before the browser HTTP branch. A null result could enter that branch even after a local write; a Rust unit-returning delete may serialize as null.
WHY IT BYPASSES OFFLINE-FIRST: A null IPC result is ambiguous but was treated as permission to issue an independent server write. Browser HTTP is intentional; Tauri fallback is not.
RISK: Duplicate create, stale local state after a remote update, or a local delete followed by a second server delete and sync conflict. The bug covers core project subrecords as well as top-level records.
RECOMMENDED CHANGE: Treat Tauri IPC as authoritative: failures and missing value results stop with an explicit local error. Treat unit-returning delete/unlink commands as completed local operations regardless of whether IPC serializes void as null or undefined. Retain HTTP only when no Tauri runtime exists.
ACTUAL CHANGE MADE: The four local helpers now reject unexpected null value results on Tauri. Delete/unlink commands treat a null unit result as completed, so no remote fallback follows. Browser paths remain unchanged.
VERIFICATION: Desktop TypeScript check passed; source review confirms the helper is shared by each module's local-first mutations. Forced-null IPC and two-client PostgreSQL failure-injection tests remain pending.
STATUS: Fallback closed in source; runtime failure injection open.
```

<a id="source-docsauditsoffline_first_write_path_audit--20-global-desktop-search-reads-raw-local-snapshots"></a>
##### 20. Global desktop search reads raw local snapshots

```text
MODULE: Cross-domain search and cached permission projection
FILE: desktop/src-tauri/src/local_search.rs; desktop/src/api/search.ts
CURRENT WRITE PATH: Search itself is read-only, but it reads snapshots written by local mutations and server pull. Before this change it scanned raw projects_state and the wrong transactions_state key directly, without checking each domain's current offline permission or normal project visibility filter.
WHY IT BYPASSES OFFLINE-FIRST: Search is a second projection over local state. It must obey the same account, permission and financial-field contract as the repositories that own those snapshots; otherwise an outbox/pull-correct record can still leak through search.
RISK: Cached hidden projects, nested project records or financial fields could be matched and returned in full search result data. Transactions were incorrectly absent because the actual finance key is finance_transactions_state. Revoked access may remain visible until a successful pull or offline lease expiry.
RECOMMENDED CHANGE: Gate each local search domain on its current local permission; use the project repository's filtered list and finance repository's projected transaction list; search/return only ordinary project fields. In Phase 2, exercise revocation and account switch with two desktop clients, and decide the offline lease policy.
ACTUAL CHANGE MADE: Local search now checks inventory/projects/notes/resources/finance permissions, uses list_local_projects for project scope, uses get_local_transactions for ordinary/sensitive finance projection, and narrows project search input/result data to ordinary fields. Findings use projects.view. Search still reads the local snapshots of notes/resources/findings and relies on their pull reconciliation, so revocation timing remains governed by the pending offline-lease decision.
VERIFICATION: cargo check passed. A Rust unit test confirms project search cannot match or return budget, transactions or nested task data. Actual two-client revocation/search testing remains open.
STATUS: Immediate local search side-channel repaired; revocation timing and two-client proof open.
```

<a id="source-docsauditsoffline_first_write_path_audit--21-sync-conflict-controls-assume-inventory-permission"></a>
##### 21. Sync conflict controls assume inventory permission

```text
MODULE: Cross-domain sync conflict listing and retry/delete resolution
FILE: desktop/src-tauri/src/local_db.rs; desktop/src/api/sync.ts
CURRENT WRITE PATH: A rejected outbox change creates an account-owned SQLite sync_conflicts row. The conflict list requires inventory.view before reading any entity type; resolve_sync_conflict also requires inventory.view, then adds finance.view_sensitive for finance entries. keep_local rewrites and retries the same outbox payload; accept_server/dismiss mark the change synced. accept_server resets only the inventory pull cursor.
WHY IT BYPASSES OFFLINE-FIRST: Outbox recovery is global, but its local authorization and refresh path are hard-coded to inventory. A user with valid notes/projects/finance permissions but no inventory.view cannot inspect or resolve their own domain's rejected change, so a legitimate offline mutation can remain stuck indefinitely.
RISK: Hidden pending changes and misleading sync status; improper exposure if the inventory permission is used as a proxy for another domain; accepting a non-inventory conflict without an explicit domain refresh may leave stale local state until a later full pull. Finance requires an unrelated inventory grant.
RECOMMENDED CHANGE: Derive the conflict's domain from its entity_type and operation; gate payload visibility by the domain's read permission and retry by its mutation permission. Always permit a safe account-owned discard path after an explicit confirmation, even when edit access was revoked. Trigger domain-specific pull after accept_server and preserve the original change_id for retries. Test each domain and finance-sensitive case against current permissions.
ACTUAL CHANGE MADE: Conflict listing now uses the outbox entity/domain and redacts unavailable payloads. Owner-only discard does not require an unrelated inventory grant. Retry requires the correct domain write authority. Inventory explicit overwrite creates a NEW change ID; ordinary retry retains the original payload and key.
VERIFICATION: Rust tests verify Notes recovery without inventory access, denied retries after permission loss, immutable retries, fresh UUID/account-stamped overwrite, and owner discard. Full per-domain recovery UX remains Phase 2.
STATUS: Implemented foundation; per-domain conflict/version UI and concurrency matrix remain Phase 2.
```

<a id="source-docsauditsoffline_first_write_path_audit--22-project-financial-summary-mixes-local-projections"></a>
##### 22. Project financial summary mixes local projections

```text
MODULE: Projects, inventory valuation and finance summary
FILE: desktop/src/api/projects.ts; desktop/src/api/transactions.ts; desktop/src-tauri/src/local_finance.rs; backend/src/routes/projects.js; backend/src/routes/items.js
CURRENT WRITE PATH: Tauri project, transaction and item mutations each use their local repositories/outbox, while browser mutations use server routes. The desktop project-financial-summary read recomputes from locally cached projects, projected transactions and item unit costs; the server summary is a separate PostgreSQL view. A user with finance.view but not finance.view_sensitive receives expense-only local transactions, so desktop project_income computes as zero even though the server ordinary-finance summary may include aggregate income. Inventory item endpoints currently expose unit_cost and replacement_cost under inventory.view.
WHY IT BYPASSES OFFLINE-FIRST: No business write bypass occurs here, but the derived local read is not governed by one shared finance projection/version contract. Direct server writes in finance imports, purchases and project workflow can change these aggregates before the local cache catches up.
RISK: Different budget/income totals between desktop and browser; stale totals after server-only imports; potential cost disclosure if inventory.view is not intended to include valuation fields. Treating cached line-item finance as a summary source may overstate what an ordinary finance viewer is allowed to inspect.
RECOMMENDED CHANGE: Define the finance field policy explicitly (including whether inventory unit costs require inventory.view or finance.view). Build the same aggregate from authorized server-pulled summary data or a tested local projection whose inputs include authorized aggregate income without exposing individual sensitive transactions. Version/invalidate it after imports and project/item writes, then test role combinations against PostgreSQL and two desktop clients.
ACTUAL CHANGE MADE: None; no valuation policy was inferred from the current implementation.
VERIFICATION: Source-path comparison of desktop summary, local finance projection, server project summary and item GET fields. Actual role/output matrix pending.
STATUS: Open — finance projection and cost-visibility policy required.
```

<a id="source-docsauditsoffline_first_write_path_audit--23-direct-server-deletes-omitted-finance-tombstones"></a>
##### 23. Direct server deletes omitted finance tombstones

```text
MODULE: Finance transactions, budget periods and funding sources
FILE: backend/src/routes/transactions.js; backend/src/routes/budget-periods.js; backend/src/routes/funding-sources.js; backend/src/routes/sync.js; desktop/src-tauri/src/local_finance.rs
CURRENT WRITE PATH: Desktop normal finance deletes use SQLite/outbox; browser and some online callers invoke direct HTTP DELETE. The sync handler wrote tombstones, but the three direct DELETE routes did not. The sensitive finance pull returns rows plus up to 1,000 latest finance tombstones, and local finance merge removes cached rows only when their IDs appear in that tombstone list.
WHY IT BYPASSES OFFLINE-FIRST: A server DELETE without its sync deletion event is invisible to an already-cached desktop client. It bypasses the cross-device delete contract even though the local outbox path is correct.
RISK: A deleted transaction, budget period or funding source can remain as a phantom local record indefinitely on another device. A later offline edit can conflict with the missing server row. The 1,000-tombstone pull cap remains a separate long-offline reconciliation risk.
RECOMMENDED CHANGE: Commit the DELETE and matching tombstone atomically for every direct finance route; verify API deletion and pull on actual PostgreSQL. In Phase 2, add authoritative visible-ID reconciliation or paginated tombstones so long-offline clients cannot miss older deletions.
ACTUAL CHANGE MADE: All three direct DELETE routes now use a PostgreSQL transaction that deletes the exact row and inserts/upserts its finance tombstone before commit. Existing permission and project-delete middleware remain in place. The probe creates and removes only three uniquely identified records.
VERIFICATION: The API-only container was rebuilt without recreating PostgreSQL. The opt-in direct-delete-live-probe passed direct DELETE, physical row absence, tombstone presence and finance-pull inclusion for all three entity types on the existing PostgreSQL service; it cleaned its exact rows, tombstones and audit entries. The >1,000-deletion and two-client cache matrix remain open.
STATUS: Direct delete gap fixed; long-offline tombstone coverage open.
```

<a id="source-docsauditsoffline_first_write_path_audit--24-direct-location-delete-omitted-its-sync-tombstone"></a>
##### 24. Direct location delete omitted its sync tombstone

```text
MODULE: Inventory locations
FILE: backend/src/routes/locations.js; backend/src/routes/sync.js; desktop/src-tauri/src/local_locations.rs
CURRENT WRITE PATH: Desktop local delete queues a location outbox event and the sync handler writes a tombstone. Browser DELETE /locations/:id removed the server row but did not write a tombstone. Location pull returns current rows and up to 1,000 tombstones; the local merge removes only explicitly deleted IDs.
WHY IT BYPASSES OFFLINE-FIRST: A direct server delete did not emit the event required by the other clients' local reconciliation path.
RISK: Deleted locations remain in another desktop's SQLite cache and may appear in search or selectors; an offline edit then rejects against a missing server row. Old deletes can still be missed after the 1,000-tombstone limit.
RECOMMENDED CHANGE: Write the direct DELETE and tombstone in one PostgreSQL transaction, verify pull against the actual service, then replace the bounded tombstone-only reconciliation with an authoritative or paginated scheme in Phase 2.
ACTUAL CHANGE MADE: Direct location DELETE now commits the exact row removal and a location tombstone atomically, retaining inventory.delete permission and audit behavior.
VERIFICATION: API-only image rebuild and opt-in direct-delete-live-probe passed physical row absence, tombstone presence and location-pull inclusion on the existing PostgreSQL service; it cleaned its exact temporary record, tombstone and audit entry. Two-client cache and >1,000-delete matrix remain open.
STATUS: Direct delete gap fixed; long-offline reconciliation open.
```

<a id="source-docsauditsoffline_first_write_path_audit--25-inventory-browser-write-routes-did-not-match-the-desktop-api-client"></a>
##### 25. Inventory browser write routes did not match the desktop API client

```text
MODULE: Inventory item deletion and bulk status/deletion
FILE: desktop/src/api/items.ts; desktop/src/api/inventory-http.ts; backend/src/inventory-http.js; backend/src/inventory-sync.js; backend/src/inventory-apply.js; backend/src/routes/items.js; backend/src/index.js
CURRENT WRITE PATH: Tauri uses SQLite/outbox. Browser item create/update/delete, bulk status/delete, stock movements and storage writes use explicit HTTP routes backed by the shared inventory transaction handler.
WHY IT BYPASSES OFFLINE-FIRST: Missing routes and incorrect permission routing were repaired earlier. Separate unversioned SQL bodies are now replaced; these endpoints cannot be selected after a desktop local failure.
RISK: Previously duplicate uncertain retries, stale overwrites, partial bulk effects and missing audit/history. Old external callers now fail closed unless they send UUID keys/IDs and captured versions.
RECOMMENDED CHANGE: Keep required retry keys and versions; migrate remaining imports/legacy writers explicitly and retain real PostgreSQL regression probes.
ACTUAL CHANGE MADE: Shared apply/ordered locks/version checks and atomic required audit/history/receipt/tombstone. Permission checks also run on replay. Browser tab-persisted immutable intents survive transport/5xx/truncated responses and reload; refreshed versions do not turn unresolved stock intents into new operations. UI supplies captured edit versions; desktop guards remain.
VERIFICATION: Actual PostgreSQL probes pass parallel create, mismatched key rejection, revoked replay, edit/history uniqueness, stale atomic bulk/delete, movement replay, stale absolute adjustment, storage CAS, deletion replay and tombstones. Eight browser API tests plus existing fail-closed suite pass (54 total). Two disk clients against PostgreSQL passed after shared apply extraction.
STATUS: Listed browser mutation routes and desktop regression verified October 9; remaining import/legacy paths and GUI/release acceptance are not complete.
```

<a id="source-docsauditsoffline_first_write_path_audit--26-different-change-ids-could-claim-an-existing-create-id"></a>
##### 26. Different change IDs could claim an existing create ID

```text
MODULE: Cross-domain UUID identity and sync replay
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts
CURRENT WRITE PATH: Outbox push first checks change_id idempotency, then dispatches the entity create. Item and recently repaired Knowledge/Engineering creates reject an already-used entity UUID. Resource and finance creates still returned the existing row for an ID collision; movement create returned an existing movement. Resource also intentionally coalesces a distinct new link ID by URL and attachment context, and active download jobs are coalesced by resource.
WHY IT BYPASSES OFFLINE-FIRST: A different change_id is a different logical mutation. Acknowledging an unrelated existing entity by UUID tells the client its new local row was accepted while the server kept someone else's row. This is distinct from safe replay of the same change_id and distinct from the URL-based resource deduplication policy.
RISK: Silent local/server identity divergence, a false successful create, and possibly a duplicate or missing row after pull. The same issue remains for movement-ID collisions and requires a separate decision for URL/job coalescing versus a stable returned canonical ID.
RECOMMENDED CHANGE: Preserve same-change_id replay at the idempotency layer; reject a new create using an existing UUID with a domain-specific 409. Define explicit canonical-ID reconciliation when deduplication by natural key is intentional. Test same-ID/different-change and same-change replay on actual PostgreSQL for each domain.
ACTUAL CHANGE MADE: Resource and finance create-ID collisions reject distinct intents; movement-ID collision rejects without a second stock effect. Same-change replay preserves the original result under current response projection.
VERIFICATION: Actual PostgreSQL direct-delete, inventory-routes and finance-role probes passed; income-only finance probe covers movement collision and identical replay. Cross-client natural-key link convergence remains a Phase 2 case.
STATUS: Stable-ID collision guards verified for Finance, Resources, movements and Engineering; remaining domain/natural-key matrices assigned Phase 2.
```

<a id="source-docsauditsoffline_first_write_path_audit--27-income-only-finance-create-permission-is-blocked-before-domain-validation"></a>
##### 27. Income-only finance create permission is blocked before domain validation

```text
MODULE: Finance sync push and granular permissions
FILE: backend/src/routes/sync.js; desktop/src-tauri/src/local_finance.rs
CURRENT WRITE PATH: Local transaction create checks direction and accepts finance.create_income for income. The sync push envelope maps every transaction create to finance.create_expense before applying the finance handler. The handler later checks finance.create_income for income, but it cannot be reached by an account granted income-create without expense-create.
WHY IT BYPASSES OFFLINE-FIRST: The offline write can be accepted locally under the correct granular permission, then the server rejects its outbox replay under an unrelated permission. This is a cross-layer permission-contract mismatch, not a user conflict.
RISK: Permanent pending income transaction and misleading sync attention for a valid role. Granting expense-create merely to unblock sync would overgrant financial authority.
RECOMMENDED CHANGE: Derive envelope permission from the validated transaction direction and use the same helper for local/server permission tests. Preserve finance.view_sensitive and project-edit checks for income. Add an actual PostgreSQL income-only/expense-only role matrix and replay test.
ACTUAL CHANGE MADE: Sync envelope derives income-create versus expense-create from transaction direction. Server retains sensitive finance/project checks and sets logged_by to the authenticated account. Local sensitive mutations require both financial read capabilities.
VERIFICATION: finance-role-live-probe passed on actual PostgreSQL: income-only grant succeeds and replays; expense creation is denied; author attribution and movement collision assertions passed.
STATUS: Implemented and verified on the actual PostgreSQL database.
```

<a id="source-docsauditsoffline_first_write_path_audit--28-read-projections-leaked-restricted-parentchild-records"></a>
##### 28. Read projections leaked restricted parent/child records

```text
MODULE: Search, reports, context/evidence, assistant, finance, operations, notifications and automation
FILE: backend/src/middleware/{visibility,read-visibility,notification-visibility}.js; backend/src/routes/{search,reports,context,assistant,transactions,sync,excel-finance,operations,experience,collaboration,automation,media-downloads}.js
CURRENT WRITE PATH: Secondary reads queried raw rows or aggregates; project membership sometimes bypassed a restricted grant. Finance export/pull and a lab-visible Note could disclose a restricted project.
WHY IT BYPASSES OFFLINE-FIRST: Authorization on the main CRUD page did not constrain alternate projections or the next synchronized snapshot.
RISK: Confidential rows, names, snippets, queue metadata and aggregate counts visible without record access.
RECOMMENDED CHANGE: Enforce stored parent-project scope in the shared visibility predicate and runtime helper; filter secondary projections before response/count/source creation; require audit authority for raw activity; recheck notification references and return read acknowledgements without body echoes.
ACTUAL CHANGE MADE: Implemented those gates. Fixed Operations middleware to resolve the stored requirement ID from its mounted path. Fixed assistant item/location SQL columns and list-locations tool signature found by the live probe.
VERIFICATION: Seven PostgreSQL probes passed on final image, including the expanded surface probe covering hidden/granted/revoked records, parent-restricted lab notes, notifications, queue, assistant, aggregate finance, disabled users and denied operations edits.
STATUS: Implemented; targeted actual PostgreSQL verification passed. High-cardinality filtered pagination/query batching is a Phase 2 performance/coverage item.
```

<a id="source-docsauditsoffline_first_write_path_audit--29-privileged-offline-authorization-was-renewed-by-permission-refresh"></a>
##### 29. Privileged offline authorization was renewed by permission refresh

```text
MODULE: Desktop authentication and local repository entry points
FILE: desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/local_db.rs
CURRENT WRITE PATH: Cached login and permission refresh could both extend offline expiry; existing admin caches could outlive the approved privileged lease.
WHY IT BYPASSES OFFLINE-FIRST: A refreshed token/permission response is not proof the cached password is still valid after a reset.
RISK: Disabled/reset credentials remain usable offline longer than the approved period.
RECOMMENDED CHANGE: Cap privileged leases at 24 hours from successful server password authentication. Never renew authentication provenance on permissions refresh; preserve pending authored work on expiry.
ACTUAL CHANGE MADE: Implemented role/capability-based lease selection and startup caps. Refresh only narrows expiry; missing/corrupt provenance fails closed. Ordinary seven-day leases remain.
VERIFICATION: Rust tests pass for expiry after 25 hours, delegated privileges, missing timestamp, repeated startup and downgrade without lease extension.
STATUS: Implemented; local SQLite tests passed. Actual disconnected credential-revocation UX remains in the Phase 3 GUI matrix.
```

<a id="source-docsauditsoffline_first_write_path_audit--30-resource-editor-copies-had-malformed-sql-and-incomplete-scope-inheritance"></a>
##### 30. Resource editor copies had malformed SQL and incomplete scope inheritance

```text
MODULE: Resource PDF and DOCX editor copies
FILE: backend/src/routes/resource-editor.js
CURRENT WRITE PATH: File-copy operations assembled mismatched INSERT columns/values and did not atomically establish restricted creator access.
WHY IT BYPASSES OFFLINE-FIRST: Server-side derived assets are online effects, but must still preserve entity identity, provenance and visibility.
RISK: Failed copy, orphaned files or an improperly visible derived record.
RECOMMENDED CHANGE: Use one transactional insertion helper, new entity UUID, inherited parent/context/visibility, derived-from ID and creator edit grant. Clean only the generated destination on failure.
ACTUAL CHANGE MADE: Replaced PDF and DOCX copy inserts with the shared helper; retained existing cleanup.
VERIFICATION: Actual PostgreSQL PDF-copy probe returned 201, correct source ID and restricted scope, with creator grant; generated test directories and rows removed. Full DOCX/image editing validation is not represented as passed.
STATUS: PDF path runtime-verified; DOCX dependency and binary staging work explicitly remain open in Phase 2.
```

<a id="source-docsauditsoffline_first_write_path_audit--31-long-offline-financelocation-cache-depended-on-bounded-tombstones"></a>
##### 31. Long-offline finance/location cache depended on bounded tombstones

```text
MODULE: Finance and Location synchronization
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts; desktop/src-tauri/src/{local_db,local_finance,local_locations}.rs
CURRENT WRITE PATH: Complete row pulls were merged using only the latest bounded tombstone batch, leaving older deleted or newly revoked rows cached.
WHY IT BYPASSES OFFLINE-FIRST: An authoritative full pull must evict missing synchronized IDs, not rely on a recent deletion tail.
RISK: Stale/deleted rows survive reconnect; revoked financial projects may remain in the synchronized cache.
RECOMMENDED CHANGE: Explicit complete-snapshot marker, validated before merge. Evict missing synchronized IDs while retaining pending authored intents. Never treat an unmarked/error response as an empty authoritative snapshot.
ACTUAL CHANGE MADE: Added snapshot_complete contract and generic retain_authorized_snapshot used by Finance and Locations. Local income/sensitive mutations now also require finance.view.
VERIFICATION: Rust regression covers 1,505 old rows, one retained server row and one pending local row. Actual PostgreSQL finance pull/project revocation and delete-tombstone probes passed.
STATUS: Implemented and verified at helper/server boundary. Recovery-only display of revoked pending work remains a cross-domain Phase 2 requirement.
```

<a id="source-docsauditsoffline_first_write_path_audit--32-json-export-silently-omitted-data-and-included-credentials"></a>
##### 32. JSON export silently omitted data and included credentials

```text
MODULE: Administrative JSON export
FILE: backend/src/routes/system.js
CURRENT WRITE PATH: Export read nonexistent experiments table, swallowed per-table errors as empty lists, and selected every users column including password_hash.
WHY IT BYPASSES OFFLINE-FIRST: A server-authoritative export must not conceal incomplete reads or broaden credentials exposure.
RISK: Misleading backup contents and unnecessary offline exposure of password hashes.
RECOMMENDED CHANGE: Correct project_experiments table; fail export on query errors; allowlist safe user columns. Treat this as a data export, not a demonstrated full backup/restore.
ACTUAL CHANGE MADE: Implemented table correction, explicit user projection and error propagation.
VERIFICATION: PostgreSQL surface probe verifies experiments array, no exported password_hash, and non-admin rejection.
STATUS: Implemented; full consistent snapshot and restore certification remain Phase 3.
```

<a id="source-docsauditsoffline_first_write_path_audit--33-backend-dependency-warnings-include-a-bundled-document-parser-risk"></a>
##### 33. Backend dependency warnings include a bundled document-parser risk

```text
MODULE: Backend dependency supply chain / DOCX conversion
FILE: backend/package-lock.json; backend/src/routes/resource-editor.js; backend/src/docx-input.js; backend/src/docx-converter.js; backend/src/docx-worker.js
CURRENT WRITE PATH: Authenticated DOCX-copy HTML -> strict reconstructed allowlist -> bounded separate converter process using pinned @turbodocx/html-to-docx 1.23.1 -> existing copy persistence.
WHY IT BYPASSES OFFLINE-FIRST: Not an outbox problem; dependency execution is part of the server-effect security boundary.
RISK: Original bundled image-size denial-of-service dependency was removed, not overridden. Conversion remains untrusted-input processing; execution, input/output and concurrency limits remain necessary. Separate newly reported dependency advisories are tracked in PHASE2_EVIDENCE.md.
RECOMMENDED CHANGE: Replace or rebuild the document conversion dependency with a maintained compatible implementation; isolate conversion with timeout/memory limits and test image parsing, remote-resource policy, invalid documents, and DOCX output. Do not blindly force a major-version override.
ACTUAL CHANGE MADE: Replaced html-to-docx; removed image-size; added HTML/image allowlist, remote-resource rejection, bounded child worker (15 seconds, 128 MiB V8 heap, two active jobs), input/output limits and error handling. Compatible proxy-addr patch 2.0.8 also applied on 2026-10-08; no forced Mammoth downgrade. October 9 corrected preProcessing to preprocessing, as required by the installed converter runtime, so already-sanitized HTML actually skips minification. Timeout/memory limits were not increased.
VERIFICATION: Five conversion tests passed on Windows and Docker, including text/table/link/image fidelity, malformed inputs, no remote requests, stuck-worker termination and recovery. Current serial backend regression 55/55 passed. See PHASE2_EVIDENCE.md for new advisory triage and GUI limits.
STATUS: Original bundled-parser blocker addressed with automated boundary tests; not unconditional dependency/security or GUI sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--34-composite-pages-and-resourcemedia-reads-lose-offline-availability"></a>
##### 34. Composite pages and resource/media reads lose offline availability

```text
MODULE: Operations, Lab Intelligence, Dashboard, Reports, Collaboration, Downloads, Resources
FILE: desktop/src/api/operations.ts; desktop/src/api/phase4.ts; desktop/src/api/experience.ts; desktop/src/api/reports.ts; desktop/src/api/collaboration.ts; desktop/src/api/mediaDownloads.ts; desktop/src/api/resources.ts; corresponding desktop/src/pages files
CURRENT WRITE PATH: Read-side companion finding, not a newly found mutation. Reports/activity/download-queue reads still use direct HTTP. Operations/intelligence/dashboard now independently settle local sources under the captured account. Desktop Resources reads native metadata without an HTTP fallback or awaited queue enrichment. Media helpers still return server URLs even when named local.
WHY IT BYPASSES OFFLINE-FIRST: Some durable authorized read projections are still absent. A server-held downloaded file is not a desktop copy. Aggregate dependency rejection and fabricated healthy workspace status are repaired, but durable per-domain cache completeness/freshness is not yet established.
RISK: Lost access to cached work, delayed loads during server pause, hidden native/permission errors, misleading zero/healthy totals and confusion between device-available versus server-only media. Exact installed-desktop failures may also involve cache/session/lease/runtime detection; not yet determined.
RECOMMENDED CHANGE: Complete the owner-approved available-section contract: durable initialization/completeness and real last-sync/pending metadata, remaining authorized local projections and explicit media location. Never invent zero or bypass permissions. Keep server execution/AI generation explicitly online-only.
ACTUAL CHANGE MADE: Shared account-guarded independent reads with five-second deadline; overview partial/unavailable states, nullable metrics and honest local-read notice; workspace failure is unknown, not healthy. Desktop Resources metadata no longer calls HTTP enrichment/fallback. Native Notes/Resources/Projects read entry points enforce domain view permission. No binary copying or new report/activity/job cache yet.
VERIFICATION: 86 combined API/static-render/mixed diagnostic tests passed; four characterization cases still assert known Reports/activity/download/media gaps. Native 37 passed, 7 ignored; explicit actual-PostgreSQL two-client comments probe passed; TypeScript and production build passed. Controlled stalled reads were tested, not real Docker stop/pause or physical GUI acceptance. See PHASE2_EVIDENCE.md.
STATUS: Partial implementation — first overview/resource read slice verified. Durable completeness/freshness, remaining remote readers and installed-desktop outage acceptance remain open. No Phase 2 sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--35-offline-session-identity-blocked-authorized-local-repositories"></a>
##### 35. Offline session identity blocked authorized local repositories

```text
MODULE: Authentication; Dashboard/Operations/Intelligence/Resources; shared local repository guards
FILE: desktop/src/App.tsx; desktop/src/api/auth.ts; desktop/src/api/http.ts; desktop/src-tauri/src/local_auth.rs
CURRENT WRITE PATH: Local login/session restore supplies a native local session; protected domain writes continue through their existing SQLite/outbox paths. Previously App removed local tokens, while captureAccountSession required a token and used a local credential-row ID instead of the central account identity.
WHY IT BYPASSES OFFLINE-FIRST: Valid offline sessions were rejected before local reads/writes. Sending a local token to a server-only feature could also receive 401 and erase frontend authorization. Late unauthorized responses could clear a newer account's session.
RISK: Cached data appears inaccessible/empty; local edits fail; wrong expected-account identity blocks native operations. This is separate from missing file replication and intentionally server-confirmed effects.
RECOMMENDED CHANGE: Normalize central identity, restore and retain a distinct local session, never transmit local credentials as server JWTs, protect asynchronous account transitions, retain native lease/permission enforcement and verify with real API downtime.
ACTUAL CHANGE MADE: Native auth responses expose central account ID; validated local auth status includes the existing local session token for restoration. Frontend normalizes older native user shapes, retains local session tokens before permission loads, uses session generations, bounds auth requests and rejects cross-account restoration. Shared HTTP rejects local tokens before transport; stale 401 cannot clear a different token. Startup restoration ignores responses after a session change.
VERIFICATION: Ten new real-adapter regression cases passed; combined frontend suite 96 passed (four known-gap characterization checks remain), native suite 38 passed / 7 opt-in tests ignored; build passed. Real API stopped: owner confirmed manual offline login; actual Tauri Resources retained 12 records after reload, Dashboard loaded counts, and native process cold restart restored Dashboard. API restored healthy. See PHASE2_EVIDENCE.md for reconnect outcome and boundaries.
STATUS: Implemented and stopped-server login/read/cold-restart slice verified. Signed/native-verified permission caching, encryption, credential revocation, throttling, clock hardening and complete account/revocation coverage remain open in the Phase 2 security addendum. No whole-phase or offline file/write-lifecycle sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--36-password-resetchange-did-not-revoke-existing-server-credentials"></a>
##### 36. Password reset/change did not revoke existing server credentials

```text
MODULE: Authentication/security; temporary resource-download authorization
FILE: backend/src/routes/auth.js; backend/src/middleware/auth.js; backend/src/routes/resources.js; backend/src/credential-version.js; backend/src/migrations/20261009_credential_versions.sql
CURRENT WRITE PATH: Server-only password change/reset and account status update commit in PostgreSQL with required audit. Previously JWTs carried only a user ID; middleware checked account activity/current role but not whether credentials had changed.
WHY IT BYPASSES OFFLINE-FIRST: These sensitive mutations correctly bypass the outbox by design (never queue passwords). The defect is missing server-session invalidation and the resulting inconsistency with the planned offline credential/security version. It is not a reason to turn password writes into local mutations.
RISK: Old server tokens and temporary file access URLs remain usable after password reset/change. Re-enabling a disabled account revives old tokens. Database outages were also misreported as invalid tokens, potentially clearing valid frontend sessions.
RECOMMENDED CHANGE: Add a monotonic database credential version; bind all session/download JWTs to the version authenticated with the password; check current version on every request. Increment transactionally on hash changes/disabling and preserve required audit rollback. Follow with native-verified cached authorization and observed-revocation handling.
ACTUAL CHANGE MADE: Additive version-zero migration and SQL trigger (password hash change or active-to-disabled transition); token claims and middleware comparison; version-bound resource URLs; self-password version recheck under row lock; explicit reauthentication-required responses; authentication DB failures return 503. Old signed tokens without a version match only version zero, never later versions. No local cache/lease mutation, token replacement, data reset or password queue was introduced.
VERIFICATION: 64 backend tests passed, including three new version/middleware tests; targeted security suite 46 passed (overlapping, not additive). Real existing PostgreSQL probe passed 33 assertions using exact disposable accounts/resources: reset/change, legacy/media token rejection, disable/re-enable, authorization denial, audit rows, transactional rollback, direct-SQL invalidation, migration repeatability and other-account isolation. See PHASE2_EVIDENCE.md for packaged image checks and service restoration.
STATUS: Server-side implementation verified. NOT end-to-end offline revocation or Phase 2 closure: cached-password replacement, observed revocation/native trust, immediate desktop reauthentication UX, offline leases/security and actual two-account desktop outage acceptance remain open.
```

<a id="source-docsauditsoffline_first_write_path_audit--37-observed-server-revocation-left-native-authorization-usable"></a>
##### 37. Observed server revocation left native authorization usable

```text
MODULE: Desktop authentication; shared HTTP; permissions; native offline session
FILE: desktop/src/api/auth.ts; desktop/src/api/http.ts; desktop/src/api/permissions.ts; desktop/src/App.tsx; desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/main.rs
CURRENT WRITE PATH: Explicit server credential revocation previously cleared frontend token/user storage only. SQLite local_users/local_session could still authorize a restored session or cached-password login. Permission refresh set is_active=1 without a captured native-session guard.
WHY IT BYPASSES OFFLINE-FIRST: Security decisions observed online were not reflected in the local authorization source of truth. This is derived authorization/device-session state, not an outbox business mutation; locking local access must never become a delete of authored data or a server delete request.
RISK: A known-revoked session could return through offline restoration. A late response or permission refresh could affect a different/newer login. Successful password change left the old local password cache usable. Auth-expired events had no App listener to leave the authenticated UI.
RECOMMENDED CHANGE: Compare-and-lock the captured account/native session after explicit revocation; clear effective local authority while preserving pending work. Separate ordinary JWT expiry and network failures. Guard permission refresh and asynchronous UI updates; commit online credential/session publication atomically. Verify restart/account races and real server outage/reconnect.
ACTUAL CHANGE MADE: Native guard capture and transactional authorization lock; locked account cannot offline-login or restore. Permission refresh requires the captured native session and cannot reactivate a locked cache. Shared HTTP/auth observe SESSION_REVOKED/ACCOUNT_DISABLED; successful password change also locks its old cache. App handles auth expiry and guards late permission results. Auth 5xx restoration retains valid native identity. Online login no longer publishes a token paired with the previous user; cached credentials/session commit together. No business/outbox/author rows deleted.
VERIFICATION: Frontend suite 104 passed (including four retained known-gap characterization tests); final native ordinary suite 41 passed / 8 ignored. All seven targeted auth tests passed with the actual PostgreSQL regression enabled after making cached-password verification/session creation atomic. TypeScript and frontend production build passed. Native disk-reopen, stale/same-account guards, second cached account and rollback verified. Actual stopped API plus owner offline login and populated desktop dashboard observed on an earlier binary. Final native runtime rebuild and complete interactive revocation acceptance remain pending. See PHASE2_EVIDENCE.md for exact scope and cleanup.
STATUS: Implemented; automated native/frontend checks passed. Interactive revocation -> stopped-server offline login denial/restart remains UNVERIFIED because the desktop was closed/minimized and computer-use input conflicted with owner activity. Native-verified positive permission caching, secure storage, throttling and clock hardening remain open. No Phase 2 closure.
```

<a id="source-docsauditsoffline_first_write_path_audit--38-renderer-supplied-offline-authority-and-missing-local-login-safeguards"></a>
##### 38. Renderer-supplied offline authority and missing local login safeguards

```text
MODULE: Native authentication, desktop login/permission refresh
FILE: desktop/src-tauri/src/native_authorization.rs; desktop/src-tauri/src/local_auth.rs; desktop/src/api/auth.ts; desktop/src/api/permissions.ts; desktop/src-tauri/{Cargo.toml,build.rs}
CURRENT WRITE PATH: cache_server_user previously trusted renderer-supplied central identity, role and permissions and minted a fresh SQLite lease. cache_server_permissions accepted arbitrary positive claims. Cached-password attempts had no persistent backoff and backward system-clock movement could prolong access.
WHY IT BYPASSES OFFLINE-FIRST: Local authorization was not rooted in a trusted native server exchange. Authorization cache writes are not domain outbox events; native verification must precede publication, not queue credentials or accept caller assertions.
RISK: A compromised renderer could grant offline authority or renew a lease. Delayed login could restore a signed-out session. Unlimited offline guessing and clock rollback weakened cached access.
RECOMMENDED CHANGE: Native password exchange and independently verified permission refresh against a fixed trusted endpoint; transactional generation guards; persistent per-account backoff and conservative clock high-water handling. Separately address secure storage, recovery and legacy cache trust.
ACTUAL CHANGE MADE: Native commands no longer accept role/grant/identity claims for login. Native HTTP uses build-time HTTPS or loopback-only HTTP origin, five-second request deadlines, no redirects/proxies and bounded response parsing. Permission refresh verifies server account and captured native session, never renews a lease, and locks observed revocation. SQLite login generations reject delayed online/offline completion. Per-account guessing backoff persists across restart; backward clock jumps beyond five minutes null leases without deleting outbox/business rows. Server credentials still reside in renderer storage; no encryption migration was performed.
VERIFICATION: Final native ordinary tests 48 passed / 9 ignored; targeted auth tests 10 passed including the actual PostgreSQL exchange/revocation fixture; the separately enabled real stopped-API native fallback/restart/expired-lease regression passed. Final frontend 105 passed; TypeScript, frontend production and native debug builds passed. See latest PHASE2_EVIDENCE.md for executable hashes and runtime limitations. Four frontend known-gap tests still characterize incomplete unrelated offline pages.
STATUS: Implemented bounded security slice, not full security/Phase 2 closure. Interactive authentication acceptance remains unverified at the sign-in screen. Encryption/recovery choice, protected token storage, CSP/direct-transport coverage, legacy authority transition and complete native repository authorization audit remain open.
```

<a id="source-docsauditsoffline_first_write_path_audit--39-reports-server-dependency-and-misleading-incomplete-totals"></a>
##### 39. Reports server dependency and misleading incomplete totals

```text
MODULE: Reports overview and CSV export (read-only projection)
FILE: desktop/src/api/reports.ts; desktop/src/api/reports-export.ts; desktop/src/pages/ReportsPage.tsx
CURRENT WRITE PATH: No domain mutation. Previously getReportsOverview always requested /reports/overview, including desktop offline use. CSV was generated in the renderer from that response.
WHY IT BYPASSES OFFLINE-FIRST: The report required a server response despite authorized local records. Missing sources could not be distinguished from empty datasets. This is a read dependency, not an outbox bypass.
RISK: No reports during API outages; incomplete data mistaken for zero; mixed quantity units added together; misleading export completeness.
RECOMMENDED CHANGE: Generate desktop projections from authorized local repositories, guard native report access/account continuity, retain partial sections, distinguish missing totals, and export explicit source/availability information.
ACTUAL CHANGE MADE: Desktop reads local project workspaces, resource metadata and the native inventory snapshot directly, with no report HTTP fallback. Native report permission is checked before/after aggregation, and account changes discard results. Task/experiment workspace failures produce partial/unavailable states. Inventory groups include units; stable IDs are counted once. UI shows unknown totals as a dash and resource charts use kind correctly. CSV now includes inventory, units, availability, generation time and local provenance; formula-like strings are escaped. Unreplicated audit aggregates are explicitly unavailable, not fabricated from modification times. Browser keeps its existing server endpoint.
VERIFICATION: Two focused permission/account-continuity checks passed. TypeScript checked as recorded in PHASE2_EVIDENCE.md. New aggregate/export/render regressions are prepared for the phase-end sweep; actual desktop outage/restart/reconnect and actual PostgreSQL comparison have NOT been run for this batch.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. Source snapshot completeness/last successful synchronization and the replicated audit ledger remain open. No database writes, reset, migrations or stock changes in this batch.
```

<a id="source-docsauditsoffline_first_write_path_audit--40-collaboration-activity-has-no-persistent-offline-read-model"></a>
##### 40. Collaboration activity has no persistent offline read model

```text
MODULE: Collaboration activity / synchronization
FILE: backend/src/routes/collaboration.js; desktop/src-tauri/src/local_activity.rs; desktop/src-tauri/src/main.rs; desktop/src/api/activity.ts; desktop/src/api/collaboration.ts; desktop/src/api/sync.ts; desktop/src/pages/CollaborationPage.tsx
CURRENT WRITE PATH: Previously desktop getActivity performed GET /collaboration/activity on every page read. New sync path downloads a complete authorized snapshot and transactionally replaces an account-scoped SQLite sync_state projection. Business/audit authoring is unchanged.
WHY IT BYPASSES OFFLINE-FIRST: No durable local activity feed; disconnected reads failed and the page displayed zero/empty labels for missing data. Projection cache writes are not authored domain mutations and deliberately create no outbox events.
RISK: Loss of offline visibility; false empty history; leakage if account/role/session boundaries or revoked cache cleanup are mishandled.
RECOMMENDED CHANGE: Separate local reads from synchronization; durable complete snapshots, native account/admin/audit/lease/session checks, atomic replacement, explicit availability and source timestamp, safe revocation eviction.
ACTUAL CHANGE MADE: Added admin/audit-protected full snapshot endpoint, native account-scoped snapshot commands, sync pull integration and local-only desktop feed reads. Full snapshot must validate before replacement; failed/incomplete/older pulls preserve previous data. Stable event UUIDs normalize; duplicates reject the snapshot rather than duplicate display rows. Confirmed permission denial clears only captured account/session projection, not authored records or server audit data. Native reads enforce admin role plus audit permission; late login/account responses are rejected. UI distinguishes restricted/not-downloaded/empty/error and displays the persisted snapshot timestamp. Notification failures no longer masquerade as zero unread.
VERIFICATION: Build/syntax and focused safety checks recorded in PHASE2_EVIDENCE.md. Full snapshot/replay/UI, actual PostgreSQL endpoint, native disk restart, API outage/reconnect and large-ledger checks are queued for the phase-end sweep, not claimed passed.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. New commands/endpoint require the rebuilt desktop/API at deployment. Whole-history snapshot transfer is intentionally complete, not a truncated 100-event cache; high-volume transfer/memory performance still needs measured acceptance. Experience activity and Reports audit aggregation are not converted by this finding.
```

<a id="source-docsauditsoffline_first_write_path_audit--41-downloads-queuesettings-server-reads-and-scheduled-write-bypass"></a>
##### 41. Downloads queue/settings server reads and scheduled-write bypass

```text
MODULE: Downloads queue/history, enqueue, shared download settings
FILE: desktop/src/api/mediaDownloads.ts; desktop/src/api/downloads-local.ts; desktop/src-tauri/src/local_downloads.rs; desktop/src-tauri/src/local_resources.rs; desktop/src-tauri/src/local_db.rs; desktop/src/api/sync.ts; desktop/src/pages/DownloadsPage.tsx; backend/src/download-settings-sync.js; backend/src/download-queue-create.js; backend/src/routes/media-downloads.js; backend/src/routes/sync.js; backend/src/migrations/20261010_download_settings_version.sql
CURRENT WRITE PATH: Previously immediate desktop enqueue appended an outbox event but had no durable visible job projection; scheduled enqueue and settings bypassed it via HTTP. Queue/settings reads always required server responses. This batch moves desktop enqueue and settings into native/account-scoped outbox transactions and local projections; browser settings use the same versioned apply function and stable HTTP retry keys.
WHY IT BYPASSES OFFLINE-FIRST: Desktop schedule/settings writes could not survive disconnection. Missing settings prevented the whole Downloads page from rendering. Server-accepted queue intents could disappear between acknowledgement and a failed refresh.
RISK: Lost offline preparation; duplicate jobs across HTTP/sync; silent shared-settings overwrites; false empty history and misleading completion/worker-control status.
RECOMMENDED CHANGE: Separate durable local intent, server acceptance, worker execution and PC file availability. Persist complete authorized queue/settings snapshots; version shared settings; make enqueue and receipts atomic with outbox state; later convert worker controls with race-safe semantics.
ACTUAL CHANGE MADE: Added complete authorized snapshot pull, native local queue/settings reads and account/session/permission guards. Pending job rows derive durably from immutable outbox intents. Both immediate and scheduled desktop enqueue use the native path; same-resource requests reuse visible active intent. HTTP and sync enqueue now share resource-row locking and active-job lookup. Shared settings gain a non-destructive version column/trigger, expected-version conflicts, same-user/device dependency receipts and HTTP idempotency. Native receipt publication and acknowledgement are atomic before ordinary sync ACK; a later failed refresh cannot erase accepted jobs/settings. Pending settings overlay server snapshots without changing them, and conflict discard restores the base projection while retaining outbox evidence. UI separates pending sync, last-known server state and server completion, keeps queue visible without settings and blocks controls on pending/conflicted job IDs. Restricted non-admin resource enqueue fails closed until native scoped edit authority is available.
VERIFICATION: TypeScript, native cargo check and backend syntax passed; two focused local-failure/no-server-fallback and account-boundary checks passed. Remaining unit/diagnostic/render suites and real PostgreSQL/outage acceptance deferred per batch policy. An opt-in actual PostgreSQL rollback probe was authored but NOT RUN. Migration NOT APPLIED; no database reset/reseed or running service deployment.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for local reads, enqueue and versioned settings only. Pause/resume/start/cancel/remove, editing an existing job, tool-status caching, binary/thumbnails replication, browser enqueue receipt replay and worker completion races remain OPEN. Do not label Downloads or Phase 2 complete. Apply migration and rebuild API/desktop together before acceptance.
```

<a id="source-docsauditsoffline_first_write_path_audit--42-existing-download-controls-bypass-the-desktop-outbox-worker-races"></a>
#### 42. Existing download controls bypass the desktop outbox; worker races

```text
MODULE: Downloads / worker / synchronization
FILE: desktop/src/api/mediaDownloads.ts; desktop/src/api/downloads-local.ts; desktop/src-tauri/src/local_downloads.rs; desktop/src-tauri/src/local_db.rs; desktop/src/pages/DownloadsPage.tsx; backend/src/download-job-control.js; backend/src/routes/media-downloads.js; backend/src/routes/sync.js; backend/src/media-downloads.js; backend/src/migrations/20261010_download_job_control_version.sql
CURRENT WRITE PATH: Desktop existing-job edits/start/pause/cancel/remove previously called HTTP directly. They now use native account-scoped SQLite outbox intents; sync and browser controls share versioned server apply with transactional idempotency receipts.
WHY IT BYPASSES OFFLINE-FIRST: Direct writes failed offline and had no durable intention or local reconciliation. Worker claim could clear a concurrent pause; resource completion and job completion were separate writes.
RISK: Lost controls, stale overwrites, duplicate retries, resurrected history, cancellation deleting completed media or claiming a false server outcome.
RECOMMENDED CHANGE: Keep pending intent separate from confirmed worker status; version controls, atomically publish receipts, enforce authorization/replay ownership and coordinate worker transitions with row locks. Preserve authored work and resource files.
ACTUAL CHANGE MADE: Added native guarded control command and immutable outbox payload with expected revision and base job; no HTTP fallback. One pending intention per canonical job, explicit conflict review instead of automatic overwrite. Shared server control apply and keyed HTTP retries; sync replay rechecks resource edit authority. Conditional worker claims, stop observer, atomic resource/job completion, late-completion outcome, per-job filenames and no cleanup on uncertain completion commit. Local pending-removal overlay and confirmed-removal tombstones; receipt revision/timestamp guards. History removal never deletes resource media.
VERIFICATION: TypeScript/native compilation, backend syntax and two focused adapter safety tests passed. Actual PostgreSQL rollback probe extended but NOT RUN. Full native persistence/receipt, HTTP replay, worker-race, permissions and real desktop Docker-outage/reconnect matrix deferred to phase-end sweep. New migration NOT APPLIED; running API/desktop NOT REDEPLOYED; no reset/reseed.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for existing-job controls, not full Downloads completion. Remaining: PC binary/thumbnail replication, tool-status cache, scoped native edit grants, browser enqueue replay, snapshot interleavings, worker crash/recovery and multi-process startup coverage. Current deployment assumes one worker process. Filesystem/DB atomicity remains a recovery boundary. See October 11 evidence checkpoint.
```

<a id="source-docsauditsoffline_first_write_path_audit--43-uploaded-video-poster-generation-and-local-preview-availability"></a>
#### 43. Uploaded-video poster generation and local preview availability

```text
MODULE: Resource media previews / project canvas / offline files
FILE: backend/src/resource-posters.js; backend/src/routes/resources.js; backend/src/storage.js; desktop/src-tauri/src/local_resource_posters.rs; desktop/src-tauri/src/local_resources.rs; desktop/src/api/resource-posters.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; desktop/src/components/VideoResourcePoster.tsx; desktop/src/components/ResourcesPanel.tsx; desktop/src/components/ResourceViewerModal.tsx; desktop/src/components/ProjectCanvas.tsx; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Uploaded video bytes went to server storage without thumbnail extraction. Cards relied on metadata-only video elements. Added derived server JPEG generation and account-scoped native JPEG cache populated after metadata sync or upload acknowledgement.
WHY IT BYPASSES OFFLINE-FIRST: A remote media URL and SQLite metadata do not supply playable bytes or a persisted preview. Metadata preload does not guarantee a decoded video frame.
RISK: Blank video cards, unavailable offline previews, stale replacement posters, cross-account or revoked preview disclosure, parser/process resource exhaustion.
RECOMMENDED CHANGE: Extract bounded previews independently of playback; replicate verified derived bytes with account/session/permission guards; render cached previews without network fallback. Treat original file replication as a separate durable transfer contract.
ACTUAL CHANGE MADE: Added protected FFmpeg poster endpoint/preparation with source fingerprint, timeout, concurrency cap, fixed local paths, protocol/container restriction and atomic JPEG publication. Added SQLite poster cache guarded by active lease/account/native session/resource revision, known visibility denial and deletion pruning. Shared preview component/hook used by Resources, panels, canvas and viewer. Missing previews remain explicit; upload success is unaffected by extraction failure. Derived cache writes intentionally have no domain outbox event.
VERIFICATION: TypeScript/native compilation and backend syntax passed; two focused adapter safety tests passed. FFmpeg fixture extraction, real upload/replacement, native restart, revocation and actual Docker-offline UI acceptance NOT RUN, deferred to the phase-end sweep. No database reset/reseed or running service deployment.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for video posters only. Full original-file/media replication, remote link/image thumbnails, binary revisions, quotas/preview retention, recoverable cache encryption and editor copies remain OPEN. Metadata-only edits currently invalidate the conservative local preview revision. See October 11 evidence checkpoint.
```

<a id="source-docsauditsoffline_first_write_path_audit--44-original-resource-binary-replication-server-transfer-foundation"></a>
#### 44. Original resource binary replication — server transfer foundation

```text
MODULE: Resources / downloaded media / device file availability
FILE: backend/src/resource-binaries.js; backend/src/routes/resource-binaries.js; backend/src/routes/resources.js; backend/src/resource-binaries.test.js; docs/architecture/resource-binary-replication.md
CURRENT WRITE PATH: Desktop metadata sync and poster cache exist, but original resource viewing still uses server URLs. New read-only manifest/chunk endpoints provide content-versioned bytes for the forthcoming native replication writer.
WHY IT BYPASSES OFFLINE-FIRST: SQLite resource rows and remote URLs are not PC file copies; original media cannot be opened offline merely because a resource card is cached.
RISK: Unavailable offline files, mixed revisions during resumed transfers, false availability, unsafe paths, stale permissions and duplicate records if replication is confused with creation.
RECOMMENDED CHANGE: Mirror authorized binaries into guarded account-scoped native storage with verified resumable transfer, atomic publication, local playback, visibility eviction and preserved authored work. Use content revisions rather than metadata timestamps.
ACTUAL CHANGE MADE: Added authenticated manifest and strict conditional chunk endpoints for server-owned uploaded/downloaded files; stable SHA-256 revisions, bounded ranges/IO/cache, per-chunk digest, replacement/path containment checks and post-IO current-authority validation. No domain mutations or outbox changes. Native transfer writer and playback are not implemented by this finding.
VERIFICATION: Nine focused filesystem/handler tests passed; syntax and whitespace checks passed. No database test was run. Docker engine is unavailable, so new endpoints are not deployed and actual PostgreSQL/desktop offline acceptance is pending. Existing databases and user files preserved.
STATUS: SERVER FOUNDATION IMPLEMENTED / AWAITING VERIFICATION. Native copies/resume/publication, guarded local playback, uploads/editor staging, quotas/retention, recovery/protected storage and full offline/reconnect verification remain OPEN. See October 11 continuation checkpoint.
```

<a id="source-docsauditsoffline_first_write_path_audit--45-desktop-authored-files-native-staging-and-outbox-publication"></a>
#### 45. Desktop-authored files — native staging and outbox publication

```text
MODULE: Resources / desktop uploads / synchronization
FILE: desktop/src-tauri/src/local_resource_uploads.rs; desktop/src/api/resource-uploads.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; backend/src/resource-upload-staging.js; backend/src/routes/resource-uploads.js; backend/src/routes/sync.js; backend/src/migrations/20261011_resource_upload_staging.sql
CURRENT WRITE PATH: Desktop single-file selection stages managed bytes, then atomically publishes SQLite metadata plus a create outbox event. Sync transfers chunks before normal server create/receipt. Browser uploads remain HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Previously desktop file creation required a multipart server request and failed offline before durable local publication.
RISK: Lost authored work, duplicate retries, partial publication, account-crossing access, unsafe paths, premature acknowledgement and missing audit provenance.
RECOMMENDED CHANGE: Durable native staging, stable IDs, atomic metadata/outbox, verified resumable transfer, transactional receipts/audit and guarded local viewing. Preserve uncertain work; no HTTP fallback.
ACTUAL CHANGE MADE: Native per-chunk authority guards, fsync/SHA-256, atomic metadata/outbox, resumable server staging, verified publication, transactional file-create audit, receipt binding, session-bound local reader and pending-sync UI. Windows URL encoding accommodated. Existing data preserved.
VERIFICATION: Native build and TypeScript passed. Seven adapter, two staging-input and nine binary filesystem/handler tests passed. Updated desktop launched with approval and responsive process confirmed. No live PostgreSQL or WebView/offline acceptance run. Docker unavailable; new migration/API deployment pending.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for single-file desktop staging. OPEN: folder/editor uploads, older server-file replication, offline poster extraction, native non-admin note/folder scoped grants, metadata-revision reconciliation, large/non-range and suffix-range viewing, recovery/quota/encryption and restart/retry/delete/two-account acceptance. Not Phase 2 completion.
```

<a id="source-docsauditsoffline_first_write_path_audit--46-folder-child-uploads-and-folder-manifests-still-required-http"></a>
#### 46. Folder child uploads and folder manifests still required HTTP

```text
MODULE: Resources / project canvas folders / file staging
FILE: desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resources.rs; desktop/src-tauri/src/main.rs; backend/src/resource-upload-staging.js
CURRENT WRITE PATH: Desktop folder children now stage into managed files and publish metadata/outbox together in a native batch transaction. Each child syncs with a stable resource/change ID through the single-file server protocol. Browser multipart behavior is unchanged. Folder manifests now read local metadata on desktop.
WHY IT BYPASSES OFFLINE-FIRST: uploadFolderFiles and getResourceManifest previously used HTTP unconditionally. Folder creation also passed snake-case parent keys to camel-case native IPC, risking an unattached folder.
RISK: Failed offline folder imports, partial local publication, incorrect project association, duplicate logical paths and unsafe relative paths.
RECOMMENDED CHANGE: Reuse native staging, preserve nested relative paths, atomically publish the selection, validate all boundaries and read the local manifest. Keep authority checks and stable identities.
ACTUAL CHANGE MADE: Native batch finalization (maximum 200 children), per-file hash/size verification and transactional outbox/metadata; preflight/native/server relative-path checks; duplicate selection/local-path rejection and serialized server sync-path checks; local manifest reads; corrected IPC parent mapping and guarded folder context. Staged bytes remain preserved on failure.
VERIFICATION: TypeScript and native cargo check passed. Thirteen frontend adapter and three server validation checks passed. Actual PostgreSQL, native transaction fault injection, Docker-offline/reconnect, two-client and WebView acceptance deferred to phase-end sweep; no mocked database substituted.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. Folder creation is separate and may leave an empty folder on failed staging. Server publication is per-file, not folder-atomic. Non-admin scoped folder grants, staging recovery, legacy browser overwrite/race behavior, editor copies and full binary replication remain OPEN.
```

<a id="source-docsauditsoffline_first_write_path_audit--47-sync-receipt-contract-and-independent-acknowledgement-2026-10-12"></a>
#### 47. Sync receipt contract and independent acknowledgement (2026-10-12)

```text
MODULE: Sync / uploads / download controls
FILE: backend/src/sync-receipts.js; backend/src/routes/sync.js; desktop/src/api/sync-receipts.ts; desktop/src/api/sync.ts
CURRENT WRITE PATH: Existing SQLite/outbox IDs are pushed or replayed; safe server receipts bind upload revisions or atomically merge download controls before the matching local ACK.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass, but the generic redacted receipt omitted native-required fields. One receipt exception prevented the entire batch from being acknowledged and hid other errors.
RISK: Already-committed work remains pending indefinitely; misleading retry state; unsafe manual clearing or re-creation would risk loss/duplicates.
RECOMMENDED CHANGE: Allowlist only receipt fields needed by native consumers, retain current authorization and historical-record redaction, and isolate each submitted change's confirmation.
ACTUAL CHANGE MADE: Minimal file ID/revision receipts; download control/settings allowlists behind existing authorization; per-change ACK/failure/conflict processing; missing/duplicate replies remain pending; unknown replies ignored; session checks and finally cleanup retained. No queue reset or new change IDs.
VERIFICATION: Seven targeted receipt regressions, nineteen related adapter/visibility checks, TypeScript check passed. Real upload replay returned original ID/revision; SQLite independently showed that upload acknowledged at 2026-10-11 18:01:55. All eight remaining deletion intents accepted by actual PostgreSQL API after finding 48; eight desktop ACKs were still pending at last read-only inspection. Computer-use approval timed out; no desktop completion claim.
STATUS: IMPLEMENTED AND DEPLOYED. Subsequent 2026-10-12 03:03 startup/read-only SQLite check confirmed ZERO pending rows, closing queue-drain confirmation. Full outage/two-client phase acceptance remains separate.
```

<a id="source-docsauditsoffline_first_write_path_audit--48-resource-deletion-blocked-by-a-canvas-content-constraint-2026-10-12"></a>
#### 48. Resource deletion blocked by a canvas content constraint (2026-10-12)

```text
MODULE: Resources / project canvas / deletion synchronization
FILE: backend/src/migrations/20261012_canvas_resource_removal.sql; backend/src/canvas-resource-removal-live-probe.mjs
CURRENT WRITE PATH: Authorized deletion through the normal sync route, PostgreSQL transaction, tombstone and stable idempotency receipt.
WHY IT BYPASSES OFFLINE-FIRST: Not a bypass. ON DELETE SET NULL on project_blocks.resource_id contradicted block_content_matches_type, causing a permanent 23514 retry for referenced resources.
RISK: One resource deletion never commits; dropping the canvas block to work around it would destroy authored layout and connectors.
RECOMMENDED CHANGE: Convert the detached canvas reference to a valid text placeholder while preserving its identity, layout, title, annotations and connectors.
ACTUAL CHANGE MADE: BEFORE UPDATE OF resource_id trigger handles FK nullification for direct or folder-cascade deletion. Existing annotation text is retained; otherwise text becomes Resource removed. No bulk data deletion or constraint relaxation.
VERIFICATION: Actual PostgreSQL rollback probe passed direct/folder-cascade deletion with preservation assertions. The originally blocked deletion succeeded and replayed successfully using its original change ID; one receipt exists. The original block remains with its ID, x/y and Resource removed text. Server healthy after migration deployment.
STATUS: IMPLEMENTED / SERVER VERIFIED. Subsequent 2026-10-12 03:03 read-only SQLite check confirmed ZERO pending rows. Offline canvas projection acceptance remains OPEN; no database reset performed.
```

<a id="source-docsauditsoffline_first_write_path_audit--49-automatic-native-resource-copies-2026-10-12"></a>
#### 49. Automatic native resource copies (2026-10-12)

```text
MODULE: Resources / offline file reads
FILE: desktop/src-tauri/src/local_resource_replication.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resource-replication.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; desktop/src/components/ResourceFileStatus.tsx; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Authorized server read → native bounded verified chunk → managed PC staging + SQLite verified offset → whole-file checksum and atomic file publication → guarded local capability reader. No business/outbox/server mutation.
WHY IT BYPASSES OFFLINE-FIRST: Previously only authored files and posters had native storage; server-only original/media bytes remained unavailable offline despite local resource metadata.
RISK: False offline availability, partial/cross-revision files, account leakage, lost progress and copy work blocking ordinary synchronization.
RECOMMENDED CHANGE: Account/session-bound native replication, trusted-origin requests, checksum/offset persistence, crash recovery, guarded reads and explicit device-copy status.
ACTUAL CHANGE MADE: Separate background coordinator and native copy commands, one 4 MiB chunk per call; native server identity and local authority checks; no redirects; bounded responses; manifest/range/revision/chunk/full-file validation; fsync/offset commit; rename recovery; derived-copy reader integration; persistent errors and PC-availability/progress cards. Authored files/outbox untouched.
VERIFICATION: TypeScript check and initial cargo check passed. Eighteen frontend coordinator/upload/folder checks, nine server binary checks, five poster/receipt checks and one native manifest validation test passed. These are focused checks, NOT native restart/resume or actual PostgreSQL outage acceptance. See PHASE2_EVIDENCE.md for build/startup checkpoint.
STATUS: IMPLEMENTED / AWAITING LIVE ACCEPTANCE. Physical derived-file reclamation, retention/quota, encryption/recovery, editor copies and large-file playback remain OPEN. Known revocation/deletion denies logical access without generating outbound deletion or removing authored work.
```

<a id="source-docsauditsoffline_first_write_path_audit--50-desktop-resource-attachment-moves-2026-10-12"></a>
#### 50. Desktop resource attachment moves (2026-10-12)

```text
MODULE: Resources / Attach-Move / project relationships
FILE: desktop/src/api/resources.ts; desktop/src-tauri/src/local_resource_attachments.rs; desktop/src-tauri/src/local_resource_replication.rs; desktop/src-tauri/src/main.rs; backend/src/resource-attachment.js; backend/src/routes/sync.js; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Desktop API → native account/session/lease/permission checks → one SQLite transaction for local attachment and resource/attach outbox intent → normal sync/idempotency route → locked PostgreSQL resource update → authorized pull.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop Attach/Move called PUT /resources/:id/attachment directly, using navigator.onLine as the only offline gate. A server outage blocked the local operation.
RISK: Missing offline writes, stale moves overwriting newer work, incorrect ownership/project references, false server success on an older deployment.
RECOMMENDED CHANGE: Typed attachment intent with confirmed resource revision, atomic local save/outbox, canonical UUIDs, stable change ID, source/destination authority and project-reference checks; no HTTP fallback or file copy/deletion.
ACTUAL CHANGE MADE: Distinct attach operation (older servers reject rather than silently ACK a metadata no-op), protocol-1 destination/revision payload, server revision conflict and parent/reference validation, native fail-closed scope checks, session-change guards, local-save UI wording. Existing verified derived bytes remain readable for the attachment-only pending intent; network copying is deferred. No authored file is removed or duplicated.
VERIFICATION: Three backend pure validation tests and six frontend folder/attachment boundary checks passed; native destination test, TypeScript check, cargo check and initial build passed. These are not database/integration acceptance. Docker API/PostgreSQL were already stopped; no outage test is claimed.
STATUS: IMPLEMENTED, LIVE ACCEPTANCE OPEN. Folder/nested moves, moving a resource with another pending change, non-admin shared/restricted/note edit-grant caching, and browser route parity remain open. Rejected/stale moves preserve the original pending intent for review; do not reset the queue or invent a new change ID to retry.
```

<a id="source-docsauditsoffline_first_write_path_audit--51-native-pdf-editor-copies-and-markdown-reads-2026-10-12"></a>
#### 51. Native PDF editor copies and Markdown reads (2026-10-12)

```text
MODULE: Resources / document editor
FILE: desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resource_attachments.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/resource-editor-copy.js; backend/src/routes/sync.js
CURRENT WRITE PATH: PDF copy: guarded native source read → new managed PC file + fsync/hash → one SQLite transaction publishing the copy, upload descriptor and resource/create_copy outbox event → existing resumable upload worker → current source authorization/revision/scope checks → PostgreSQL resource/receipt transaction. Markdown opening: bounded native verified-file read, no mutation.
WHY IT BYPASSES OFFLINE-FIRST: PDF Create Edit Copy previously called the server directly. Markdown opening also required a live server even when verified local bytes were present.
RISK: Offline failure, accidental visibility widening, lost provenance, copied bytes mistaken for a server-saved resource, stale/revoked source authorization, retries generating duplicate server resources.
RECOMMENDED CHANGE: Reuse managed upload storage and stable outbox/change identity; preserve source attachment/visibility/provenance; use a distinct guarded copy operation; keep originals immutable and unknown-authority actions fail-closed.
ACTUAL CHANGE MADE: Native PDF-copy command preserves source context/visibility, assigns a new canonical resource/change UUID, commits local publication/outbox atomically after copying, and queues resumable transfer. Server create_copy validates source revision/current edit authority and preserves derived_from_resource_id in pull. Pending copy reads check known source revocation. Markdown reads are native, UTF-8-only and capped at 4 MiB. No direct HTTP fallback. UI distinguishes queued copies from server saves.
VERIFICATION: Six backend pure validation checks, nineteen frontend boundary/upload checks, TypeScript and cargo check passed. No new database fixtures or database reset. Native PDF copy, native restart and actual PostgreSQL/offline replay acceptance remain separately tracked in PHASE2_EVIDENCE.md.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Markdown save, DOCX rendering/conversion/save, PDF replacement, missing cached edit grants and orphan/derived-file reclamation remain OPEN. Source with pending changes must sync before derivation; a missing verified PC file does not fall back to server copying. Failed staging can leave recovery bytes, never erase authored originals.
```

<a id="source-docsauditsoffline_first_write_path_audit--52-same-resource-offline-markdown-saves-2026-10-12"></a>
#### 52. Same-resource offline Markdown saves (2026-10-12)

```text
MODULE: Resources / Markdown editor / sync
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_db.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src/api/sync.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/resource-content-edit.js; backend/src/routes/resource-editor.js; backend/src/routes/sync.js; backend/src/sync-receipts.js
CURRENT WRITE PATH: Native account/session/editor guard → immutable PC version with fsync/SHA-256 → atomic SQLite resource projection + edit version + edit_content outbox → resumable bounded file transfer → current server authority/revision check → PostgreSQL file-pointer update, required audit and idempotency receipt in one transaction.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop Markdown save called PUT /resource-editor/:id/content directly; local bytes alone did not permit offline saving.
RISK: Lost disconnected edits, duplicate resources when retrying as new documents, stale editor/server overwrite, mixed-account writes, broken ordering of multiple offline saves.
RECOMMENDED CHANGE: Preserve resource UUID, assign one stable change UUID per saved version, keep immutable file bytes, chain pending saves through owned receipt revisions, and reject conflicts without deleting authored work.
ACTUAL CHANGE MADE: Dedicated native version repository and edit_content intent; no HTTP write fallback. UI captures the opened revision and preserves text on failed saves. Server locks current row, checks current edit authority, validates format/size/UTF-8, verifies predecessor user/device/resource/operation, publishes a new immutable file, then updates the existing row. Receipts expose only ID/revision. Discarding an edit conflict retires its pending edit chain but retains physical recovery files. Automatic conflict overwrite is blocked.
VERIFICATION: Rust cargo check and frontend TypeScript check passed. Backend pure validation/projection checks 12/12, frontend routing/transfer checks 22/22. These checks do not prove PostgreSQL mutation, native SQLite publication, actual offline playback/editing or two-device behavior; phase-end live matrix remains mandatory.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. UTF-8 Markdown only, max 4 MiB. Verified local source and conservative cached editor authority required. Other pending resource operations (including initial upload) must sync before content editing. Conflict version export/reapply UI, missing scoped grants, physical reclamation, DOCX conversion/save and PDF replacement remain OPEN. No database reset or authored-data deletion.
```

<a id="source-docsauditsoffline_first_write_path_audit--53-offline-pdf-replacement-and-pending-create-editor-chains-2026-10-12"></a>
#### 53. Offline PDF replacement and pending-create editor chains (2026-10-12)

```text
MODULE: Resources / PDF editor / sync dependencies
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/local_db.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resource_posters.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resource-uploads.ts; desktop/src/api/resources.ts; desktop/src/components/ResourceEditorModal.tsx; desktop/src/components/ResourceViewerModal.tsx; backend/src/resource-content-edit.js
CURRENT WRITE PATH: Captured native account/session/source revision → managed 1 MiB staging chunks → complete-size/PDF-header/SHA-256 checks → one SQLite transaction publishing version/resource/outbox → resumable edit-permission transfer → guarded PostgreSQL pointer/audit/receipt transaction.
WHY IT BYPASSES OFFLINE-FIRST: replaceResourceFile previously always constructed a multipart HTTP PUT. Newly created native files/copies also could not be edited until their initial creation synced.
RISK: Offline edit failure; overwrite/loss of original bytes; stale revision replacement; cross-account or wrong-document predecessor; repeated creation of resources; viewers showing old content despite a successful save.
RECOMMENDED CHANGE: Reuse stable same-resource content-edit versions and owned predecessor receipts. Keep staging private until finalization. Preserve existing bytes and immutable initial-create payloads. Refresh viewers by revision, not only ID.
ACTUAL CHANGE MADE: Native begin/write/finish replacement commands, 500 MiB maximum, current authority/session checks, exact chunk retries, PDF signature validation, same UUID/filename, format-specific server validation without buffering the entire PDF. UI exposes edited-file upload for derived PDF copies. Content edits may follow owned native create/create_copy or edit_content receipts; discarding a create/edit conflict retires dependent pending edit intents without deleting files. Other pending metadata/attachment mutations still block editing. Viewer reads and PDF document instances refresh on revision changes.
VERIFICATION: Backend pure validation/projection group 16/16; frontend routing/staging group 27/27; TypeScript and native compilation passed before final build. Not native-file/SQLite/PostgreSQL/outage acceptance. Full phase-end matrix must exercise create → repeated edits → replay and conflicts on actual services.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Browser compatibility replacement still uses the legacy HTTP route and is not included in desktop offline completion. No full PDF structural validation, antivirus guarantee, large-file viewer acceptance, staged-file reclamation, or revoked-account recovery claim. Originals and partial staging remain preserved.
```

<a id="source-docsauditsoffline_first_write_path_audit--54-markdown-saved-version-recovery-and-unsaved-editor-protection-2026-10-12"></a>
#### 54. Markdown saved-version recovery and unsaved editor protection (2026-10-12)

```text
MODULE: Resources / Markdown recovery
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/components/MarkdownVersionHistory.tsx; desktop/src/components/ResourceEditorModal.tsx
CURRENT WRITE PATH: Version review/export is a guarded read of the active author's managed file. Explicit Use in editor loads a reviewed draft; Save uses the ordinary same-ID SQLite/outbox path with the opened revision. No direct server recovery write.
WHY IT BYPASSES OFFLINE-FIRST: Previously preserved editor files had no user-facing retrieval path; conflict discard could leave recoverable bytes inaccessible through the normal UI.
RISK: Authored work effectively stranded; recovery that bypasses revoked permissions; accidental overwrite of current unsaved text; stale preview exported under a different session.
RECOMMENDED CHANGE: Account/resource/version-bound native history reader, digest verification, explicit preview/export/reapply, and normal conflict/permission checks on the new save.
ACTUAL CHANGE MADE: Lists latest 100 local Markdown versions with pending/confirmed/discarded intent states; validates byte size and SHA-256 before strict UTF-8 decode; rechecks account, lease and cached editor authority. Export/use rereads and reauthorizes. Loading a version requires confirmation before replacing unsaved editor text. Closing a dirty editor asks for confirmation; closing during a save is disabled. Current resource access is still required.
VERIFICATION: Frontend boundary tests exercise native history routing, resource/change/session arguments, account-switch rejection and no HTTP fallback. TypeScript/native compile checks passed. Export download behavior, visual layout, real offline version history and revoked/deleted-resource recovery require separate live acceptance; not claimed passed.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. This covers local Markdown editor versions, not PDF version export, deleted/revoked-resource recovery, another device's history, incomplete staging, or encryption/key recovery. Those retained bytes are not erased.
```

<a id="source-docsauditsoffline_first_write_path_audit--55-bounded-native-pdf-viewing-2026-10-13"></a>
#### 55. Bounded native PDF viewing (2026-10-13)

```text
MODULE: Resources / offline PDF preview
FILE: desktop/src/api/local-pdf-range.ts; desktop/src/components/ResourcePdfPreview.tsx; desktop/src/components/ResourceViewerModal.tsx; desktop/src-tauri/src/local_resource_uploads.rs
CURRENT WRITE PATH: Read-only native managed-file ranges. No resource write, outbox event, server mutation or local/server write fallback.
WHY IT BYPASSES OFFLINE-FIRST: Viewer URL loading began with a whole GET that native storage rejects above 32 MiB. An existing PC copy could therefore fail to render offline; a missing local URL could also select the server URL.
RISK: False unavailability of locally stored PDFs, unbounded buffers, mixing file versions during replacement, stale-session bytes, silent server dependence.
RECOMMENDED CHANGE: Explicit local PDF range transport, bounded reads/queue, immutable-version pinning, native authorization per read, cancellation and honest missing-copy states.
ACTUAL CHANGE MADE: Desktop PDF preview uses native URLs only; 1 MiB chunks, serial processing, 16 MiB per assembled PDF.js request, 64 queued requests and 500 MiB file cap. Checks status/range/size/revision; native opaque revision query rejects changed versions. HEAD is body-free for large files. UI reports errors and does not fall back to a server read. No data removed or mutation architecture changed.
VERIFICATION: 9 new pure transport tests, combined desktop resource tests 36/36, TypeScript and cargo check passed. Not actual WebView/database/outage acceptance; queued for the phase-end real-desktop stopped-API sweep.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Large-file generic export/download, media suffix ranges, PDF structural safety, renderer memory/load behavior and offline DOCX are not closed by this change.
```

<a id="source-docsauditsoffline_first_write_path_audit--56-desktop-session-restoration-after-local-lease-expiry-2026-10-13"></a>
#### 56. Desktop session restoration after local lease expiry (2026-10-13)

```text
MODULE: Authentication / startup / all offline-first domain reads
FILE: desktop/src/api/auth.ts; desktop/src/App.tsx; desktop/src/pages/LoginPage.tsx; desktop/src/api/auth-offline.test.mjs
CURRENT WRITE PATH: Startup reads server identity and native local session. Fresh password login alone renews the native authorization lease; business SQLite/outbox data is unchanged.
WHY IT BYPASSES OFFLINE-FIRST: A healthy server JWT was treated as sufficient for workspace restoration even when the native lease had expired. Every local domain correctly rejected reads but the UI mislabeled them unavailable.
RISK: Global misleading failures, pressure to reset intact data, or insecure lease extension as a workaround.
RECOMMENDED CHANGE: Require valid same-account native access before restoring the desktop workspace, explain reauthentication, preserve pending/authored data and the agreed lease policy.
ACTUAL CHANGE MADE: Successful server restoration now checks local_current_user, validates central identity and guards late responses. Startup shows an explicit online-sign-in notice for expired/missing access. Valid native sessions survive transient permission-refresh outages. No automatic lease renewal, native logout, data deletion or server-write fallback.
VERIFICATION: Actual read-only SQLite session showed the administrator lease expired at 2026-10-13 07:15:39 UTC while API/database/storage health was ok. Frontend auth boundary tests 23/23 and TypeScript passed; live re-login and page-load confirmation remain open.
STATUS: STARTUP FIX IMPLEMENTED. Legitimate online password sign-in is required to regain access. Mid-session expiry/draft-preserving reauthentication and full offline/reconnect acceptance remain separate work; no whole-security sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--57-docx-conversion-boundary-and-bundled-runtime-groundwork-2026-10-13"></a>
#### 57. DOCX conversion boundary and bundled-runtime groundwork (2026-10-13)

```text
MODULE: Resources / DOCX editor and preview
FILE: backend/src/docx-converter.js; backend/src/docx-worker.js; backend/src/docx-file.js; backend/src/routes/resource-editor.js; desktop/scripts/package-docx-runtime.mjs; desktop/scripts/verify-docx-runtime.mjs
CURRENT WRITE PATH: Desktop DOCX opening/saving is still direct API-backed. API preview now uses bounded disk reads and the same isolated converter service as DOCX generation. Development runtime bundle is generated separately; no native write path is claimed yet.
WHY IT BYPASSES OFFLINE-FIRST: Merely replicating original DOCX bytes does not supply a local conversion/editor pipeline; desktop getDocxHtml/saveDocxCopy still require the API.
RISK: Offline failure, parser CPU/memory failures in API, unsanitized converted markup, accidental external references, host Node dependency in a purported self-contained desktop package.
RECOMMENDED CHANGE: Owner-approved bundled isolated converter with native session/scope/revision guards, immutable managed output and atomic local copy/outbox publication. Preserve originals and stable retry identities; no server-write fallback.
ACTUAL CHANGE MADE: Isolated/sanitized bounded API preview, shared read/write worker limit, bounded file reader and environment filtering. Added development bundle generator and integrity/relocation verification. Documented native bridge/publication contract. No changes to existing desktop DOCX persistence or outbox semantics yet.
VERIFICATION: Windows converter tests 11/11. Generated bundle verified 4,082 files/110 package versions and round-tripped a formatted document outside the repo with empty PATH using its bundled Node. API rebuilt/deployed and healthy; no DB mutation tests or offline desktop acceptance claimed.
STATUS: FOUNDATION IMPLEMENTED; OFFLINE DOCX STILL OPEN. Native bridge, DOCX derived-copy sync, installer/runtime provenance/signing/notices and full actual desktop/API-stopped acceptance remain.
```

<a id="source-docsauditsoffline_first_write_path_audit--58-native-offline-docx-preview-and-copy-publication-2026-10-13"></a>
#### 58. Native offline DOCX preview and copy publication (2026-10-13)

```text
MODULE: Resources / DOCX preview, editor and copy synchronization
FILE: desktop/src-tauri/src/local_docx.rs; desktop/src/api/resources.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/docx-native-worker.js; backend/src/docx-transform.js; backend/src/resource-editor-copy.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Desktop HTML -> bundled child converter -> immutable managed DOCX -> SQLite resource/upload/request mapping plus outbox transaction -> existing resumable transfer and create_copy server receipt. Preview reads managed PC bytes. Browser compatibility retains HTTP routes.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop DOCX routes used the API even when original bytes existed on the PC. This batch removes those desktop read/write fallbacks.
RISK: Lost offline edits, duplicate copies after response loss, stale-session disclosure, changed-source copies, parser resource exhaustion or accidental host runtime dependencies.
RECOMMENDED CHANGE: Guarded pinned native worker, original-preserving copy, atomic publication, stable retry mapping, explicit server DOCX validation, no direct server fallback.
ACTUAL CHANGE MADE: Implemented native read/save commands, bounded framed protocol and Windows job/process limits, packaged runtime pin, before/after authorization and revision checks, immutable output and transactional request/copy/outbox identity. Added DOCX create_copy validation without weakening PDF validation. Replays check current file authorization and cannot resurrect a deleted copy.
VERIFICATION: 19 converter/protocol/copy-validator checks, 14 desktop adapter checks and one real native bundled-process test passed; TypeScript and debug native build passed. Initial relocated probes timed out; the final exact-entry probe passed after explicitly closing its test input handle to match Rust. Verified 4,084 files/110 package versions outside the repo with empty PATH. Updated desktop restarted with saved-edits approval; API/database/storage healthy. No database fixtures or live desktop outage acceptance implied.
STATUS: IMPLEMENTED / ACCEPTANCE OPEN. Pending-source dependency handling, broader cached record edit grants, crash recovery of unsaved drafts, installer provenance/signing/notices and real stopped-API/reconnect/replay tests remain. Phase 2 is not signed off.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-59-editor-copy-predecessor-chains-october-13-a5"></a>
#### Finding 59 — editor-copy predecessor chains (October 13; A5)

```text
MODULE: Resources / editor copies / outbox dependency handling
FILE: desktop/src-tauri/src/{local_docx,local_resource_uploads,local_resource_edits,resource_dependencies,local_db}.rs; desktop/src/api/{resource-dependencies,sync}.ts; backend/src/{resource-editor-copy,routes/sync}.js
CURRENT WRITE PATH: Verified managed source bytes → immutable copy bytes + scoped SQLite projection + outbox, with copy.previous_change_id for a pending source create/copy/content-edit → staged binary transfer → server receipt-bound authorization and copy apply.
WHY IT BYPASSES OFFLINE-FIRST: Prior copy writers did not directly bypass the outbox, but prohibited copies until source synchronization completed. Same-entity-only upload withholding/conflict retirement could not support cross-resource copy dependencies.
RISK: Offline copy unavailable; missing predecessor retries indefinitely; dependent copy applied against the wrong revision; foreign-device/account receipt or revoked source used as authority; discarded work lost if bytes were deleted.
RECOMMENDED CHANGE: Explicit immutable predecessor IDs, owner/device/source receipt verification, current access/revision checks, account-scoped dependency closure for queue/discard, and preserved authored bytes.
ACTUAL CHANGE MADE: Native PDF/DOCX source predecessor selection, server receipt resolution, bounded unconfirmed-copy ancestry authorization, transitive upload withholding, native conflict-chain blocking and explicit non-destructive dependent-intent retirement. Metadata/attachment/folder chains remain blocked, not silently treated as supported.
VERIFICATION: 16 backend validator, 18 desktop adapter/dependency and two native pure dependency-graph checks passed (36 total); TypeScript and cargo check --offline passed. No mocked or fixture database result is presented as PostgreSQL/desktop acceptance.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. Not deployed or restarted this checkpoint. A5 remains PARTIAL; full outage/reconnect/replay, cached record grants and remaining dependency types remain in the fixed checklist.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-60-native-record-edit-authority-projection-october-14-a1"></a>
#### Finding 60 — native record edit-authority projection (October 14; A1)

```text
MODULE: Resources / native editor authorization / sync-derived cache
FILE: backend/src/{resource-authority,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_resource_edits,native_authorization,local_auth,local_db,main}.rs; desktop/src/api/{resource-authority,sync}.ts
CURRENT WRITE PATH: Read-only server authority projection → native authenticated request to compiled origin → account/resource/scope/revision/exact-login-lease-bound SQLite cache. Domain edits still use immutable native files + SQLite/outbox → server reauthorization.
WHY IT BYPASSES OFFLINE-FIRST: No domain write bypass was added. Earlier native editors blocked legitimate shared/restricted access and inferred direct-project edit authority from a cached project row; they lacked a native-verified record-specific decision.
RISK: Forged renderer grants, cross-account or stale-session responses, stale positives overwriting denials, unbounded cached authority, inferred ancestor grants, or content-edit permission persisting across an unrelated scope/version change.
RECOMMENDED CHANGE: Native-only verified positive authority, bounded complete batches, session/origin/account/lease binding, explicit denial replacement, and proven content-only continuation with server-side revision/permission rechecks.
ACTUAL CHANGE MADE: Added bounded read-only authority endpoint, native fetching/validation/cache, serialized refresh, native-protocol adapter gating and direct-resource editor checks. Kept exact revision matching plus same-account/device native content-chain proof for the owner-delegated recommended lease policy. Note/folder inheritance remains denied until complete ancestor bindings exist; no new admin authority or permissions are granted offline.
VERIFICATION: 20 backend pure validator, six desktop adapter/dependency and four native pure authority/chain tests passed (30 total); TypeScript and native test-target compilation passed. No DB fixtures, Docker mutations, deployment, app restart or real offline acceptance was performed.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN; A1 remains PARTIAL. Inherited/destination authority, fresh local creation authority, wider writer audit, recovery and real PostgreSQL/offline/reconnect cases remain. Old authored bytes/outbox/version records are preserved; legacy versions without proof fail closed.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-61-complete-inherited-resource-edit-bindings-october-14-a1"></a>
#### Finding 61 — complete inherited resource edit bindings (October 14; A1)

```text
MODULE: Resources / inherited folder and note source-editor authority
FILE: backend/src/{resource-authority,middleware/resource-access,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_notes}.rs
CURRENT WRITE PATH: Server-verified complete scope chain -> native trusted-origin protocol-2 fetch -> atomic account/lease/revision-bound derived SQLite authority cache. Existing native content writes still use immutable files + SQLite/outbox -> server reauthorization.
WHY IT BYPASSES OFFLINE-FIRST: No domain bypass is introduced. Previously legitimate inherited source edits were blocked because a direct-resource grant could not prove the note/folder authority context.
RISK: Inheriting access from a partial/cyclic chain, missing notes, changed ancestor visibility/project, cross-account snapshots or an unrelated older cached context. Source editing must not imply destination creation authority.
RECOMMENDED CHANGE: Complete bounded server authorization bindings, strict native validation and comparison against scoped local ancestry, existing content-revision/lease checks, separate destination contracts.
ACTUAL CHANGE MADE: Protocol-2 negotiation and four-resource batches; two server editor checks with stable binding projection; bounded cycle-safe context query; atomic grant/context cache including grant revision and lease; native complete-chain/missing/duplicate/scope checks replacing only the non-admin inherited-source blanket prohibition. Unsupported trees above 32 records deny without data deletion. Protocol-1 response shape remains compatible.
VERIFICATION: 24 backend, seven native and six desktop pure checks passed; native test compilation and TypeScript passed. No database fixtures or PostgreSQL query acceptance; actual stopped-API desktop/restart/reconnect acceptance remains open.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1 remains PARTIAL; API-first deployment required. Destination authority, metadata/attachment/folder dependencies, new local source grants and broader authorization coverage remain. All existing bytes, outbox events and databases preserved.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-62-destination-verification-and-edit-before-move-dependency-october-14-a1a5"></a>
#### Finding 62 — destination verification and edit-before-move dependency (October 14; A1/A5)

```text
MODULE: Resources / upload and copy destinations / direct attachment moves
FILE: backend/src/{resource-destination-authority,resource-attachment,routes/sync}.js; desktop/src-tauri/src/{local_resource_destinations,local_resource_authority,local_resource_uploads,local_resource_attachments,resource_dependencies,local_projects,main}.rs; desktop/src/api/{sync,resource-dependencies}.ts
CURRENT WRITE PATH: Native-verified destination cache -> guarded native file/attachment writer -> scoped SQLite plus immutable outbox -> receipt-ordered server apply with current source/destination permissions and revision checks.
WHY IT BYPASSES OFFLINE-FIRST: Previously project file destinations trusted renderer-fed project access, note/folder file destinations blanket-blocked non-admins, and any pending source change prevented a move even when a native file predecessor existed. No direct HTTP write fallback was added.
RISK: Source authority incorrectly granting destination access, stale/foreign positive cache, missing destination cache on first sync, moves racing unsynced content, cross-device predecessor reuse or an old server silently ignoring dependencies.
RECOMMENDED CHANGE: Separate native destination grants, same lease/account/scope constraints, refresh after scope-source pulls, explicit versioned move dependencies and server receipt reauthorization.
ACTUAL CHANGE MADE: Added bounded native destination projection/cache and folder self-grant checks, replaced non-admin renderer project trust for file destinations, retained global project checks, allowed verified project-note attachments, added native predecessor capture and protocol-2 receipt resolution for a direct move after supported file creation/copy/edit. Queue graph parsing includes attachment predecessors. Unsupported later metadata/move chains still block without deleting authored work.
VERIFICATION: 33 backend pure/receipt-double tests, 12 native pure tests and eight desktop adapter/dependency/source-order checks passed; native test compilation and TypeScript passed. No fixture database, API deployment, desktop restart or Docker mutation; actual PostgreSQL/offline acceptance remains pending.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1 and A5 remain PARTIAL. Metadata/repeated-move/tree dependencies, fresh local source/destination authority and broader security coverage remain. Existing data, files and outbox preserved; API-first deployment required.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-63-native-creation-provenance-before-first-sync-october-14-a1a5"></a>
#### Finding 63 — native creation provenance before first sync (October 14; A1/A5)

```text
MODULE: Resources / native editor access to fresh authored files and copies
FILE: desktop/src-tauri/src/{local_resource_authority,resource_dependencies,local_resource_attachments}.rs
CURRENT WRITE PATH: Same-account/device native ready upload plus unsynced creation proof -> current lease/permissions/destination/source checks -> immutable native content version plus SQLite/outbox -> existing server receipt chain.
WHY IT BYPASSES OFFLINE-FIRST: No bypass introduced. Previously a non-admin's new native file needed a server edit grant before editing, even though no server resource existed yet.
RISK: Confusing renderer metadata with native authorship, extending rights to confirmed/downloaded files, hiding a copy's source, carrying rights across changed scope or using unsupported pending work as a content proof.
RECOMMENDED CHANGE: Narrow native creation provenance, current permission/lease and destination checks, preserved source ancestry, native-only content continuation; no synthetic server grant.
ACTUAL CHANGE MADE: Added ready-upload/outbox account/device/operation/ack checks, exact immutable creation record/payload validation, unchanged scope/type/source checks, conflict-aware predecessor validation and native content-chain continuation. Source moves share this guard. No file or event deletion.
VERIFICATION: All 15 targeted native tests and native test-target compilation passed, including three new pure creation-proof tests. The preceding 33 backend/eight desktop checks and TypeScript check passed (56 targeted checks total). PostgreSQL/stopped-API desktop acceptance not run.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. ACK-to-verified-server-authority interruption, unsynced destination authority, repeated metadata/move chains and full lifecycle acceptance remain. A1/A5 remain PARTIAL; not deployed.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-64-file-acknowledgement-trust-and-atomic-authority-transition-october-14-a1a5"></a>
#### Finding 64 — file acknowledgement trust and atomic authority transition (October 14; A1/A5)

```text
MODULE: Resource file create/copy/content confirmation and native authority handoff
FILE: backend/src/{resource-confirmation,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_uploads,local_resource_edits,local_db,main}.rs; desktop/src/api/{resource-confirmation,sync}.ts
CURRENT WRITE PATH: Server applies existing outbox intent -> native reads owned server receipt/current authority -> atomic scoped SQLite receipt/version/ACK/authority update. Domain payload and immutable file bytes remain unchanged.
WHY IT BYPASSES OFFLINE-FIRST: Prior renderer-provided receipt binding and generic ACK were separate operations, and edit binding rechecked mutable local edit scope. This could stall confirmation after an attachment change or strand fresh-file editing between ACK and authority refresh.
RISK: Unverified/foreign receipts retiring work, partial acknowledgement, changed-session replies, current access denial blocking historical confirmation, overwritten newer local edits or permission expansion through historical success.
RECOMMENDED CHANGE: Native trusted-origin receipt verification, exact owned native event matching, bounded batches, atomic ACK/current authority, explicit denial preservation and no renderer receipt fallback.
ACTUAL CHANGE MADE: Read-only confirmation endpoint; native same-resource pending selection and receipt validation; serialized account/session/lease/pending-work rechecks; atomic verified receipt/native version/ACK/authority storage; safe final revision projection and native creation-receipt bridge for pending content; disabled legacy renderer binders and gated generic file ACKs. Verified confirmations resolve old conflicts atomically, and delayed failure/conflict callbacks cannot reopen those confirmed file events. Confirmation never grants access based on historical success.
VERIFICATION: 37 backend, 19 native and 14 desktop targeted pure/adapter checks passed (70 total). TypeScript/native compilation passed separately. Actual PostgreSQL/offline/crash/reconnect acceptance, including late-response transaction races, is not represented by these checks.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. Not deployed; API-first coordinated build required. Remaining metadata/repeated-move/folder chains and post-move content handoff remain. Existing authored files, databases and immutable payloads preserved; no Phase 2 closure.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-65-metadata-revision-safety-and-repeated-native-resource-mutations-october-14-a1a5"></a>
#### Finding 65 — metadata revision safety and repeated native resource mutations (October 14; A1/A5)

```text
MODULE: Resources / metadata patches and direct attachment move chains
FILE: backend/src/{resource-metadata,resource-attachment,routes/sync}.js; desktop/src-tauri/src/{local_resource_attachments,local_resource_authority,local_resources,resource_dependencies,local_db}.rs; desktop/src/api/{resources,resource-dependencies}.ts
CURRENT WRITE PATH: Captured account/native session -> verified source and destination authority -> atomic local projection/native provenance/immutable outbox -> owned predecessor receipt/current server editor check/revision check -> transactional metadata/audit/idempotency apply.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass. Previous metadata writes queued a broad resource update without a record-specific native permission/revision guard; omitted fields reset existing values. A first offline move changed local scope and prevented a second move from matching the original grant.
RISK: Stale metadata overwrites, altered attachment/visibility through broad payloads, foreign or fabricated predecessors, extending source permission into a destination, stale-account writes, stranded dependent intents and duplicate audit effects.
RECOMMENDED CHANGE: One native-proven move/metadata chain, strict field patches, exact predecessor ownership, source/destination reauthorization, atomic local/outbox writes and revision-checked server effects; preserve legacy payloads instead of rewriting them.
ACTUAL CHANGE MADE: Added native mutation provenance, guarded repeated direct moves and metadata patches, captured metadata session and native capability checks, protocol-3 attachment predecessor handling, explicit edit_metadata server apply with transactional audit and monotonic revision, metadata dependency parsing and descendant discard. Unspecified fields and all saved versions remain intact. No local failure invokes HTTP.
VERIFICATION: 24 backend pure/receipt-double, 28 native pure and 23 desktop adapter/dependency checks passed (75 total). TypeScript/native compilation and diff checks passed. No actual database or stopped-API desktop acceptance in this checkpoint.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1/A5 remain PARTIAL. Partial ACKs, mixed content/create chains, post-move content, legacy intent recovery, unsynced destinations and nested-folder moves remain. API-first coordinated deployment required; no restart or data cleanup performed.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-66-durable-download-diagnostics-and-browser-enqueue-retry-identity-october-14-a6"></a>
#### Finding 66 — durable download diagnostics and browser enqueue retry identity (October 14; A6)

```text
MODULE: Downloads / server-tool observations and browser enqueue
FILE: backend/src/{media-tool-status,download-queue-http,routes/media-downloads,media-downloads}.js; desktop/src-tauri/src/local_downloads.rs; desktop/src/api/{downloads-local,mediaDownloads,download-enqueue-retry}.ts; desktop/src/pages/DownloadsPage.tsx
CURRENT WRITE PATH: Desktop queue/settings remain native SQLite + outbox. Server diagnostic observations enter the account-scoped SQLite snapshot through sync, not a domain outbox. Browser enqueue persists request identity before HTTP -> current server authorization -> transaction/advisory lock -> job/audit/owned receipt -> confirmed browser result.
WHY IT BYPASSES OFFLINE-FIRST: Previously tool inspection always contacted the server despite local queues/settings. Browser enqueue used a fresh server UUID on each attempt and deduplicated only currently active jobs, so a lost response followed by retry after completion could create another job. No desktop server-write fallback is added.
RISK: Offline diagnostic failure, unbounded diagnostic subprocesses, stale reports replacing newer observations, duplicate download jobs/audit effects, cross-account receipt replay and lost request identity after reload.
RECOMMENDED CHANGE: Optional validated timestamped native diagnostic cache with bounded probes; stable browser request UUID and transactionally stored owned receipt; current permissions on replay; keep native enqueue on the outbox.
ACTUAL CHANGE MADE: Bounded/coalesced diagnostic probes, optional snapshot projection with same-account newest-valid merge, native-only desktop tool reads and last-check labels. Browser identity persists across failures/reload and fails closed on storage errors; API now requires a key, normalizes payload, checks receipt binding and commits job/audit/receipt atomically. Existing active job reuse creates no additional creation audit. No authored data or old queued event is removed.
VERIFICATION: 24 Node pure/adapter and five native pure checks passed; native compilation passed. No actual database, browser runtime or stopped-API desktop acceptance yet. Coordinated API/browser/native deployment required.
STATUS: TWO BOUNDED SUBCHECKS IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for worker/queue/file-readiness reconciliation, completion/cancel races and tombstone/revocation cleanup. No deployment, reset or full phase sign-off.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-67-worker-attempt-ownership-and-shared-download-removal-identity-october-15-a6"></a>
#### Finding 67 — worker attempt ownership and shared download removal identity (October 15; A6)

```text
MODULE: Downloads / server worker, publication and history reconciliation
FILE: backend/src/{media-downloads,media-process,download-worker-state,download-worker-access,download-job-control,download-queue-create,routes/media-downloads}.js; backend/src/migrations/20261014_download_worker_attempt.sql; desktop/src-tauri/src/local_downloads.rs
CURRENT WRITE PATH: Existing SQLite/outbox controls -> server authorization/receipt transaction -> leased attempt claim -> attempt-fenced progress and resource/job publication -> scoped snapshot back to SQLite. History removal -> transactional tombstone -> authorized snapshot -> monotonic native removal set.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass. Startup reset every running job without ownership; old callbacks identified only a job, not an execution. History removal markers existed only on the deleting PC, so another PC could reintroduce deleted history from a late historical receipt. Worker permissions were not rechecked after enqueue.
RISK: Stolen attempts, stale progress/publication, wrong-process cancellation, overwritten or deleted attempt bytes after uncertain commit, execution under revoked access, misleading terminal-state ordering and resurrected removed history.
RECOMMENDED CHANGE: Dedicated per-job lease, immutable attempt identity, current authorization/source guards, monotonic state observations, preserved attempt files and shared permission-scoped removal markers. Never conflate deleting history with deleting a resource/file.
ACTUAL CHANGE MADE: Additive run-ID/tombstone schema; live-lease-aware recovery and serialized scheduler claims; run-ID progress/stop/publication fences; current requester checks; separate preserved attempt filenames; optional bounded thumbnails and bounded/coalesced process output; monotonic timestamps; transactional history markers/backfill from committed receipts; reject retired identities; native canonical removal union and receipt UUID normalization.
VERIFICATION: 19 Node pure/process-double and seven native pure checks passed, with native compilation/backend syntax/diff checks. Actual PostgreSQL SQL/locks, two workers, stopped-API desktop/reconnect, termination and receipt/revocation races remain NOT RUN. No migration, restart or data cleanup executed.
STATUS: TWO BOUNDED A6 SUBCHECKS IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for remaining PC-file readiness/legacy/revocation consumers. A2 owns retained-byte reclamation. Coordinated migration/API/native deployment required; stop old workers before enabling the new lease protocol.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-68-download-previews-and-pc-readiness-presentation-october-15-a6"></a>
#### Finding 68 — download previews and PC readiness presentation (October 15; A6)

```text
MODULE: Downloads / current resource PC-copy presentation
FILE: desktop/src/api/download-device-state.ts; desktop/src/pages/DownloadsPage.tsx; desktop/src/components/{DownloadResourcePreview,VideoResourcePoster}.tsx; desktop/src-tauri/src/local_resource_replication.rs
CURRENT WRITE PATH: No new domain writes. Native authorized SQLite metadata/copy observations -> desktop status and cached native poster -> display, independently of server queue completion.
WHY IT BYPASSES OFFLINE-FIRST: Download thumbnails still used direct HTTP URLs in desktop. Server completion had no per-resource PC-readiness distinction; copying observations could describe a superseded revision or different server.
RISK: Broken offline previews, misleading local readiness/progress, and briefly displaying a previous account/resource poster during effect cleanup.
RECOMMENDED CHANGE: Native-only desktop previews and account-bound observations; explicit unknown/stale states; keep server completion distinct from current-resource PC readiness.
ACTUAL CHANGE MADE: Native metadata/copy reader with account-switch guards and independent status failure; local-only desktop preview component with placeholder; history readiness labels; origin/revision-aware copy states and stale progress suppression; identity-bound poster URLs. Existing browser route retained. No new file grants, downloads, deletions or outbox mutations.
VERIFICATION: 15 TypeScript adapter/presentation checks and two Rust pure checks passed; TypeScript/native compilation passed. No real database, mounted UI, cold-restart outage or file/revocation race tests executed in this slice.
STATUS: BOUNDED A6 SUBCHECK IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for remaining consumer/legacy/revocation reconciliation. Native/frontend build deployment and phase acceptance remain pending; authored data preserved.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-69-native-confirmation-of-resource-mutations-and-partial-acknowledged-chains-october-15-a1a5"></a>
#### Finding 69 — native confirmation of resource mutations and partial acknowledged chains (October 15; A1/A5)

```text
MODULE: Resource attachment/metadata synchronization and offline continuation
FILE: backend/src/{resource-confirmation,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_db,main}.rs; desktop/src/api/{resource-confirmation,sync}.ts
CURRENT WRITE PATH: Native SQLite record + immutable mutation provenance + outbox -> server apply/owned receipt -> native fetch of exact receipt/current authority -> atomic local receipt/authority/ACK -> validated pending-chain continuation.
WHY IT BYPASSES OFFLINE-FIRST: No new domain write bypass. Attach/metadata used generic renderer-triggered ACK while file writes already had native confirmation. Removing the first pending event broke local chain provenance, blocking later authoring after a partial sync.
RISK: Unverified ACK flags mistaken for authority, lost continuity after partial ACK, metadata overwritten by receipt reconciliation, or old scope permission carried across a move.
RECOMMENDED CHANGE: Native-fetched, account/device/origin/intent/result-bound receipts; keep historical success separate from current permission. Reconstruct acknowledged predecessors without modifying queued payloads and recheck current anchor/pending destinations.
ACTUAL CHANGE MADE: Compact canonical SHA-256 receipt bindings; native mutation confirmation and atomic ACK/authority store; generic ACK guard and renderer capability check; verified-prefix chain reconstruction and latest-confirmed authority anchor. Missing/foreign/altered/legacy proof fails closed. No files or saved intentions removed.
VERIFICATION: Server confirmation 8 checks, sync adapter 5 checks and native pure digest/receipt/chain suite 32 checks passed (45 total). Native test build, cargo check, TypeScript, backend syntax and diff checks passed after retrying Windows tool stalls. Real PostgreSQL and stopped-API acceptance NOT RUN.
STATUS: BOUNDED A1/A5 SUBCHECK IMPLEMENTED — AWAITING VERIFICATION. Mixed file-prefix chains, legacy acknowledgements without native receipts, content-after-move and nested moves remain code obligations. No deployment/restart/reset.
```

<a id="source-docsauditsoffline_first_write_path_audit--finding-71-downloads-reader-and-link-to-intake-contract"></a>
##### Finding 71 — Downloads reader and link-to-intake contract

```text
MODULE: Resources / Downloads (A4/A6)
FILE: desktop/src-tauri/src/local_downloads.rs; desktop/src/api/{download-intake,downloads-local}.ts; desktop/src/components/DownloadIntake.tsx; desktop/src/pages/{ResourcesPage,DownloadsPage}.tsx
CURRENT WRITE PATH: Add link -> SQLite resource + resource outbox; Downloads derives Awaiting schedule from saved links. Schedule -> native queue transaction + download outbox -> server scheduler. Browser retains its authorized HTTP branch.
WHY IT BYPASSES OFFLINE-FIRST: Original reader ordered an account-filtered SQLite view by a nonexistent rowid; this broke local queue/settings/tools reads and enqueue. UI also made Downloads visibility depend on a second optional enqueue after link creation.
RISK: Saved links missing from Downloads, misleading missing-snapshot messages, duplicate resources on user retry, or unintended automatic worker execution if discovery is implemented as a write.
RECOMMENDED CHANGE: Read insertion order from the base outbox while preserving active-account view filters. Derive intake from saved local resources; schedule only in Downloads. Do not create jobs during reads or add resource-card recovery buttons.
ACTUAL CHANGE MADE: Fixed reader; transaction-consistent local link/job projection; UUID-normalized intake excluding downloaded resources and represented jobs; removed Resources queue buttons/checkbox. Existing links appear automatically. Native image preview consumers also fail locally without falling through to HTTP.
VERIFICATION: Initial reader fix passed actual SQLite read and rollback-only enqueue/retry tests with API stopped, and native cold-start inspection. Corrected intake has 28 focused frontend checks, TypeScript, Vite and 9 native tests passing, including actual stopped-API link-read/scheduled-retry rollback. Rebuilt native executable deployed; Resources queue buttons confirmed absent. Downloads UI acceptance blocked by automation-helper invalid window bounds; no worker/reconnect sign-off.
STATUS: BOUNDED IMPLEMENTATION, NOT A6 OR PHASE 2 SIGN-OFF. Complete server worker/reconnect/two-client acceptance remains open. See dated PHASE2_EVIDENCE.md for subsequent deployment evidence.
```

<a id="source-docsauditsoffline_first_write_path_audit--repository-coverage-register"></a>
#### Repository coverage register

<a id="source-docsauditsoffline_first_write_path_audit--finding-70-pending-file-receipts-need-exact-intent-binding"></a>
##### Finding 70 — Pending file receipts need exact intent binding

MODULE: Resources / native file synchronization confirmation (A1/A5).
FILE: `backend/src/resource-confirmation.js`, `backend/src/routes/sync.js`, `desktop/src-tauri/src/local_resource_authority.rs`.
CURRENT WRITE PATH: Immutable native upload/edit outbox -> server publication/idempotency receipt -> native confirmation -> atomic local ACK/projection/authority update.
WHY IT BYPASSES OFFLINE-FIRST: Not a new HTTP fallback; a receipt-integrity gap in the existing ACK path. Protocol 1 matched identity/operation/size but did not bind the complete historical upload intent to its saved local payload.
RISK: Same-sized mismatched content or changed predecessor intent could pass the narrower receipt check. A changed trusted origin during the request also needed a final commit check.
RECOMMENDED CHANGE: Negotiate digest-bound file confirmations, verify against the unchanged native payload, recheck origin/session/lease, and preserve original work when proof is absent. Do not infer legacy proof or rewrite pending events.
ACTUAL CHANGE MADE: Protocol 2 returns a bounded canonical payload digest for valid owned upload receipts; the native verifier checks exact payload/resource/hash/size, rejects downgrades, and rechecks origin before commit. Old clients retain protocol-1 response compatibility. No stored receipt-history migration or mixed-chain expansion in this slice.
VERIFICATION: 10 backend pure checks, 19 native authority pure checks and 5 frontend adapter checks passed; native test build, backend syntax and scoped whitespace checks passed. Actual PostgreSQL, cold restart/server-stop/reconnect and deployment NOT RUN.
STATUS: Narrow confirmation hardening IMPLEMENTED — AWAITING INTEGRATED VERIFICATION. Legacy ACK reconciliation, origin-bound historical file receipts and mixed file/mutation chains remain open; A1/A5 remain PARTIAL.

This register prevents a single grep result from being mistaken for sign-off. It covers every TypeScript file under `desktop/src/api` and the Rust local repositories as of this review. A file may appear in more than one row when it mixes paths. The numbered findings above contain the requested nine-field assessment; the register identifies where each file is assessed. Dynamic `RequestInit` wrappers and the UI call sites were also inspected, not just literal `method:` text.

| Surface | Files | Classification / finding |
| --- | --- | --- |
| Core Tauri local-first with browser HTTP branch | `budget-periods.ts`, `canvas.ts`, `engineering.ts`, `funding-sources.ts`, `items.ts`, `knowledge.ts`, `locations.ts`, `notes.ts`, `projects.ts`, `resources.ts`, `transactions.ts`, `local-inventory.ts` | SQLite/outbox for main desktop records; null and missing-snapshot guards, direct subroutes and authority gaps in findings 1, 2, 4, 6, 12, 14, 16–19. |
| Direct HTTP or mixed online operations | `automation.ts`, `collaboration.ts`, `experience.ts`, `mediaDownloads.ts`, `operations.ts`, `phase4.ts`, `purchases.ts`, `excel-finance.ts`, `excel.ts`, `system.ts` | Server-only actions and/or missing local projections/outbox in findings 3–8, 10–13, 15. Preview/calculation POSTs that do not commit records remain distinct from imports and mutations. |
| Server-authoritative identity and grants | `auth.ts`, `users.ts`, `permissions.ts` | Credential, role and grant changes intentionally require server authority; local credential/permission caches need coherent revocation in finding 9. |
| Sync and search | `sync.ts`, `search.ts` | Outbox replay/pull, retries, identity, conflict recovery and cached search in findings 16, 18, 20, 21, 23. |
| Read-only/helper modules | `context.ts`, `http.ts`, `item-sku.ts`, `local-backend.ts`, `operations-calculations.ts`, `reports.ts` | No independent domain mutation found; `http.ts` carries requests from callers and `local-backend.ts` carries IPC. |
| Direct desktop UI HTTP writes | `components/AssistantChat.tsx` | Assistant preferences, conversation delete and chat POST: findings 8 and 15. Other `components`/`pages` fetch callsites inspected here delegate writes to API modules; `ResourceViewerModal.tsx` has a file read, not a domain write. |
| Atomic local domain writers | `local_db.rs`, `local_excel.rs`, `local_finance.rs`, `local_inventory.rs`, `local_engineering.rs`, `local_knowledge.rs`, `local_locations.rs`, `local_notes.rs`, `local_projects.rs`, `local_resources.rs` | Domain changes generally write scoped SQLite state and outbox in one transaction. `local_db.rs` also writes sync metadata/cursors; `local_resources.rs` queues a download-job event without a separate local job row. Findings 1, 2, 6, 7, 14, 16–18. |
| Local writes without domain outbox | `local_inventory_cache.rs`, `local_system.rs`, `local_auth.rs`, `local_db.rs` | Inventory cache/pull and auth/session/cursor state are derived or device-local; daily-use preferences currently contain an account preference mutation without an outbox event (finding 3). Conflict-resolution outbox rewrites are finding 21. |
| Local read/projection | `local_search.rs` | No domain write; had a permission/financial projection bypass, finding 20. |

This is a **source coverage register**, not a completed runtime certification. Two-client retry, revocation, UUID collision, delete/pull and forced IPC failure matrices remain open. Any new API or Rust local module must be added here and assessed with the nine-field finding format.

<a id="source-docsauditsoffline_first_write_path_audit--earlier-verification-queue-superseded-by-phase1_evidencemd-and-the-three-phase-plan"></a>
#### Earlier verification queue (superseded by PHASE1_EVIDENCE.md and the three-phase plan)

1. Add failure-injection tests proving Tauri inventory/canvas local failures issue zero HTTP writes.
2. Against the existing PostgreSQL service, use namespaced temporary records to test stable UUID/change-id retry, duplicate rejection, delete tombstones, and local pull. Clean only test-owned records after validating exact IDs.
3. Implement and test the approved hybrid daily-preferences contract in Phase 2; ownership is recorded in docs/architecture/daily-use-preferences.md.
4. Continue the same per-mutation inventory across remaining desktop API modules and direct UI HTTP calls. This document is deliberately **not yet an exhaustive repository sign-off**.

---

<a id="source-docsauditsphase1_mutation_source_index"></a>
## Phase 1 mutation source index — 2026-10-03

Original source: `docs/audits/PHASE1_MUTATION_SOURCE_INDEX.md`. Retained historical scope/status.

<a id="source-docsauditsphase1_mutation_source_index--phase-1-mutation-source-index-2026-10-03"></a>
### Phase 1 mutation source index — 2026-10-03

Companion to `OFFLINE_FIRST_WRITE_PATH_AUDIT.md`. Generated by `node tools/audit-write-paths.mjs` with reviewed delegation rules in that script. This is a source index, not a claim that every operation has a runtime test. The evidence ledger lists exactly which runtime checks passed.

All exported desktop API routines (including reads), backend mutating route registrations, Rust SQL-writing routines, and direct UI transport calls are included. Transport wrappers are traced through their exported callers; reads/computation and sync/cache bookkeeping are deliberately distinct from business mutations. Rust SQL scanning is a candidate index, not an atomicity proof; inline/nested helper calls must be read with the containing repository. Backend route paths are router-relative; mounts are in `backend/src/index.js`.

<a id="source-docsauditsphase1_mutation_source_index--dispositions"></a>
#### Dispositions

- LOCAL_OUTBOX / LOCAL_OUTBOX_OR_CACHE / LOCAL_OUTBOX_BROWSER_HTTP: keep desktop SQLite + outbox, browser HTTP is a separate runtime branch; finish domain-specific failure matrices in Phase 2. Cache helper exceptions do not create business events.
- LOCAL_OUTBOX_REQUIRES_PROJECT: reject missing desktop project context; never fall back to HTTP.
- ONLINE_AUTHORITY: credentials, roles/grants, project approval/reservation coordination, automation execution; explicitly online. Phase 2 adds consistent UX, request idempotency and cache refresh where absent.
- PHASE2_CONVERSION_OR_SERVER_EFFECT: existing direct HTTP, file transfer/editor or delegated server workflow. Findings 4–8 and 10–15 specify the required local-intent versus online-execution split. Not an approval to call them offline-capable.
- PHASE2_HYBRID_PREFERENCES: notification preference is account-synced; volume/auto-pause are device-local.
- DERIVED_CACHE_NO_OUTBOX / AUTH_DEVICE_OR_DERIVED_CACHE / LOCAL_STATE_OR_SCHEMA: schema, authenticated cache, session, device or pull-derived state. No new business event merely for caching a server result. `local_system` account notification preference is the documented Phase 2 exception.
- SYNC_PROTOCOL / OUTBOX_APPLY / OUTBOX_OR_SYNC_METADATA: acknowledgement, retry, conflict, replay, reconciliation. Business writes require outbox; acknowledgements do not recursively enqueue events.
- SERVER_DOMAIN_ENDPOINT: server counterpart of CRUD; not proof of desktop reachability or offline conversion. Apply authorization independently of UI and mirror deletion in tombstones/full snapshots.
- READ/HELPER / READ_COMPUTE_NO_COMMIT / READ_OR_IPC: no independently classified business write; retain read projection and runtime guards.
- TEST: fixture only, never a production migration.

<a id="source-docsauditsphase1_mutation_source_index--desktop-api-operations"></a>
#### Desktop API operations

| File:line | Operation | Disposition | Literal HTTP methods |
| --- | --- | --- | --- |
| desktop/src/api/auth.ts:35 | getLocalAuthStatus | READ/HELPER | — |
| desktop/src/api/auth.ts:39 | login | ONLINE_AUTHORITY | POST |
| desktop/src/api/auth.ts:91 | register | ONLINE_AUTHORITY | POST |
| desktop/src/api/auth.ts:104 | getCurrentUser | READ/HELPER | — |
| desktop/src/api/auth.ts:142 | changePassword | ONLINE_AUTHORITY | PATCH |
| desktop/src/api/auth.ts:157 | updateProfile | ONLINE_AUTHORITY | PATCH |
| desktop/src/api/auth.ts:174 | logout | ONLINE_AUTHORITY | — |
| desktop/src/api/auth.ts:179 | setToken | ONLINE_AUTHORITY | — |
| desktop/src/api/auth.ts:183 | getToken | READ/HELPER | — |
| desktop/src/api/auth.ts:188 | captureAccountSession | READ/HELPER | — |
| desktop/src/api/auth.ts:193 | isAccountSessionCurrent | READ/HELPER | — |
| desktop/src/api/auth.ts:197 | removeToken | ONLINE_AUTHORITY | — |
| desktop/src/api/auth.ts:201 | setStoredUser | ONLINE_AUTHORITY | — |
| desktop/src/api/auth.ts:206 | getCurrentPermissions | READ/HELPER | — |
| desktop/src/api/auth.ts:243 | getStoredUser | READ/HELPER | — |
| desktop/src/api/auth.ts:248 | removeStoredUser | ONLINE_AUTHORITY | — |
| desktop/src/api/automation.ts:3 | getAutomationDue | READ/HELPER | — |
| desktop/src/api/automation.ts:4 | runAutomation | ONLINE_AUTHORITY | POST |
| desktop/src/api/budget-periods.ts:15 | getBudgetPeriods | READ/HELPER | — |
| desktop/src/api/budget-periods.ts:17 | getCurrentBudgetPeriod | READ/HELPER | — |
| desktop/src/api/budget-periods.ts:37 | createBudgetPeriod | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/budget-periods.ts:39 | updateBudgetPeriod | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/budget-periods.ts:41 | deleteBudgetPeriod | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/canvas.ts:53 | getCanvas | READ/HELPER | — |
| desktop/src/api/canvas.ts:61 | createBlock | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/canvas.ts:77 | updateBlock | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/canvas.ts:93 | deleteBlock | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/canvas.ts:100 | createConnector | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/canvas.ts:116 | deleteConnector | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/collaboration.ts:7 | getActivity | READ/HELPER | — |
| desktop/src/api/collaboration.ts:8 | getNotifications | READ/HELPER | — |
| desktop/src/api/collaboration.ts:9 | markNotificationRead | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/collaboration.ts:10 | markAllNotificationsRead | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/collaboration.ts:11 | getProjectComments | READ/HELPER | — |
| desktop/src/api/collaboration.ts:12 | createProjectComment | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/collaboration.ts:13 | deleteProjectComment | PHASE2_CONVERSION_OR_SERVER_EFFECT | DELETE |
| desktop/src/api/context.ts:8 | getProjectContext | READ/HELPER | — |
| desktop/src/api/engineering.ts:5 | getEngineeringFormulas | READ/HELPER | — |
| desktop/src/api/engineering.ts:9 | calculateEngineering | READ_COMPUTE_NO_COMMIT | POST |
| desktop/src/api/engineering.ts:13 | getCalculations | READ/HELPER | — |
| desktop/src/api/engineering.ts:17 | saveCalculation | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/engineering.ts:21 | deleteCalculation | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/engineering.ts:25 | getEngineeringTests | READ/HELPER | — |
| desktop/src/api/engineering.ts:29 | createEngineeringTest | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/engineering.ts:33 | updateEngineeringTest | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/engineering.ts:37 | deleteEngineeringTest | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/engineering.ts:41 | compareCalculations | READ/HELPER | — |
| desktop/src/api/excel-finance.ts:21 | downloadFinanceTemplate | READ/HELPER | — |
| desktop/src/api/excel-finance.ts:22 | exportFinanceExcel | READ/HELPER | — |
| desktop/src/api/excel-finance.ts:31 | previewFinanceExcel | READ_COMPUTE_NO_COMMIT | — |
| desktop/src/api/excel-finance.ts:32 | importFinanceExcel | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/excel.ts:30 | downloadInventoryTemplate | READ/HELPER | — |
| desktop/src/api/excel.ts:36 | downloadInventoryExcel | READ/HELPER | — |
| desktop/src/api/excel.ts:48 | previewInventoryExcel | READ_COMPUTE_NO_COMMIT | — |
| desktop/src/api/excel.ts:60 | importInventoryExcel | LOCAL_OUTBOX_BROWSER_HTTP | — |
| desktop/src/api/experience.ts:103 | getExperienceDashboard | READ/HELPER | — |
| desktop/src/api/experience.ts:107 | getNotifications | READ/HELPER | — |
| desktop/src/api/experience.ts:108 | markNotificationRead | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/experience.ts:109 | markAllNotificationsRead | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/experience.ts:110 | getProjectHealth | READ/HELPER | — |
| desktop/src/api/experience.ts:111 | getActivity | READ/HELPER | — |
| desktop/src/api/funding-sources.ts:15 | getFundingSources | READ/HELPER | — |
| desktop/src/api/funding-sources.ts:17 | createFundingSource | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/funding-sources.ts:19 | updateFundingSource | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/funding-sources.ts:21 | deleteFundingSource | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/http.ts:10 | apiFetch | READ/HELPER | — |
| desktop/src/api/http.ts:58 | apiUrl | READ/HELPER | — |
| desktop/src/api/http.ts:70 | getApiErrorMessage | READ/HELPER | — |
| desktop/src/api/http.ts:85 | normalizeClientError | READ/HELPER | — |
| desktop/src/api/item-sku.ts:1 | generateItemSku | READ/HELPER | — |
| desktop/src/api/item-sku.ts:11 | ensureItemSku | READ/HELPER | — |
| desktop/src/api/items.ts:9 | getItems | READ/HELPER | — |
| desktop/src/api/items.ts:10 | getItem | READ/HELPER | — |
| desktop/src/api/items.ts:12 | getItemHistory | READ/HELPER | — |
| desktop/src/api/items.ts:14 | getItemAssignmentHistory | READ/HELPER | — |
| desktop/src/api/items.ts:15 | getItemBySku | READ/HELPER | — |
| desktop/src/api/items.ts:16 | createItem | LOCAL_OUTBOX | POST |
| desktop/src/api/items.ts:17 | updateItem | LOCAL_OUTBOX | PUT |
| desktop/src/api/items.ts:18 | deleteItem | LOCAL_OUTBOX | DELETE |
| desktop/src/api/items.ts:19 | bulkUpdateItemStatus | LOCAL_OUTBOX | POST |
| desktop/src/api/items.ts:20 | bulkDeleteItems | LOCAL_OUTBOX | POST |
| desktop/src/api/items.ts:24 | getItemMovements | READ/HELPER | — |
| desktop/src/api/items.ts:25 | createItemMovement | LOCAL_OUTBOX | POST |
| desktop/src/api/items.ts:27 | getMaintenanceRecords | READ/HELPER | — |
| desktop/src/api/items.ts:28 | createMaintenanceRecord | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/items.ts:29 | updateMaintenanceRecord | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/items.ts:30 | deleteMaintenanceRecord | PHASE2_CONVERSION_OR_SERVER_EFFECT | DELETE |
| desktop/src/api/knowledge.ts:24 | getKnowledgeOverview | READ/HELPER | — |
| desktop/src/api/knowledge.ts:30 | getKnowledgeTags | READ/HELPER | — |
| desktop/src/api/knowledge.ts:40 | getFindings | READ/HELPER | — |
| desktop/src/api/knowledge.ts:41 | createFinding | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/knowledge.ts:42 | updateFinding | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/knowledge.ts:43 | deleteFinding | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/knowledge.ts:44 | getResults | READ/HELPER | — |
| desktop/src/api/knowledge.ts:45 | createResult | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/knowledge.ts:46 | updateResult | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/knowledge.ts:47 | deleteResult | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/knowledge.ts:48 | getKnowledgeRelationships | READ/HELPER | — |
| desktop/src/api/knowledge.ts:49 | createKnowledgeRelationship | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/knowledge.ts:50 | deleteKnowledgeRelationship | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/knowledge.ts:51 | searchKnowledge | READ/HELPER | — |
| desktop/src/api/local-backend.ts:39 | isLocalBackendAvailable | READ/HELPER | — |
| desktop/src/api/local-backend.ts:43 | hasLocalBackendCapability | READ/HELPER | — |
| desktop/src/api/local-backend.ts:47 | localBackendInvoke | READ/HELPER | — |
| desktop/src/api/local-inventory.ts:4 | getLocalInventorySnapshot | READ/HELPER | — |
| desktop/src/api/local-inventory.ts:5 | cacheLocalInventorySnapshot | DERIVED_CACHE_NO_OUTBOX | — |
| desktop/src/api/local-inventory.ts:6 | cacheLocalItemMovements | DERIVED_CACHE_NO_OUTBOX | — |
| desktop/src/api/local-inventory.ts:8 | createLocalInventoryItem | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:9 | updateLocalInventoryItem | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:10 | deleteLocalInventoryItem | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:11 | bulkUpdateLocalInventoryStatus | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:12 | bulkDeleteLocalInventoryItems | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:13 | getLocalItemMovements | READ/HELPER | — |
| desktop/src/api/local-inventory.ts:14 | createLocalItemMovement | LOCAL_OUTBOX | — |
| desktop/src/api/local-inventory.ts:15 | getLocalInventoryOrRemote | READ/HELPER | — |
| desktop/src/api/locations.ts:14 | getLocations | READ/HELPER | — |
| desktop/src/api/locations.ts:15 | getLocation | READ/HELPER | — |
| desktop/src/api/locations.ts:16 | createLocation | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/locations.ts:17 | updateLocation | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/locations.ts:18 | deleteLocation | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/mediaDownloads.ts:20 | getLocalMediaUrl | READ/HELPER | — |
| desktop/src/api/mediaDownloads.ts:21 | getLocalThumbnailUrl | READ/HELPER | — |
| desktop/src/api/mediaDownloads.ts:22 | getDownloadJobs | READ/HELPER | — |
| desktop/src/api/mediaDownloads.ts:23 | queueVideoDownload | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/mediaDownloads.ts:30 | updateDownloadJob | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/mediaDownloads.ts:31 | startDownloadJob | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/mediaDownloads.ts:32 | cancelDownloadJob | PHASE2_CONVERSION_OR_SERVER_EFFECT | — |
| desktop/src/api/mediaDownloads.ts:33 | removeDownloadJob | PHASE2_CONVERSION_OR_SERVER_EFFECT | DELETE |
| desktop/src/api/mediaDownloads.ts:34 | getDownloadSettings | READ/HELPER | — |
| desktop/src/api/mediaDownloads.ts:35 | saveDownloadSettings | PHASE2_CONVERSION_OR_SERVER_EFFECT | PUT |
| desktop/src/api/mediaDownloads.ts:36 | getMediaToolsStatus | READ/HELPER | — |
| desktop/src/api/mediaDownloads.ts:37 | downloadYouTubeThumbnail | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/notes.ts:19 | getNotes | READ/HELPER | — |
| desktop/src/api/notes.ts:25 | getAllTags | READ/HELPER | — |
| desktop/src/api/notes.ts:26 | getNote | READ/HELPER | — |
| desktop/src/api/notes.ts:27 | createNote | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/notes.ts:28 | updateNote | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/notes.ts:29 | deleteNote | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/notes.ts:31 | getNoteRevisions | READ/HELPER | — |
| desktop/src/api/notes.ts:32 | restoreNoteRevision | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/operations-calculations.ts:10 | findMissingBom | READ/HELPER | — |
| desktop/src/api/operations-calculations.ts:22 | enrichOutstandingRequirements | READ/HELPER | — |
| desktop/src/api/operations.ts:44 | getOperationsOverview | READ/HELPER | — |
| desktop/src/api/operations.ts:45 | getSuppliers | READ/HELPER | — |
| desktop/src/api/operations.ts:46 | createSupplier | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/operations.ts:47 | updateSupplier | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/operations.ts:48 | deleteSupplier | PHASE2_CONVERSION_OR_SERVER_EFFECT | DELETE |
| desktop/src/api/operations.ts:49 | getRequirements | READ/HELPER | — |
| desktop/src/api/operations.ts:51 | createRequirement | LOCAL_OUTBOX_REQUIRES_PROJECT | POST |
| desktop/src/api/operations.ts:52 | updateRequirement | LOCAL_OUTBOX_REQUIRES_PROJECT | PATCH |
| desktop/src/api/operations.ts:53 | deleteRequirement | LOCAL_OUTBOX_REQUIRES_PROJECT | DELETE |
| desktop/src/api/permissions.ts:9 | getCurrentUserPermissions | READ/HELPER | — |
| desktop/src/api/permissions.ts:57 | getUserPermissions | READ/HELPER | — |
| desktop/src/api/permissions.ts:63 | updateUserPermissions | ONLINE_AUTHORITY | PUT |
| desktop/src/api/phase4.ts:8 | getPhase4Items | READ/HELPER | — |
| desktop/src/api/phase4.ts:9 | getStorageContainers | READ/HELPER | — |
| desktop/src/api/phase4.ts:10 | createStorageContainer | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/phase4.ts:11 | updateStorageContainer | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/phase4.ts:12 | deleteStorageContainer | PHASE2_CONVERSION_OR_SERVER_EFFECT | DELETE |
| desktop/src/api/phase4.ts:13 | updateItemStorage | PHASE2_CONVERSION_OR_SERVER_EFFECT | PATCH |
| desktop/src/api/phase4.ts:14 | getPhase4Intelligence | READ/HELPER | — |
| desktop/src/api/projects.ts:39 | getProjects | READ/HELPER | — |
| desktop/src/api/projects.ts:40 | getProjectFinancialSummary | READ/HELPER | — |
| desktop/src/api/projects.ts:62 | getProject | READ/HELPER | — |
| desktop/src/api/projects.ts:63 | createProject | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:65 | updateProject | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/projects.ts:66 | updateProjectVisibility | ONLINE_AUTHORITY | PUT |
| desktop/src/api/projects.ts:67 | getProjectAccessGrants | READ/HELPER | — |
| desktop/src/api/projects.ts:68 | setProjectAccessGrant | ONLINE_AUTHORITY | PUT |
| desktop/src/api/projects.ts:69 | removeProjectAccessGrant | ONLINE_AUTHORITY | DELETE |
| desktop/src/api/projects.ts:70 | deleteProject | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:71 | getProjectWorkspace | READ/HELPER | — |
| desktop/src/api/projects.ts:72 | getProjectMemberCandidates | READ/HELPER | — |
| desktop/src/api/projects.ts:73 | addProjectMember | ONLINE_AUTHORITY | POST |
| desktop/src/api/projects.ts:74 | removeProjectMember | ONLINE_AUTHORITY | DELETE |
| desktop/src/api/projects.ts:75 | createProjectTask | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:76 | updateProjectTask | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/projects.ts:77 | deleteProjectTask | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:78 | createProjectExperiment | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:79 | updateProjectExperiment | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/projects.ts:80 | deleteProjectExperiment | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:81 | repeatProjectExperiment | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/projects.ts:82 | getProjectExperimentHistory | READ/HELPER | — |
| desktop/src/api/projects.ts:83 | linkProjectItem | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:84 | unlinkProjectItem | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:85 | getProjectRequirements | READ/HELPER | — |
| desktop/src/api/projects.ts:91 | createProjectRequirement | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:98 | updateProjectRequirement | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/projects.ts:105 | deleteProjectRequirement | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:113 | getProjectBom | READ/HELPER | — |
| desktop/src/api/projects.ts:114 | createProjectBomItem | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:115 | updateProjectBomItem | LOCAL_OUTBOX_OR_CACHE | PATCH |
| desktop/src/api/projects.ts:116 | deleteProjectBomItem | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:118 | getTaskExperiments | READ/HELPER | — |
| desktop/src/api/projects.ts:119 | linkTaskExperiment | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:120 | unlinkTaskExperiment | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:121 | getExperimentMeasurements | READ/HELPER | — |
| desktop/src/api/projects.ts:122 | createExperimentMeasurement | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:123 | deleteExperimentMeasurement | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:124 | getExperimentObservations | READ/HELPER | — |
| desktop/src/api/projects.ts:125 | createExperimentObservation | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:126 | deleteExperimentObservation | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:127 | getExperimentRevisions | READ/HELPER | — |
| desktop/src/api/projects.ts:129 | getTaskAttachments | READ/HELPER | — |
| desktop/src/api/projects.ts:130 | attachTaskResource | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:131 | removeTaskAttachment | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:132 | getExperimentAttachments | READ/HELPER | — |
| desktop/src/api/projects.ts:133 | attachExperimentResource | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/projects.ts:134 | removeExperimentAttachment | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/projects.ts:138 | getProjectReview | READ/HELPER | — |
| desktop/src/api/projects.ts:143 | decideProjectReview | ONLINE_AUTHORITY | POST |
| desktop/src/api/projects.ts:150 | getProjectReservations | READ/HELPER | — |
| desktop/src/api/projects.ts:155 | requestProjectReservation | ONLINE_AUTHORITY | POST |
| desktop/src/api/projects.ts:160 | decideProjectReservation | ONLINE_AUTHORITY | POST |
| desktop/src/api/projects.ts:167 | getReservationReviewQueue | READ/HELPER | — |
| desktop/src/api/projects.ts:173 | fulfillProjectReservation | ONLINE_AUTHORITY | POST |
| desktop/src/api/purchases.ts:20 | downloadPurchaseTemplate | READ/HELPER | — |
| desktop/src/api/purchases.ts:25 | previewPurchaseExcel | READ_COMPUTE_NO_COMMIT | — |
| desktop/src/api/purchases.ts:30 | importPurchaseExcel | PHASE2_CONVERSION_OR_SERVER_EFFECT | — |
| desktop/src/api/reports.ts:4 | getReportsOverview | READ/HELPER | — |
| desktop/src/api/resources.ts:23 | isLocalResourceRuntime | READ/HELPER | — |
| desktop/src/api/resources.ts:50 | getResource | READ/HELPER | — |
| desktop/src/api/resources.ts:64 | getAllResources | READ/HELPER | — |
| desktop/src/api/resources.ts:78 | getResources | READ/HELPER | — |
| desktop/src/api/resources.ts:90 | getResourceManifest | READ/HELPER | — |
| desktop/src/api/resources.ts:91 | getResourceDownloadUrl | READ/HELPER | — |
| desktop/src/api/resources.ts:92 | getResourceAccessUrl | READ/HELPER | — |
| desktop/src/api/resources.ts:93 | getResourceText | READ/HELPER | — |
| desktop/src/api/resources.ts:94 | saveResourceText | PHASE2_CONVERSION_OR_SERVER_EFFECT | PUT |
| desktop/src/api/resources.ts:95 | getDocxHtml | READ/HELPER | — |
| desktop/src/api/resources.ts:96 | saveDocxCopy | PHASE2_CONVERSION_OR_SERVER_EFFECT | PUT |
| desktop/src/api/resources.ts:97 | createPdfEditCopy | PHASE2_CONVERSION_OR_SERVER_EFFECT | POST |
| desktop/src/api/resources.ts:98 | replaceResourceFile | PHASE2_CONVERSION_OR_SERVER_EFFECT | PUT |
| desktop/src/api/resources.ts:100 | uploadFile | PHASE2_CONVERSION_OR_SERVER_EFFECT | — |
| desktop/src/api/resources.ts:107 | createFolder | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/resources.ts:115 | uploadFolderFiles | PHASE2_CONVERSION_OR_SERVER_EFFECT | — |
| desktop/src/api/resources.ts:116 | createLink | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/resources.ts:124 | attachExistingResource | PHASE2_CONVERSION_OR_SERVER_EFFECT | PUT |
| desktop/src/api/resources.ts:135 | updateResourceMetadata | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/resources.ts:143 | updateResourceVisibility | ONLINE_AUTHORITY | PUT |
| desktop/src/api/resources.ts:148 | getResourceAccessGrants | READ/HELPER | — |
| desktop/src/api/resources.ts:153 | setResourceAccessGrant | ONLINE_AUTHORITY | PUT |
| desktop/src/api/resources.ts:158 | removeResourceAccessGrant | ONLINE_AUTHORITY | DELETE |
| desktop/src/api/resources.ts:162 | deleteResource | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/search.ts:35 | globalSearch | READ/HELPER | — |
| desktop/src/api/sync.ts:31 | getSyncRuntimeState | READ/HELPER | — |
| desktop/src/api/sync.ts:32 | subscribeSyncStatus | READ/HELPER | — |
| desktop/src/api/sync.ts:34 | getPendingSyncCount | READ/HELPER | — |
| desktop/src/api/sync.ts:35 | getUnassignedSyncCount | READ/HELPER | — |
| desktop/src/api/sync.ts:36 | getUnassignedStateCount | READ/HELPER | — |
| desktop/src/api/sync.ts:37 | getSyncConflictCount | READ/HELPER | — |
| desktop/src/api/sync.ts:38 | listSyncConflicts | READ/HELPER | — |
| desktop/src/api/sync.ts:39 | resolveSyncConflict | SYNC_PROTOCOL | — |
| desktop/src/api/sync.ts:40 | syncPendingChanges | SYNC_PROTOCOL | — |
| desktop/src/api/system.ts:8 | getDailyUsePreferences | READ/HELPER | — |
| desktop/src/api/system.ts:17 | updateDailyUsePreferences | PHASE2_HYBRID_PREFERENCES | PATCH |
| desktop/src/api/system.ts:26 | getSystemHealth | READ/HELPER | — |
| desktop/src/api/system.ts:31 | downloadLabosExport | READ/HELPER | — |
| desktop/src/api/transactions.ts:48 | getTransactions | READ/HELPER | — |
| desktop/src/api/transactions.ts:69 | getTransactionSummary | READ/HELPER | — |
| desktop/src/api/transactions.ts:123 | createTransaction | LOCAL_OUTBOX_OR_CACHE | POST |
| desktop/src/api/transactions.ts:125 | updateTransaction | LOCAL_OUTBOX_OR_CACHE | PUT |
| desktop/src/api/transactions.ts:127 | deleteTransaction | LOCAL_OUTBOX_OR_CACHE | DELETE |
| desktop/src/api/users.ts:18 | getManagedUsers | READ/HELPER | — |
| desktop/src/api/users.ts:24 | createManagedUser | ONLINE_AUTHORITY | POST |
| desktop/src/api/users.ts:34 | updateManagedUser | ONLINE_AUTHORITY | PATCH |
| desktop/src/api/users.ts:44 | resetManagedUserPassword | ONLINE_AUTHORITY | POST |

<a id="source-docsauditsphase1_mutation_source_index--backend-mutation-routes"></a>
#### Backend mutation routes

| File:line | Method | Router-relative path | Disposition |
| --- | --- | --- | --- |
| backend/src/routes/assistant.js:475 | POST | '/chat' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/assistant.js:589 | PATCH | '/preferences' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/assistant.js:615 | DELETE | '/conversations/:id' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:24 | POST | '/register' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:43 | POST | '/login' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:74 | PATCH | '/me/profile' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:83 | PATCH | '/me/password' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:108 | POST | '/users' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:133 | PATCH | '/users/:id' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:158 | POST | '/users/:id/password' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/auth.js:198 | PUT | '/users/:id/permissions' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/automation.js:22 | POST | '/run' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/blocks.js:26 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/blocks.js:105 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/budget-periods.js:53 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/budget-periods.js:80 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/budget-periods.js:120 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/collaboration.js:30 | PATCH | '/notifications/:id/read' | PHASE2_CONVERSION |
| backend/src/routes/collaboration.js:38 | POST | '/notifications/read-all' | PHASE2_CONVERSION |
| backend/src/routes/collaboration.js:58 | POST | '/projects/:projectId/comments' | PHASE2_CONVERSION |
| backend/src/routes/collaboration.js:73 | DELETE | '/projects/:projectId/comments/:commentId' | PHASE2_CONVERSION |
| backend/src/routes/connectors.js:10 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:19 | POST | '/calculate' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:21 | POST | '/calculations' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:22 | DELETE | '/calculations/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:24 | POST | '/tests' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:25 | PATCH | '/tests/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/engineering.js:26 | DELETE | '/tests/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/excel-finance.js:25 | POST | '/preview' | PHASE2_CONVERSION |
| backend/src/routes/excel-finance.js:26 | POST | '/import' | PHASE2_CONVERSION |
| backend/src/routes/excel-purchases.js:23 | POST | '/preview' | PHASE2_CONVERSION |
| backend/src/routes/excel-purchases.js:24 | POST | '/import' | PHASE2_CONVERSION |
| backend/src/routes/excel.js:26 | POST | '/inventory/preview' | PHASE2_CONVERSION |
| backend/src/routes/excel.js:27 | POST | '/inventory/import' | PHASE2_CONVERSION |
| backend/src/routes/experience.js:27 | POST | '/notifications/:id/read' | PHASE2_CONVERSION |
| backend/src/routes/experience.js:35 | POST | '/notifications/read-all' | PHASE2_CONVERSION |
| backend/src/routes/funding-sources.js:59 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/funding-sources.js:88 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/funding-sources.js:130 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:51 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:61 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:77 | POST | '/:id/movements' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:100 | POST | '/bulk-status' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:110 | POST | '/bulk-delete' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/items.js:129 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:85 | POST | '/findings' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:86 | PATCH | '/findings/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:87 | DELETE | '/findings/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:89 | POST | '/results' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:90 | PATCH | '/results/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:91 | DELETE | '/results/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:93 | POST | '/relationships' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/knowledge.js:107 | DELETE | '/relationships/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/locations.js:35 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/locations.js:52 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/locations.js:73 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/maintenance.js:66 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/maintenance.js:85 | PATCH | '/:maintenanceId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/maintenance.js:108 | DELETE | '/:maintenanceId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/media-downloads.js:15 | PUT | '/settings' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/media-downloads.js:18 | POST | '/queue' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/media-downloads.js:19 | PATCH | '/queue/:id' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/media-downloads.js:22 | POST | '/queue/:id/start' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/media-downloads.js:23 | DELETE | '/queue/:id' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/media-downloads.js:27 | POST | '/:id/thumbnail' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/notes.js:47 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/notes.js:59 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/notes.js:81 | POST | '/:id/revisions/:revisionId/restore' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/notes.js:108 | PUT | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/notes.js:126 | DELETE | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/notes.js:139 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/operations.js:57 | POST | '/suppliers' | PHASE2_CONVERSION |
| backend/src/routes/operations.js:63 | PATCH | '/suppliers/:id' | PHASE2_CONVERSION |
| backend/src/routes/operations.js:67 | DELETE | '/suppliers/:id' | PHASE2_CONVERSION |
| backend/src/routes/operations.js:70 | POST | '/requirements' | PHASE2_CONVERSION |
| backend/src/routes/operations.js:71 | PATCH | '/requirements/:id' | PHASE2_CONVERSION |
| backend/src/routes/operations.js:72 | DELETE | '/requirements/:id' | PHASE2_CONVERSION |
| backend/src/routes/phase4.js:38 | POST | '/containers' | PHASE2_CONVERSION |
| backend/src/routes/phase4.js:48 | PATCH | '/containers/:id' | PHASE2_CONVERSION |
| backend/src/routes/phase4.js:60 | DELETE | '/containers/:id' | PHASE2_CONVERSION |
| backend/src/routes/phase4.js:72 | PATCH | '/items/:id/storage' | PHASE2_CONVERSION |
| backend/src/routes/project-blocks.js:58 | POST | '/:projectId/blocks' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/project-connectors.js:9 | POST | '/:projectId/connectors' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/project-workspace.js:62 | POST | '/:id/members' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:81 | DELETE | '/:id/members/:userId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:90 | POST | '/:id/tasks' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:103 | PATCH | '/:id/tasks/:taskId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:120 | DELETE | '/:id/tasks/:taskId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:127 | POST | '/:id/experiments' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:137 | PATCH | '/:id/experiments/:experimentId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:144 | POST | '/:id/experiments/:experimentId/repeat' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:159 | DELETE | '/:id/experiments/:experimentId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:183 | POST | '/:id/tasks/:taskId/experiments' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:194 | DELETE | '/:id/tasks/:taskId/experiments/:experimentId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:201 | POST | '/:id/experiments/:experimentId/measurements' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:206 | PATCH | '/:id/experiments/:experimentId/measurements/:measurementId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:209 | DELETE | '/:id/experiments/:experimentId/measurements/:measurementId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:212 | POST | '/:id/experiments/:experimentId/observations' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:213 | DELETE | '/:id/experiments/:experimentId/observations/:observationId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:217 | POST | '/:id/tasks/:taskId/attachments' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:218 | DELETE | '/:id/tasks/:taskId/attachments/:attachmentId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:220 | POST | '/:id/experiments/:experimentId/attachments' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:221 | DELETE | '/:id/experiments/:experimentId/attachments/:attachmentId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:225 | POST | '/:id/items' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:230 | DELETE | '/:id/items/:itemId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:242 | POST | '/:id/bom' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:254 | PATCH | '/:id/bom/:bomId' | PHASE2_CONVERSION |
| backend/src/routes/project-workspace.js:263 | DELETE | '/:id/bom/:bomId' | PHASE2_CONVERSION |
| backend/src/routes/projects.js:57 | POST | '/:id/reservations' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:75 | POST | '/:id/reservations/:reservationId/decision' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:106 | POST | '/:id/reservations/:reservationId/fulfill' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:171 | POST | '/:id/review' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:204 | PUT | '/:id/visibility' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:206 | PUT | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:207 | DELETE | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:209 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:210 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/projects.js:211 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resource-editor.js:79 | PUT | '/:id/content' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/resource-editor.js:110 | PUT | '/:id/docx-copy' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/resource-editor.js:134 | POST | '/:id/pdf-copy' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/resource-editor.js:145 | PUT | '/:id/file' | ONLINE_AUTHORITY_OR_EFFECT |
| backend/src/routes/resources.js:32 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:33 | POST | '/folder' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:34 | POST | '/:folderId/files' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:35 | POST | '/link' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:36 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:37 | PUT | '/:id/visibility' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:69 | PUT | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:70 | DELETE | '/:id/access-grants/:userId' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:72 | PUT | '/:id/attachment' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/resources.js:126 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/sync.js:537 | POST | '/push' | OUTBOX_APPLY |
| backend/src/routes/system.js:20 | PATCH | '/daily-preferences' | PHASE2_CONVERSION |
| backend/src/routes/transactions.js:41 | POST | '/' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/transactions.js:49 | PUT | '/:id' | SERVER_DOMAIN_ENDPOINT |
| backend/src/routes/transactions.js:58 | DELETE | '/:id' | SERVER_DOMAIN_ENDPOINT |

<a id="source-docsauditsphase1_mutation_source_index--rust-sql-writing-candidates"></a>
#### Rust SQL-writing candidates

| File:line | Routine | Disposition | Contains outbox insert | Contains transaction marker |
| --- | --- | --- | --- | --- |
| desktop/src-tauri/src/local_auth.rs:20 | ensure_auth_schema | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:80 | enforce_offline_lease_bounds | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:159 | cache_server_user | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:227 | local_login | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:273 | cache_server_permissions | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:299 | local_logout | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:321 | privileged_leases_expire_without_losing_pending_work | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_auth.rs:338 | ordinary_and_delegated_privileged_accounts_have_distinct_leases | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |
| desktop/src-tauri/src/local_db.rs:70 | canonicalize_legacy_ids | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:109 | ensure_schema | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:171 | save_local_snapshot_with_sync | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_db.rs:221 | record_sync_conflict | LOCAL_STATE_OR_SCHEMA | false | true |
| desktop/src-tauri/src/local_db.rs:227 | resolve_conflict | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_db.rs:260 | mark_changes_synced | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:262 | record_sync_failure | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:264 | apply_server_inventory_pull | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:279 | conflict_fixture | TEST | false | false |
| desktop/src-tauri/src/local_db.rs:285 | add_conflict | OUTBOX_OR_SYNC_METADATA | true | false |
| desktop/src-tauri/src/local_db.rs:291 | conflict_retry_is_immutable_and_overwrite_is_new_intent | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_db.rs:312 | outbox_stamps_active_account_and_preserves_legacy_rows | OUTBOX_OR_SYNC_METADATA | true | false |
| desktop/src-tauri/src/local_db.rs:342 | scoped_state_and_cursor_do_not_cross_accounts | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_engineering.rs:12 | ensure | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_engineering.rs:20 | save | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_engineering.rs:67 | apply_server_engineering_pull | OUTBOX_OR_SYNC_METADATA | false | true |
| desktop/src-tauri/src/local_excel.rs:14 | import_local_inventory_rows | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_finance.rs:14 | write | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_finance.rs:15 | queue | OUTBOX_OR_SYNC_METADATA | true | false |
| desktop/src-tauri/src/local_inventory.rs:14 | ensure_movement_schema | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_inventory.rs:95 | cache_local_inventory_movements | LOCAL_STATE_OR_SCHEMA | false | true |
| desktop/src-tauri/src/local_inventory.rs:145 | save_local_inventory_movement | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_inventory.rs:226 | movement_cache_migration_preserves_unowned_rows | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_inventory_cache.rs:25 | cache_local_inventory_snapshot | AUTH_DEVICE_OR_DERIVED_CACHE | false | true |
| desktop/src-tauri/src/local_knowledge.rs:11 | ensure | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_knowledge.rs:19 | save_checked | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_locations.rs:8 | ensure | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_locations.rs:17 | save_checked | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_notes.rs:16 | ensure | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_notes.rs:35 | save_checked | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_projects.rs:13 | ensure | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_projects.rs:83 | save_checked | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_resources.rs:59 | ensure_schema | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_resources.rs:81 | write_resources | LOCAL_STATE_OR_SCHEMA | false | false |
| desktop/src-tauri/src/local_resources.rs:90 | save_with_change | OUTBOX_OR_SYNC_METADATA | true | true |
| desktop/src-tauri/src/local_resources.rs:264 | queue_local_resource_download | OUTBOX_OR_SYNC_METADATA | true | false |
| desktop/src-tauri/src/local_system.rs:27 | write_preferences | AUTH_DEVICE_OR_DERIVED_CACHE | false | false |

<a id="source-docsauditsphase1_mutation_source_index--direct-ui-transport-calls"></a>
#### Direct UI transport calls

| File:line | Call | Disposition |
| --- | --- | --- |
| desktop/src/components/AssistantChat.tsx:45 | apiFetch('/assistant/conversations') | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:46 | apiFetch('/assistant/capabilities') | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:46 | apiFetch('/assistant/preferences') | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:50 | apiFetch('/assistant/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_scope:next.scope,context_project_id:next.projectId,context_tools:next.customT | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:52 | apiFetch(`/assistant/conversations/${id}`,{method:'DELETE'}) | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:53 | apiFetch(`/assistant/conversations/${id}`) | ONLINE_ASSISTANT |
| desktop/src/components/AssistantChat.tsx:57 | apiFetch('/assistant/chat',{method:'POST',body:JSON.stringify({message:trimmed,conversation_id:conversationId,context_scope:context.scope,context_project_id:context.projectId,context_tools:context.cus | ONLINE_ASSISTANT |
| desktop/src/components/ResourceViewerModal.tsx:20 | fetch(getResourceDownloadUrl(resource.id)) | READ_OR_IPC |

Counts: 267 desktop exports, 137 mutating backend routes, 45 Rust SQL-write candidates, 8 direct UI calls. Regenerate after source changes; line numbers are a snapshot, not stable identifiers.


---

<a id="source-docsauditsv1_backup_restore_runbook"></a>
## Lab pilot backup/restore readiness

Original source: `docs/audits/V1_BACKUP_RESTORE_RUNBOOK.md`. Retained historical scope/status.

<a id="source-docsauditsv1_backup_restore_runbook--lab-pilot-backuprestore-readiness"></a>
### Lab pilot backup/restore readiness

October 24: capture and isolated database restore verified; see
[primary evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_v1_backup_2026-10-24).
Full app recovery/key portability/off-device copy remain open, not release sign-off.

<a id="source-docsauditsv1_backup_restore_runbook--verified-locations"></a>
#### Verified locations

- Desktop: C:\Users\balik\AppData\Roaming\com.lab-inventory.app
  contains labos-local.db, resource-files (authored/staged files) and
  resource-copies (replicated files). Preserve any WAL/SHM files alongside them.
- PostgreSQL: labos-db-1, named volume labos_postgres.
- Server files: labos-labos-api-1:/app/storage, named volume labos_storage.
- Capture the exact candidate source/build/image identifiers separately.
- Keep deploy/.env.production and any additional encryption/recovery keys in
  separate owner-controlled protected storage. Never print or commit secrets.

<a id="source-docsauditsv1_backup_restore_runbook--capture-procedure"></a>
#### Capture procedure

1. Choose a private, access-controlled backup destination outside the repository
   and outside live app data. Prefer an encrypted disk, with a second offline
   copy. The backup contains credentials/session material and authored content;
   the capture script does not encrypt it or claim portable key recovery.
2. Save all edits; close the desktop normally (including tray instance). Confirm
   all other LabOS clients/direct database writers are quiesced. Stop only the API
   to stop sync and media workers. Keep PostgreSQL running; never remove volumes.
3. Run deploy/scripts/backup-lab-pilot.ps1 with explicit DesktopData and a new
   Destination. Default mode is read-only planning. Capture additionally requires
   -Capture -WritesQuiesced and refuses a running API or detected desktop process.
4. The script copies the entire desktop data tree, uses pg_dump custom format,
   checks the dump catalog, copies the server storage tree from the stopped API
   and writes size/SHA-256 metadata. It leaves a uniquely named staging dump in
   the database container; remove only that exact file after verified off-device
   backup in a separately reviewed cleanup. No source files are deleted.
5. On failure, retain the partial directory for diagnosis; it is not a completed
   backup. Choose another new destination on retry. Restore prior service state
   explicitly, verify health, and reopen the desktop only after capture completes.

<a id="source-docsauditsv1_backup_restore_runbook--isolated-restore-drill-still-to-implement-and-execute"></a>
#### Isolated restore drill — still to implement and execute

- Never run the existing restore-postgres.sh against live PostgreSQL for testing:
  it uses --clean against the configured database.
- Verify every manifest entry's size/hash, rejecting missing/changed files.
- Restore postgres.dump into a NEW isolated PostgreSQL instance/database, with
  matching major version and no API/worker connected; inspect schema and relevant
  project/resource/outbox linkage counts without exposing private records.
- Copy desktop-data into a separate verification directory. Use SQLite integrity
  and foreign-key checks on the copy, retaining WAL/SHM handling. Verify authored
  pending payloads, source references and managed file hashes. Do not boot a
  copied logged-in app against the live API: it may replay real queued changes.
- Validate server-file references against restored server storage; separately
  identify missing bytes versus external link-only resources.
- Test access to required secrets/keys under the intended recovery scenario;
  same-PC readability is not proof of replacement-PC recovery.
- Record evidence and exact paths. Do not overwrite the user's current databases
  or storage, and do not clean up test data using broad/globbed deletes.

<a id="source-docsauditsv1_backup_restore_runbook--limitations"></a>
#### Limitations

PowerShell syntax validation and default PLAN ONLY execution passed against the
actual desktop path and Docker mounts. The plan observed API running and zero
matching desktop processes; it copied nothing and changed no service state.
Capture and an isolated database restore subsequently passed as recorded above.
In general, pg_restore --list and
hashes are integrity checks, not proof of a successful restore. Desktop process
name checks are a guard, not proof that every writer is stopped; the explicit
quiescence assertion remains necessary. Custom server storage mounts require
manual review. Capture does not include unknown external files or secrets.

---

<a id="source-docsauditsv1_clean_personal_setup"></a>
## Clean personal V1 setup — 2026-10-26

Original source: `docs/audits/V1_CLEAN_PERSONAL_SETUP.md`. Retained historical scope/status.

<a id="source-docsauditsv1_clean_personal_setup--clean-personal-v1-setup-2026-10-26"></a>
### Clean personal V1 setup — 2026-10-26

<a id="source-docsauditsv1_clean_personal_setup--user-approved-scope"></a>
#### User-approved scope

Separate clean V1; only balika administrator; no sample lab records. Preserve all existing development databases, storage, and pending work. Do not remove the old zero-byte resource. This is a personal-use milestone, not a claim that all Phase 2 acceptance is complete.

<a id="source-docsauditsv1_clean_personal_setup--isolation-contract"></a>
#### Isolation contract

| Component | Daily-use V1 | Existing development |
| --- | --- | --- |
| Compose project | labos-v1 | labos |
| API | http://localhost:4010/api (loopback binding) | port 4000 |
| PostgreSQL volume | labos_v1_postgres | labos_postgres |
| Storage volume | labos_v1_storage | labos_storage |
| Desktop identifier | com.lab-inventory.app.v1 | com.lab-inventory.app |
| Desktop title | LabOS V1 — Personal Lab | Lab Inventory Management |
| SQLite directory | %APPDATA%/com.lab-inventory.app.v1 | %APPDATA%/com.lab-inventory.app |

The V1 API is pinned by image ID in deploy/docker-compose.v1.yml, with no build directive. V2 source edits must not update that image, V1 configuration, or V1 data. The desktop build sets BOTH VITE_API_BASE_URL and LABOS_NATIVE_API_BASE. The overlay alone does not set the API endpoint; use desktop/scripts/build-v1.ps1.

<a id="source-docsauditsv1_clean_personal_setup--daily-startup"></a>
#### Daily startup

1. Start Docker Desktop and wait for its engine to be ready.
2. From this repository run `powershell -NoProfile -File deploy/scripts/start-v1.ps1`.
3. Launch the installed **LabOS V1** application, not the development shortcut.

Normal startup does not compile anything. A running server is required for first login and server download execution. Offline work remains subject to the existing login lease and local-copy availability contracts.

<a id="source-docsauditsv1_clean_personal_setup--credentials-and-backups"></a>
#### Credentials and backups

The requested balika administrator was created through first-account registration. Its previously supplied password was used; change it for daily use. No test account was copied. V1 has independent randomly generated service/JWT secrets in ignored deploy/.env.v1. Never commit or publish that file. AI provider configuration was not copied from development.

Back up the V1 PostgreSQL volume, storage volume, desktop app-data directory, and protected service configuration together. The existing Oct25 pilot backup covers the OLD environment, not V1. Do not run the old backup procedure unchanged: it targets the development names. Do not run `docker compose down -v`, prune volumes, or reset either environment.

After first desktop launch, this command previews a backup without closing apps or changing data (choose a new destination each time):

```powershell
./deploy/scripts/backup-lab-pilot.ps1 `
  -DesktopData "$env:APPDATA/com.lab-inventory.app.v1" `
  -Destination 'C:/Users/balik/LabOS-Backups/v1-personal-YYYYMMDD' `
  -ApiContainer labos-v1-api-1 -DatabaseContainer labos-v1-db-1 `
  -ExpectedStorageVolume labos_v1_storage -ServerConfig ./deploy/.env.v1
```

For capture, save and close all LabOS desktop instances, ensure there are no other writers, stop only V1 API (`docker compose -f deploy/docker-compose.v1.yml stop api`), and run the same command with `-Capture -WritesQuiesced`. Leave its PostgreSQL running. Restart V1 with the startup script afterward, including if capture fails. Capture is not a restore verification; keep an independent protected/off-device copy. Windows-protected keys may require the owner-held recovery procedure for another PC.

<a id="source-docsauditsv1_clean_personal_setup--evidence-and-remaining-handoff"></a>
#### Evidence and remaining handoff

October26 owner follow-up: personal use started; original Phase2 development is
resuming separately. Missing/generic desktop shortcut icon is recorded for later
Phase3 packaging polish; owner explicitly deferred its repair. No final offline/
reconnect acceptance has been claimed. A subsequent blank-date project sync error
is diagnosed in `../handoffs/phase2-parallel/PRIMARY_PROJECT_BLANK_DATE_2026-10-26.md`;
the two pending authored updates remain intact. Historical zero-record counts below
describe initialization, not today's now-used V1 database.

- Fresh migrations completed successfully.
- API, database and storage health passed on port4010 at 2026-10-26T01:51:13Z.
- Before registration: users=0, projects=0, items=0, resources=0.
- Registration returned balika, admin, active=true. Tokens were not printed.
- Separate installer build passed (native optimized compilation 23m11s; one unused-function warning). NSIS packaging finished at 2026-10-26 02:34 UTC.
- Installer: `desktop/src-tauri/target/release/bundle/nsis/LabOS V1_2.2.1_x64-setup.exe`, 31,835,005 bytes. SHA256: `0B781B522EBEF0718DEA0F92617FCF1B49E81F812E7C6157949788B1EE9357BA`.
- Generated frontend contains the port4010 API endpoint and not the old port4000 API endpoint.
- User approved installation; installation completed and the installed `LabOS V1.exe` opened with title `LabOS V1 — Personal Lab` at the sign-in screen. No credentials were entered through UI automation.
- Fresh SQLite file verified at `C:/Users/balik/AppData/Roaming/com.lab-inventory.app.v1/labos-local.db`, created 2026-10-26 02:43:41 UTC, 184,320 bytes before login. Separate identifier/path verified; table-level and offline/reconnect smoke tests remain pending.
- Observed installed executable path: `C:/Users/balik/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/LabOS V1/LabOS V1.exe`. Installer inherited the host's redirected LocalAppData location. Use the actual installed shortcut/path; do not assume `AppData/Local/LabOS V1`.
- V1 API/database/storage health rechecked successfully at 2026-10-26T02:42:13Z.
- No existing databases or files were cleared or moved. No reset or existing outbox edits were performed.
- Internal package version remains 2.2.1; V1 is the personal-use milestone name.

---

<a id="source-docsauditsv1_lab_pilot_release"></a>
## V1 controlled lab pilot — approved October 24, 2026

Original source: `docs/audits/V1_LAB_PILOT_RELEASE.md`. Retained historical scope/status.

<a id="source-docsauditsv1_lab_pilot_release--v1-controlled-lab-pilot-approved-october-24-2026"></a>
### V1 controlled lab pilot — approved October 24, 2026

<a id="source-docsauditsv1_lab_pilot_release--october-26-superseding-handoff"></a>
#### October 26 superseding handoff

This document preserves the original pilot gates and evidence; its October24
same-identity/no-fresh-install instructions are historical. The owner subsequently
approved a **separate clean personal V1**, now installed with an independent app
identity, PostgreSQL, SQLite and storage. Existing development data was retained.
Current setup and remaining acceptance: [V1_CLEAN_PERSONAL_SETUP.md](REFERENCE.md#source-docsauditsv1_clean_personal_setup).
Installation is not full release-gate or Phase2 sign-off. The owner has returned
development to [PHASE2_DELIVERY_CHECKLIST.md](PLAN.md#source-docsauditsphase2_delivery_checklist).

Owner: lab owner. Delivery/review: LABOS-P2-PRIMARY.
Target: Sunday, October 25, 2026, Africa/Accra. Target is conditional on safety
gates, not permission to ship a known data-loss or authorization defect.
Audience: owner's own lab, not public distribution.

<a id="source-docsauditsv1_lab_pilot_release--scope-decision"></a>
#### Scope decision

The owner approved a narrower V1 pilot rather than full Phase 2 completion.
Core inventory, projects, notes, resources/downloads, offline persistence and
reconnect must be usable. Existing financial effects must remain correct.
Preserve the current PostgreSQL, desktop SQLite/outbox, storage and authored work.
No reset, fresh install over existing data, or automatic legacy-data reassignment.
This supersedes the older V1 architecture document's fresh-install assumption.

V1 is a delivery milestone, not a request to change repository version 2.2.1 to
1.0.0. Do not renumber, tag, push or publish merely because pilot scope is approved.
Keep current application identities; do not point Preview at live SQLite.

Phase 2's A1–C6 IDs remain the complete backlog. Pilot acceptance is not closure
of all 18 items. Deferred commitments are retained, not deleted or relabelled done.

<a id="source-docsauditsv1_lab_pilot_release--release-gates"></a>
#### Release gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Data protection (A2) | Consistent PostgreSQL + server storage + desktop SQLite/pending events + desktop authored files backup; required key/config inventory without secret disclosure; hashes and restore into an isolated target; documented rollback | Captured dataset/hash/SQLite/isolated PostgreSQL restore PASS October 24; full app recovery, key portability and off-device copy remain open |
| Core correctness (B1/B3/B4/B5/B6) | Inventory quantities, issue/return/consumption, project/task/experiment links, notes and financial effects pass on candidate; no duplicate or double deduction | PARTIAL evidence; candidate acceptance NOT RUN |
| Offline/reconnect (A1/A3/A5) | Actual API stopped; normal reads/writes/deletes, cold restart, persistent authored work, reconnect/replay and conflict handling | Focused passes exist; whole candidate workflow NOT RUN |
| Resources/downloads (A4/A5/A6) | Local upload/play/read, saved link scheduling, server completion -> resource metadata -> verified PC file, retained thumbnails, retry/delete/cancel behavior | Earlier fixes exist; candidate end-to-end verification NOT RUN |
| Access/security (A1/C6) | Lease/account boundaries, current permissions, switched/revoked accounts, preserved rejected drafts; unfinished features cannot bypass these rules | Focused passes exist; candidate sweep NOT RUN |
| Candidate/build/recovery | Coordinated compatible API/migrations/native/frontend; launch/login, hashes, exact source state, startup instructions and known limitations; rollback preserves data | October 24 candidate built; restore migration rehearsal/repeat PASS; API deployed healthy and matching debug desktop launched. Login/UI/full recovery acceptance remains open. See PRIMARY_V1_CANDIDATE_2026-10-24.md |

Release-blocking failures: data loss, lost pending work, unauthorized access,
duplicate effects, incorrect inventory/finance, broken launch, or unverified
recovery. Do not waive these because the deadline is near. Prefer disabling an
optional unsafe feature; if a required core workflow fails, do not call V1 ready.

<a id="source-docsauditsv1_lab_pilot_release--deferred-if-unfinished"></a>
#### Deferred if unfinished

- Assistant project/task/experiment proposal generation and graph acceptance
  (C1/C2), voice input (C4), advanced media/TTS coordination (C3).
- Advanced salvage/disassembly/recovery valuation (B2).
- Broader cosmetic redesign, animations and experience polishing (Phase 3).
- Advanced imports/exports, automation and nonessential editors only if safely
  gated and the affected feature is explicitly listed as unavailable in V1.

These are conditional exclusions, NOT confirmation that controls are disabled.
Inspect existing helper/source integrations before exposing the candidate. A UI
label alone is insufficient for an unsafe mutation path: disable the operation
at the applicable native/server boundary too. Preserve existing user data.

Recovery/encryption development is not silently marked complete or waived. For
the controlled pilot, verify usable backup/restore and document remaining at-rest
protection limits. Do not claim encrypted/recoverable storage without evidence;
surface any unresolved security risk before recommending use with sensitive data.

<a id="source-docsauditsv1_lab_pilot_release--execution-order-timebox"></a>
#### Execution order / timebox

1. Freeze new enhancements; reconcile candidate source and feature exposure.
2. Complete backup/restore readiness before updating the existing installation.
   No closing the app without current saved-edit confirmation.
3. Finish only essential correctness gaps in core paths and group the compatible
   API/native/frontend changes into one candidate deployment.
4. Run one complete pilot acceptance matrix with real PostgreSQL and actual API
   outages. Collect independent failures; mark dependent cases blocked. Group
   fixes and rerun affected paths plus core regressions. Safety failures stop the
   affected path immediately.
5. Record build identity/checksums, backup location, restore procedure, exact
   limitations and final go/no-go. Owner decides whether to begin lab use.

October 24 is preparation/candidate work; October 25 is the target acceptance and
pilot handoff window. These are priorities, not an unsupported hours-to-finish
guarantee. If a blocker cannot be verified in that window, report it and move the
handoff rather than silently expanding risk or resetting data.

<a id="source-docsauditsv1_lab_pilot_release--initial-inspection-evidence"></a>
#### Initial inspection evidence

- deploy/scripts/backup-postgres.sh produces a PostgreSQL custom-format dump and
  checksum, but does not include desktop SQLite/outbox or either storage tree.
- deploy/backup-windows.bat similarly dumps PostgreSQL and tells the operator to
  back up backend storage separately. It does not create a complete recovery set.
- deploy/scripts/restore-postgres.sh uses --clean against its configured database.
  Do NOT use it for acceptance against the live database. Restore drills need an
  explicitly separate target and verified path/database identity.
- RELEASE.md describes public tagged GitHub releases. Pilot approval does not
  authorize publishing one; existing reproducibility/data-isolation rules remain.
- Latest review work has focused real PostgreSQL, API-stopped adapter/native and
  SQLite reopen evidence, but is source-only and not a live candidate sign-off.

<a id="source-docsauditsv1_lab_pilot_release--reporting"></a>
#### Reporting

For each gate record PASS / FAIL / BLOCKED / NOT RUN, exact build and evidence.
For every fix retain MODULE, FILE, CURRENT WRITE PATH, WHY IT BYPASSES
OFFLINE-FIRST, RISK, RECOMMENDED CHANGE, ACTUAL CHANGE MADE, VERIFICATION, STATUS
in its existing A1–C6 handoff report. Attribute helper work separately from primary
inspection. Do not substitute test counts for release acceptance.

Current decision: NOT READY TO RELEASE. Scope approved; gates remain open.

October 25: original six-event queue verified empty after IPC and resource-default
fixes. Final-state inspection found a release-blocking delayed create resurrecting
an already-acknowledged deleted zero-byte resource. Fresh backup/hash/SQLite and
isolated PostgreSQL restore passed; offline desktop cold-start/dashboard/downloads
and resource reads observed; 52 real-PostgreSQL lifecycle/custody/project checks
passed with rollback. This is not whole-candidate acceptance. See
`../handoffs/phase2-parallel/PRIMARY_V1_ACCEPTANCE_2026-10-25.md`.

October 25 evening: resource ordering prevention fix deployed after real
PostgreSQL batch/replay verification. API healthy and queue empty. Existing
resurrected zero-byte record has not been removed pending owner confirmation;
desktop acceptance and remaining recovery checks are still open. See
`../handoffs/phase2-parallel/PRIMARY_RESOURCE_ORDERING_2026-10-25.md`.

October 24 candidate acceptance checkpoint: 255 focused regression checks passed,
plus actual PostgreSQL download-control scenarios. All 3 completed server media
jobs have existing files of the recorded sizes. Real desktop offline cache
acceptance is blocked by no authorized active local session; PC media replicas
and full UI reconnect remain unverified. See
`../handoffs/phase2-parallel/PRIMARY_V1_ACCEPTANCE_2026-10-24.md`.

Backup preparation checkpoint: actual desktop path and Docker mounts verified;
`deploy/scripts/backup-lab-pilot.ps1` syntax and read-only planning passed.
See [backup runbook](REFERENCE.md#source-docsauditsv1_backup_restore_runbook). Capture and isolated database
restore subsequently passed. Evidence:
`../handoffs/phase2-parallel/PRIMARY_V1_BACKUP_2026-10-24.md`.
Remaining recovery boundaries there still prevent complete A2 sign-off.

---

<a id="source-docsdesktop_frontend_build"></a>
## Desktop frontend freshness

Original source: `docs/DESKTOP_FRONTEND_BUILD.md`. Retained historical scope/status.

<a id="source-docsdesktop_frontend_build--desktop-frontend-freshness"></a>
### Desktop frontend freshness

LabOS uses the same React source for web and Tauri, but not necessarily the same
running assets. In this repository `desktop/src-tauri/Cargo.toml` enables
`custom-protocol` by default. A normal `cargo build` embeds `desktop/dist` into
the desktop executable, even for a debug build. `devPath: http://localhost:1420`
does not make that executable consume Vite's current source.

<a id="source-docsdesktop_frontend_build--build-the-embedded-desktop-in-the-correct-order"></a>
#### Build the embedded desktop in the correct order

Save all edits and close LabOS before replacing its executable. From `desktop/`:

```powershell
npm run build:desktop:debug
```

This builds the TypeScript/Vite frontend first and only then compiles the native
executable with those assets. Do not run the two stages concurrently. Launch:

```powershell
Start-Process -FilePath '.\src-tauri\target\debug\lab-inventory.exe'
```

The embedded desktop does not require Vite to be running. For a packaged installer,
use `npm run tauri:build`; Tauri's configured `beforeBuildCommand` builds the frontend.
Use the dedicated `npm run dev:tauri` workflow when live development is intended;
do not assume a previously compiled default-feature executable is that dev session.

Native or API protocol changes may also require a coordinated server deployment.
Do not reset databases, clear caches/outboxes, or change accounts to fix stale UI.
Preserve data and confirm saved edits before a restart.

<a id="source-docsdesktop_frontend_build--verify-in-tauri-not-just-a-browser"></a>
#### Verify in Tauri, not just a browser

Record the executable path/build time and frontend asset hashes, then inspect the
actual desktop window. A passing web build or a current `localhost:1420` page does
not prove desktop UI freshness. Check known changed controls and startup errors.
Keep visual freshness separate from local/server data parity and offline acceptance.

---

<a id="source-docslocal-backend-capabilities"></a>
## LabOS Local Backend Capability Matrix

Original source: `docs/LOCAL-BACKEND-CAPABILITIES.md`. Retained historical scope/status.

<a id="source-docslocal-backend-capabilities--labos-local-backend-capability-matrix"></a>
### LabOS Local Backend Capability Matrix

This document is the contract for deciding what the workstation Local LabOS Backend owns.

<a id="source-docslocal-backend-capabilities--topology"></a>
#### Topology

```
Desktop UI
   ↓
Local LabOS Backend
   ↓
SQLite

Local LabOS Backend
   ⇅
Sync Engine
   ⇅
Central LabOS Backend
   ↓
PostgreSQL
```

The desktop must not connect directly to PostgreSQL.

<a id="source-docslocal-backend-capabilities--classification"></a>
#### Classification

<a id="source-docslocal-backend-capabilities--local-first"></a>
##### Local-first

These domains are expected to remain usable without the central server and persist workstation changes locally before synchronization:

- authentication/session/bootstrap;
- workstation preferences;
- inventory;
- projects and project workspace data;
- project tasks;
- project experiments, measurements and observations;
- project BOM data;
- project canvas blocks/connectors;
- project task↔experiment links;
- project work attachments metadata;
- notes and revisions;
- knowledge records/findings/results/relationships;
- locations;
- resource metadata, links, folders, tags and associations;
- finance transactions;
- budget periods;
- funding sources;
- engineering calculations and tests;
- local/global search over locally owned data.

A local-first operation must not silently fall through to PostgreSQL merely because connectivity exists.

<a id="source-docslocal-backend-capabilities--central-only"></a>
##### Central-only

These capabilities require central infrastructure and remain unavailable offline:

- media acquisition/downloads;
- yt-dlp;
- FFmpeg processing/conversion;
- central media/file storage;
- media download workers/jobs;
- cross-workstation aggregation;
- central reports/exports that require global data;
- automation/jobs;
- collaboration/notifications that depend on the central service;
- AI assistant execution;
- server administration/system health;
- central audit/operational administration;
- central user/permission administration;
- central Excel/report processing where the source data is not locally available.

When disconnected, the UI must report the central dependency clearly rather than pretending the operation succeeded.

<a id="source-docslocal-backend-capabilities--hybrid-sync-mediated"></a>
##### Hybrid / sync-mediated

These capabilities have local records or local projections but require the central server for some parts:

- resource/media workflows: metadata can be local; actual file/media acquisition and processing are central;
- synchronization: local outbox/pull state is local, while authoritative cross-workstation reconciliation is central;
- search: local search covers workstation-owned records; central search may provide explicitly central/global information;
- project/resource relationships whose metadata is local but whose underlying media/file is central;
- dashboards and operational views: local projections are used offline; central aggregation is used when global data is required;
- finance summaries/Excel outputs when they depend on central/global datasets.

<a id="source-docslocal-backend-capabilities--route-parity-rule"></a>
#### Route parity rule

For every workstation-owned central route, the Local LabOS Backend must expose an equivalent domain operation with:

1. matching request/response semantics where practical;
2. matching validation and business invariants;
3. SQLite persistence;
4. sync/outbox representation for mutations;
5. pull/merge/tombstone handling;
6. deterministic offline behavior.

The implementation may use Rust/Tauri IPC during the migration, but the desktop API must treat that IPC as the Local LabOS Backend boundary rather than as a collection of page-specific fallbacks.

<a id="source-docslocal-backend-capabilities--current-migration-state"></a>
#### Current migration state

Existing `local_*.rs` modules are the first implementation of the Local LabOS Backend. They are not separate product domains.

Remaining central routes must be audited against this matrix before they are considered complete. Operations requirements currently require deliberate local persistence/sync work before they can be classified as fully local-first. Engineering calculations, tests, formula definitions and formula execution now have a local runtime; calculation/test records synchronize through the central backend.

<a id="source-docslocal-backend-capabilities--non-negotiable-boundary"></a>
#### Non-negotiable boundary

```
Desktop ─X→ PostgreSQL
Desktop ─X→ central media services for local CRUD
Local Backend ─→ SQLite
Local Backend ⇄ Sync Engine ⇄ Central Backend
Central Backend ─→ PostgreSQL
Central Backend ─→ yt-dlp / FFmpeg / central storage
```

---

<a id="source-development"></a>
## LabOS Development Guide

Original source: `DEVELOPMENT.md`. Retained historical scope/status.

<a id="source-development--labos-development-guide"></a>
### LabOS Development Guide

This document is the technical reference for developing, testing, maintaining, and releasing LabOS.

For a product overview, capabilities, and user-facing information, see [`README.md`](../README.md).

---

<a id="source-development--1-development-principles"></a>
#### 1. Development Principles

LabOS is a laboratory operating system, not a generic CRUD dashboard. Changes should preserve:

- data integrity
- project and laboratory context
- backend-enforced authorization
- offline reliability
- synchronization correctness
- traceable history
- predictable UX
- safe failure and recovery

Prefer small, verifiable changes over broad rewrites. Existing working behavior should not be replaced merely for architectural preference.

All production changes are made against `main` unless a release workflow explicitly requires another mechanism.

---

<a id="source-development--2-system-architecture"></a>
#### 2. System Architecture

```text
┌──────────────────────┐
│   LabOS Desktop      │
│ React + Tauri        │
│ Local SQLite         │
└──────────┬───────────┘
           │ HTTPS / HTTP API
           ▼
┌──────────────────────┐
│   LabOS Backend      │
│ Express / Node.js    │
└──────────┬───────────┘
           │ SQL
           ▼
┌──────────────────────┐
│     PostgreSQL       │
│ Central application  │
│ database             │
└──────────────────────┘
```

The desktop client must **never connect directly to PostgreSQL**. The backend is the authoritative API and authorization boundary.

The desktop application may continue operating against its local SQLite data while offline and later synchronize through the backend.

---

<a id="source-development--3-repository-structure"></a>
#### 3. Repository Structure

```text
lab-inventory-app/
├── backend/                 # API, authentication, business logic, migrations
│   ├── src/
│   └── migrations/
├── desktop/                 # React + Tauri desktop client
│   ├── src/
│   └── src-tauri/
├── deploy/                  # Deployment-related files
├── scripts/                 # Project utilities
├── README.md                # Product-facing documentation
├── DEVELOPMENT.md           # Technical/developer documentation
└── .gitignore
```

Runtime data, local databases, generated builds, secrets, backups, dependency directories, and temporary files must remain outside source control unless explicitly required by the project.

---

<a id="source-development--4-frontend-desktop"></a>
#### 4. Frontend / Desktop

The desktop application is a React application packaged with Tauri.

Current frontend stack includes:

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- Lucide icons
- Tauri

The desktop package currently uses version `2.2.1`.

<a id="source-development--development"></a>
##### Development

```powershell
cd desktop
npm install
npm run dev:tauri
```

Browser-only development can use:

```powershell
npm run dev
```

The browser does not provide the Tauri IPC bridge, so features that depend on native/local SQLite access must be tested through Tauri.

<a id="source-development--production-build"></a>
##### Production build

```powershell
npm run build
```

<a id="source-development--tauri-package-build"></a>
##### Tauri package build

```powershell
npm run tauri:build
```

---

<a id="source-development--5-backend"></a>
#### 5. Backend

The backend is a Node.js/Express API backed by PostgreSQL.

Current backend package version is `2.2.1`.

<a id="source-development--development-1"></a>
##### Development

```powershell
cd backend
npm install
npm run dev
```

<a id="source-development--production"></a>
##### Production

```powershell
npm start
```

<a id="source-development--syntax-check"></a>
##### Syntax check

```powershell
npm run check
```

On Windows PowerShell, backend source can also be checked with:

```powershell
Get-ChildItem .\src -Recurse -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

---

<a id="source-development--6-postgresql-and-migrations"></a>
#### 6. PostgreSQL and Migrations

PostgreSQL is the central server database.

Migrations are stored in:

```text
backend/migrations/
```

Run migrations with:

```powershell
cd backend
npm run migrate
```

<a id="source-development--migration-rule"></a>
##### Migration rule

Never modify an already-applied migration to repair production state. Add a new repair migration instead.

This matters because the migration runner records applied migrations. A previously recorded migration will not automatically execute again after its file contents are changed.

Example: the `sync_tombstones` repair was added as a new migration after the original migration had already been recorded.

---

<a id="source-development--7-local-sqlite"></a>
#### 7. Local SQLite

The desktop client maintains local laboratory data for offline operation.

Local SQLite is an implementation detail of the desktop client and is not a replacement for the central PostgreSQL database.

Local mutations should be designed so that:

1. the local state is updated atomically;
2. the required outbox entry is created atomically;
3. synchronization can retry safely;
4. a failed server request does not falsely report success;
5. conflict information remains actionable.

---

<a id="source-development--8-offline-and-synchronization-model"></a>
#### 8. Offline and Synchronization Model

The synchronization architecture is:

```text
Local mutation
     │
     ├── Local SQLite state
     │
     └── Outbox entry
              │
              ▼
        Sync / retry
              │
              ▼
        Backend API
              │
              ▼
        PostgreSQL
```

The server provides push and pull synchronization.

Important properties:

- synchronization is retryable;
- duplicate delivery must be safe through idempotency;
- stale offline updates can be rejected as conflicts;
- conflicts can be reconciled explicitly;
- server-side deletions are represented through tombstones;
- pull synchronization uses a stable composite cursor;
- reconnecting should recover pending work;
- retry backoff should prevent aggressive repeated failures;
- manual retry should be available when automatic retry is insufficient.

The pull cursor is based on `(event_at, event_type, event_id)` rather than timestamp alone so events sharing a timestamp do not get skipped or repeatedly returned.

---

<a id="source-development--9-conflict-and-reconciliation-rules"></a>
#### 9. Conflict and Reconciliation Rules

When an offline mutation conflicts with newer server state, the user must be able to understand and resolve the conflict.

The desktop conflict system supports actions including:

- keep local changes and retry
- accept server state
- dismiss the conflict

Conflict resolution must not silently overwrite newer server data.

Server-side stale-update protection is authoritative; frontend state is not sufficient protection.

---

<a id="source-development--10-authentication-and-authorization"></a>
#### 10. Authentication and Authorization

Authorization is enforced by the backend.

Frontend visibility is not a security boundary.

The permission model includes global roles and project-level access.

The `admin` role receives the complete administrator baseline permission set. Individual non-admin overrides may refine access, but administrator access must not be accidentally stripped by ordinary per-user permission overrides.

Any new protected capability should be evaluated at the backend route/tool level before being exposed in the UI.

---

<a id="source-development--11-lab-assistant"></a>
#### 11. Lab Assistant

The Lab Assistant is permission-aware and context-aware.

Its context model supports scopes such as:

- no context
- project context
- project laboratory-data context
- custom context

When a project is selected, project-scoped tools receive the project ID rather than relying on the assistant to infer the project from conversation text.

The assistant must respect the effective permissions available to the current user.

<a id="source-development--tool-calling-behavior"></a>
##### Tool-calling behavior

The assistant uses Gemini function calling. Data-oriented questions within an enabled context must invoke an appropriate available tool before producing a factual answer.

The implementation also preserves the chat-level tools and system instruction across follow-up tool-response turns. This is important because per-request Gemini configuration does not automatically inherit the complete chat configuration.

When debugging assistant behavior, verify all of the following:

1. the selected context is correct;
2. the effective permissions expose the required tool;
3. the project ID is injected into project-scoped tools;
4. tool calling is forced when required for data questions;
5. follow-up requests retain tools and system instructions;
6. the tool result is actually incorporated into the final response.

---

<a id="source-development--12-resources-and-local-media"></a>
#### 12. Resources and Local Media

Resources may include images, video, audio, PDFs, text, Markdown, and other supported files.

Downloaded media must be treated as local application data. A downloaded video must not unexpectedly fall back to the original remote URL for playback.

Runtime resource storage is not source-controlled.

When changing resource handling, test both:

- resources that already have local downloaded media;
- resources that are remote/link-only.

---

<a id="source-development--13-crud-verification"></a>
#### 13. CRUD Verification

A CRUD operation is not complete merely because the UI shows a success toast or an HTTP request returns successfully.

Verify the complete chain:

```text
UI action
   ↓
API request
   ↓
Authentication
   ↓
Authorization
   ↓
Backend route
   ↓
Database mutation
   ↓
API response
   ↓
Frontend state
   ↓
Reload / persistence
```

For destructive operations, also verify relationships, references, and history.

---

<a id="source-development--14-error-handling"></a>
#### 14. Error Handling

User-facing errors should explain:

- what failed;
- why it failed when known;
- what the user can do next.

Never expose raw JavaScript object serialization such as:

```text
[object Object]
```

Do not display a success state when the underlying operation failed.

Errors should avoid leaking unnecessary implementation details or secrets.

---

<a id="source-development--15-testing-and-verification"></a>
#### 15. Testing and Verification

The repository contains static verification scripts for major development tracks and reliability areas.

Available backend checks include tests for:

- security foundation
- core application behavior
- project/workspace functionality
- track-specific functionality
- phase-specific functionality
- downloaded media
- synchronization reliability

Examples:

```powershell
cd backend
npm run test:security
npm run test:media-downloads-static
npm run test:sync-reliability-static
```

Static checks are useful but do not replace runtime testing.

For launch readiness, test the application as a user would use it, including offline operation, reconnection, persistence, permissions, and recovery.

---

<a id="source-development--16-development-workflow"></a>
#### 16. Development Workflow

Recommended workflow:

1. Inspect the existing implementation before changing it.
2. Identify the smallest correct change.
3. Make the change on `main` when working directly on the project release baseline.
4. Run the relevant static checks.
5. Run build/type checks where applicable.
6. Verify the affected behavior at runtime when possible.
7. Review the resulting Git diff.
8. Commit with a clear message.
9. Do not leave temporary repair workflows, debug files, generated artifacts, or test data in the repository.

Avoid broad rewrites when a focused fix is sufficient.

---

<a id="source-development--17-environment-configuration"></a>
#### 17. Environment Configuration

Secrets and environment-specific values belong in local environment configuration, not source control.

Typical backend configuration includes:

- PostgreSQL connection information
- JWT/authentication configuration
- model/API credentials
- resource storage configuration
- server configuration

Never commit real credentials, tokens, private keys, or local secrets.

When documenting environment variables, document names and purpose, not secret values.

---

<a id="source-development--18-backup-and-recovery"></a>
#### 18. Backup and Recovery

Before risky schema or data changes, create a verified backup according to the deployment environment's backup procedure.

Recovery testing should verify that:

- the backup can actually be restored;
- migrations can be reapplied correctly to a restored environment;
- application data remains consistent;
- local desktop synchronization can recover afterward.

A backup that has never been restored is not considered fully verified.

---

<a id="source-development--19-security-rules"></a>
#### 19. Security Rules

The following are non-negotiable:

1. Backend authorization is authoritative.
2. Project-scoped data must enforce project access.
3. SQL must be safely parameterized.
4. User input must be validated.
5. Secrets must never enter Git.
6. Runtime storage must not enter Git.
7. Resource deletion must account for references and ownership.
8. Authentication failures must not expose sensitive information.
9. Error responses must avoid unnecessary internal details.
10. New assistant tools must enforce the same permissions as the underlying data.

---

<a id="source-development--20-versioning"></a>
#### 20. Versioning

LabOS uses semantic-style version numbers:

```text
MAJOR.MINOR.PATCH
```

Examples:

- `1.0.0` — first stable release
- `1.1.0` — backward-compatible feature release
- `1.1.1` — backward-compatible bug-fix release
- `2.0.0` — major release with significant new capabilities or breaking changes

The desktop and backend package versions should remain aligned unless there is a documented reason not to do so.

The current repository baseline is `2.2.1`.

---

<a id="source-development--21-release-mechanism"></a>
#### 21. Release Mechanism

The V1 release mechanism will use GitHub as the source of truth.

Target flow:

```text
Validated main
      │
      ▼
Version update
      │
      ▼
Git tag
      │
      ▼
Automated release build
      │
      ├── Desktop installer/artifacts
      ├── Checksums
      └── Release notes
      │
      ▼
GitHub Release
```

The release process should be reproducible and should not depend on manually copying files from a developer machine.

The final mechanism will be completed during the release-system phase of the V1 launch plan.

---

<a id="source-development--22-v1-launch-plan"></a>
#### 22. V1 Launch Plan

The launch work is intentionally limited to five phases:

<a id="source-development--phase-1-v1-completion"></a>
##### Phase 1 — V1 Completion

Close remaining functional gaps and verify the existing implementation.

<a id="source-development--phase-2-v1-polish-and-hardening"></a>
##### Phase 2 — V1 Polish and Hardening

Complete UI/UX consistency, error states, permissions, security, recovery, migrations, backups, and production hardening.

<a id="source-development--phase-3-release-system"></a>
##### Phase 3 — Release System

Implement versioning, automated builds, GitHub releases, installers/artifacts, checksums, and release notes.

<a id="source-development--phase-4-launch-and-real-world-validation"></a>
##### Phase 4 — Launch and Real-World Validation

Perform fresh-machine installation and end-to-end testing, then use LabOS in real laboratory workflows and fix release-blocking issues.

<a id="source-development--phase-5-v2-planning"></a>
##### Phase 5 — V2 Planning

Use real V1 usage and feedback to define, prioritize, and architect V2 without destabilizing the V1 release.

---

<a id="source-development--23-technical-decision-log"></a>
#### 23. Technical Decision Log

Important architectural decisions should be recorded here or in a dedicated technical decision record when they have lasting impact.

Current key decisions include:

- PostgreSQL remains the central server database.
- Desktop clients use local SQLite for offline-first operation.
- Desktop clients do not connect directly to PostgreSQL.
- Synchronization uses an outbox and idempotent server processing.
- Server pull synchronization uses a composite cursor.
- Tombstones represent server-side deletions during synchronization.
- Backend authorization is the final security boundary.
- Lab Assistant tools are permission-aware and context-aware.
- Product documentation and technical documentation are intentionally separated.

---

<a id="source-development--24-troubleshooting-principles"></a>
#### 24. Troubleshooting Principles

When a feature appears broken:

1. Reproduce it.
2. Determine whether the failure is UI, API, authorization, database, local SQLite, synchronization, or environment related.
3. Inspect the actual persisted state.
4. Check backend logs and browser/Tauri console output where appropriate.
5. Fix the underlying state transition rather than masking the symptom.
6. Add or update a regression check when practical.
7. Re-test the original workflow from a clean state.

Do not assume a successful UI notification proves the backend or database operation succeeded.

---

<a id="source-development--25-documentation-rule"></a>
#### 25. Documentation Rule

Keep this file technical and maintainable.

Put user-facing explanations, product positioning, feature descriptions, screenshots, and launch messaging in `README.md`.

Put implementation details, development commands, architecture decisions, testing procedures, migration rules, and release mechanics here.

---

<a id="source-release"></a>
## LabOS Release Process

Original source: `RELEASE.md`. Retained historical scope/status.

<a id="source-release--labos-release-process"></a>
### LabOS Release Process

This document defines the V1 release flow for LabOS.

For the owner-approved October 25, 2026 own-lab pilot, follow
[the controlled pilot gates](REFERENCE.md#source-docsauditsv1_lab_pilot_release). This is not a
public release authorization or a fresh-install/data-reset instruction. The
tagged publication process below remains separate from pilot acceptance.

<a id="source-release--release-model"></a>
#### Release model

LabOS releases are versioned from Git tags using semantic versioning:

```text
vMAJOR.MINOR.PATCH
```

The release workflow builds the Windows desktop application and publishes the generated installers and SHA-256 checksums to a GitHub Release.

The release tag must match the application version in all four locations:

- `desktop/package.json`
- `backend/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`

<a id="source-release--production-and-preview-installations"></a>
#### Production and Preview installations

Production and Preview are separate installed LabOS applications and must never share the same SQLite database.

- **Production** uses the normal `com.lab-inventory.app` application identity and its production SQLite data.
- **Preview** is built with `desktop/src-tauri/tauri.preview.conf.json`, which gives it the separate `com.lab-inventory.app.preview` identity and the `LabOS Preview` product name.
- Tauri uses the application identity when resolving its app-data directory, so the two installations receive separate local SQLite databases.
- Preview is built from the same repository source as Production, but it is a separate executable/build and can be a newer version under test.
- To test a future release with realistic data, make a backup/copy of the Production SQLite database into the Preview environment. Never point Preview at the live Production database.

The Preview build is intentionally not part of the tagged Production release workflow. It is a testing build used while `main` continues to develop toward the next release.

From `desktop/`, build Preview with:

```powershell
npm run tauri:build:preview
```

The Tauri CLI supports configuration overlays for separate application flavours; the Preview overlay changes only the product name, application identifier, and window title.

<a id="source-release--media-runtime"></a>
#### Media runtime

LabOS media downloads are performed by the **backend service**, not by the desktop client. Desktop PCs therefore do not need their own copy of FFmpeg or yt-dlp when they connect to the central LabOS backend.

The production backend Docker image provisions both tools:

- FFmpeg is installed from the Debian Bookworm package repository.
- yt-dlp is downloaded at a pinned release version and verified with its SHA-256 digest during the image build.
- The backend explicitly uses `/usr/local/bin/yt-dlp` and `/usr/bin/ffmpeg` in the production container.

Do not commit these third-party executables to the repository. The backend runtime image is the distribution mechanism for the central deployment.

For a local Windows backend, the existing `YTDLP_PATH` and `FFMPEG_PATH` environment overrides may point to locally installed/downloaded tools.

<a id="source-release--before-creating-a-release"></a>
#### Before creating a release

1. Finish and verify the changes intended for the release.
2. Make sure `main` is clean and synchronized with `origin/main`.
3. Update the version in all four files above.
4. Commit the version change to `main`.
5. Push `main`.
6. Confirm the pushed commit is the exact source intended for the release.
7. Rebuild the production backend image and verify the media-tool health check reports both FFmpeg and yt-dlp as available.
8. Build the Preview installer from the release candidate state and test it against a separate Preview SQLite database before upgrading Production.

Example version update:

```text
2.2.1 -> 2.2.2
```

<a id="source-release--create-the-release"></a>
#### Create the release

From the repository root:

```powershell
git checkout main
git pull origin main
git tag v2.2.2
git push origin v2.2.2
```

Pushing a tag matching `v*.*.*` starts `.github/workflows/release.yml` automatically.

The workflow:

1. Checks out the tagged source.
2. Validates that the tag version matches the desktop, backend, Tauri and Cargo versions.
3. Installs desktop dependencies with `npm ci`.
4. Builds the Tauri desktop application.
5. Collects the Windows `.msi` and `.exe` installers.
6. Generates `LabOS-SHA256SUMS.txt`.
7. Creates or updates the GitHub Release for the tag with generated release notes and the installers/checksum file.

The tagged Production installer uses the normal `tauri.conf.json` identity. The Preview overlay is not used by the Production release workflow.

<a id="source-release--manual-release-rebuild"></a>
#### Manual release rebuild

The workflow also supports `workflow_dispatch`. This is useful when a release needs to be rebuilt without creating another tag.

Use the GitHub Actions UI and provide the existing release tag, for example:

```text
v2.2.2
```

The tag must already exist and its version must still match the four version files.

<a id="source-release--verifying-a-release"></a>
#### Verifying a release

After the workflow finishes:

- Confirm the GitHub Release exists for the exact tag.
- Confirm both Windows installer formats that were produced are attached.
- Confirm `LabOS-SHA256SUMS.txt` is attached.
- Install Production without overwriting an existing Preview installation or Preview SQLite data.
- Confirm the desktop can connect to the central backend when the backend is available.
- Start LabOS and verify login, inventory, project/knowledge/resource flows, synchronization and the system tray.
- Verify the installed application reports the intended version.
- Confirm Preview and Production can be launched independently when both are installed.
- Confirm each installation reports and uses its own local SQLite data path.

For an integrity check on Windows:

```powershell
Get-FileHash .\LabOS-<version>.msi -Algorithm SHA256
```

Compare the result with the corresponding line in `LabOS-SHA256SUMS.txt`.

<a id="source-release--important-rules"></a>
#### Important rules

- Do not release from an uncommitted working tree.
- Do not create a release tag before the version files have been updated and pushed.
- Do not manually upload locally built installers as the normal release path; the GitHub Actions workflow is the canonical Production build path.
- Do not commit `backend/yt-dlp.exe`, FFmpeg binaries, or other generated third-party executables to the repository.
- Keep `desktop/src-tauri/Cargo.lock` tracked so the desktop dependency graph used for releases remains reproducible.
- Do not use a release tag to bypass unfinished migration or database changes.
- Never configure Preview to use the Production SQLite database.
- Never test a new release by overwriting the installed Production executable or its application data.

<a id="source-release--current-v1-baseline"></a>
#### Current V1 baseline

The repository currently uses version `2.2.1`. The next release should increment the patch/minor/major component according to the scope of the changes being released.

---

<a id="source-desktopreadme"></a>
## Desktop client — not built yet

Original source: `desktop/README.md`. Retained historical scope/status.

<a id="source-desktopreadme--desktop-client-not-built-yet"></a>
### Desktop client — not built yet

This will be the app that runs on each lab PC and talks to the shared
backend over the local network (see `../backend`).

<a id="source-desktopreadme--recommended-approach"></a>
#### Recommended approach

**Tauri + React**, because:
- Much smaller installer/binary than Electron (Tauri uses the OS's built-in
  webview instead of bundling Chromium)
- Lower memory use — matters if it's running on older lab machines
- Still lets you write the UI in React, reusing web skills

Electron is the fallback if Tauri setup friction becomes a blocker — it has
more StackOverflow answers and a gentler first-time setup.

<a id="source-desktopreadme--getting-started-with-tauri-when-youre-ready"></a>
#### Getting started with Tauri (when you're ready)

```bash
npm create tauri-app@latest
# choose: React, TypeScript (optional but recommended), npm
```

Then point its HTTP calls at the backend, e.g.:

```js
const res = await fetch('http://<lab-server-ip>:4000/api/items');
const items = await res.json();
```

Since every machine is on the same LAN, `<lab-server-ip>` is just the local
IP of whichever machine runs the backend (e.g. `192.168.1.42`). Consider
giving that machine a static local IP or a simple hostname via your
router so it doesn't change.

<a id="source-desktopreadme--viewing-resources-images-video-audio-pdfs-youtube-links"></a>
#### Viewing resources (images, video, audio, PDFs, YouTube links)

These render **inside the app**, not handed off to another program —
see `AGENT_BUILD_PLAN.md` Phase 3 for the full detail. The short version:
the backend's `/api/resources/:id/download` endpoint streams bytes with
Range support and an `inline` disposition for viewable types, so it can
be used directly as an `<img>`/`<video>`/`<audio>` source or fed into
`react-pdf`. Only a few genuinely non-renderable file types (Word docs,
CAD files) fall back to saving a copy and opening it externally.

<a id="source-desktopreadme--suggested-screens-to-build-in-order"></a>
#### Suggested screens to build, in order

1. Items list (table + filters by type/status/location)
2. Item detail (history of transactions + notes for that item)
3. Add/edit item form
4. Financial dashboard (charts — once `/api/transactions` exists)
5. Notebook (list + editor — once `/api/notes` exists)
6. Global search bar (once `/api/search` exists)

---

<a id="source-deployreadme"></a>
## LabOS v2.2 — Deployment & Operations

Original source: `deploy/README.md`. Retained historical scope/status.

<a id="source-deployreadme--labos-v22-deployment-operations"></a>
### LabOS v2.2 — Deployment & Operations

This directory contains the production-oriented LabOS server deployment. PostgreSQL is private to the server and is never exposed directly to desktop clients.

<a id="source-deployreadme--topology"></a>
#### Topology

```
LabOS Desktop A ─┐
LabOS Desktop B ─┼── LAN / HTTPS / VPN ──> LabOS Server
LabOS Desktop C ─┘                         ├─ Node/Express API
                                           ├─ PostgreSQL
                                           └─ persistent storage
```

The desktop remains an offline-first Tauri + SQLite client. The server remains the central PostgreSQL authority.

<a id="source-deployreadme--deployment"></a>
#### Deployment

The Compose file uses deterministic names:

- Compose project: `labos`
- PostgreSQL volume: `labos_postgres`
- persistent storage volume: `labos_storage`
- API: `localhost:4000` by default
- PostgreSQL is never published to the host
- both services read `.env.production`
- migrations run automatically before the API starts

<a id="source-deployreadme--first-setup"></a>
##### First setup

1. Copy `.env.production.example` to `.env.production`.
2. Set real secrets. Keep `PGDATABASE/PGUSER/PGPASSWORD` aligned with `POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD`.
3. Choose the server exposure:
   - HTTPS reverse proxy: `LABOS_BIND_ADDRESS=127.0.0.1`, `TRUST_PROXY=true`
   - LAN-only: bind to the server LAN interface and firewall TCP 4000 to the lab network.
4. Start:

```powershell
docker compose --env-file .env.production up -d --build
docker compose ps
```

5. Confirm the API health endpoint and migration logs before opening the desktop.

<a id="source-deployreadme--disposable-local-reset"></a>
#### Disposable local reset

There is intentionally no destructive reset script in the repository. Destructive environment resets are one-time operator actions and should be performed explicitly so they cannot be mistaken for normal deployment.

For a disposable local database:

```powershell
docker compose --env-file .env.production down -v --remove-orphans
docker volume rm labos_postgres labos_storage 2>$null
docker compose --env-file .env.production up -d --build
docker compose ps
```

Only use this when the LabOS Docker data is disposable.

A server reset does **not** reset desktop state. For physical testing, close every LabOS Tauri/Vite process and clear the LabOS application-data directory only after confirming it contains LabOS data. The desktop stores its local SQLite database and cached application/session state there.

Do not delete unrelated application-data directories.

<a id="source-deployreadme--backups"></a>
#### Backups

From `deploy`:

```powershell
.\scripts\backup-postgres.sh .\backups
```

Back up PostgreSQL and the `labos_storage` volume as one set because database records can reference uploaded/generated files. A backup is not considered verified until a restore has been tested.

<a id="source-deployreadme--restore"></a>
#### Restore

Stop application writes and restore the matching database/storage backup set:

```powershell
.\scripts\restore-postgres.sh .\backups\labos-postgres-YYYYMMDDT...dump
```

<a id="source-deployreadme--https"></a>
#### HTTPS

`nginx/labos.conf.example` is a reference reverse-proxy configuration. Keep private keys out of Git.

When nginx is active, bind the API to `127.0.0.1:4000`; nginx is the Internet-facing component.

<a id="source-deployreadme--desktop-release-endpoint"></a>
#### Desktop release endpoint

Release builds receive their central API endpoint from the GitHub repository variable `LABOS_API_BASE_URL`. It must include `/api`, for example:

```
https://labos.example.com/api
```

For local physical testing, the development desktop defaults to:

```
http://localhost:4000/api
```

Never run a second backend on port 4000 while testing the Dockerized LabOS API. A second API process can make the desktop appear to be connected to an old database.

<a id="source-deployreadme--architecture-rule"></a>
#### Architecture rule

The desktop must never connect directly to PostgreSQL. The supported production path is:

**Tauri SQLite → sync/outbox → LabOS API → PostgreSQL.**


## 2026-11-01 — Browser project work transport contract

Ordinary desktop task/experiment/link writes continue through native repositories
and the outbox. They must never fall back to project HTTP after a native error.
Browser task/experiment CRUD, repeat, task-experiment link/unlink and nested
measurement/observation writes use
project-work-http: an Idempotency-Key UUID, original request body and account-bound
retry identity. An uncertain outcome retains the same body/key; a confirmed
success or definitive client rejection releases it. Retry storage is tab-scoped;
this is not an offline browser queue or a durable administrative intention.

On the server, one transaction locks current project/account authority and
records the effect, mandatory audit, deletion tombstones and retry receipt.
Replay requires current authority and exact original payload identity. Task and
experiment mutations compare reviewed editable values; link mutations compare
the reviewed relationship. These are expected-value checks, not full monotonic
version/ABA detection. Open editors freeze the reviewed base until save/cancel;
background refresh must not silently rebase a draft.

Run the new actual PostgreSQL acceptance probe only with explicit development
opt-in LABOS_DEV_PROJECT_WORK_PROBE=rollback-only. It leaves fixtures rolled back.
Its SQL failure injection exercises the real database, not fabricated results;
it does not replace separate-client concurrency or running desktop acceptance.


## 2026-11-02 — Work attachment scope and retry contract

Task and experiment attachments reference resources already attached directly to
the same project. An unattached, item-linked, note-linked or folder-child resource
must go through its supported attachment/move workflow first; do not infer new
project ownership while adding a work link. A root folder directly attached to
the project remains a resource that can be referenced. Existing pending work is
preserved if a server scope check rejects it.

Native creation validates the current readable resource cache and project scope,
then writes its link and immutable outbox event. Fresh sync application and
browser writes share project-work-attachment.js: locked current project authority,
parent/project binding, resource scope, restricted grant and duplicate protection.
Browser requests retain their original account-owned retry body/key; removal
includes the reviewed resource ID. Endpoint changes use detach followed by attach.

Detach removes a work relationship, never the resource or its files. Current
project edit authority is required; current resource read access is deliberately
not required for cleanup of a known link. Exact endpoint identity or a matching
project-scoped deletion tombstone is required. A lost delete acknowledgement
cannot remove a later replacement link with another UUID. Browser historical
create confirmation rechecks current resource access; owned sync replay remains
a minimal intent acknowledgement and provides no historical resource content or
new authority. Real PostgreSQL and two-client acceptance remain required.


## 2026-11-02 — Planning quantities and reviewed write bases

BOM demand and project_items.allocated_quantity are planning metadata. Posting
these values does not create an issue, consumption, custody balance, reservation
approval, stock debit/credit or financial transaction. Physical workflows keep
their separate explicit permissioned movements. A BOM requirement_id references
one canonical requirement; editing a BOM line does not manufacture another demand
record or silently change that canonical requirement's quantity.

Supported quantities fit NUMERIC(12,3): nine whole digits, three decimal places
(with floating-point tolerance). BOM demand must be positive; item links may be
zero. Browser work requests preserve original retry bodies. BOM edits/deletes
carry complete reviewed editable values. New native BOM edit/delete and item-link
intents carry reviewed values too, rechecked during local transaction commit and
fresh server application. Joined physical stock display fields are excluded from
planning comparisons. These are expected-value checks, not monotonic versions.

Legacy immutable events without reviewed values remain compatible and have weaker
conflict protection. Do not rewrite them to invent a reviewed base. Item-link
receipts keep their composite project:item entity identity; audit_log.entity_id
uses the UUID item_id, with project_id and original sync_entity_id in metadata.
Project-item removal uses the existing authoritative snapshot contract, not an
item-UUID tombstone that could collide between projects.
