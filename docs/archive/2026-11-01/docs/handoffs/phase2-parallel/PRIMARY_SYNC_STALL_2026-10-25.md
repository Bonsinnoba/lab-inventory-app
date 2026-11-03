# Six pending changes — investigation, October 25

Identity / role: LABOS-P2-PRIMARY, integration and sync-safety review.

MODULE: Sync orchestration / status presentation.

FILE: desktop/src/api/sync.ts; sync-runtime-state.ts;
resource-uploads.ts; components/SyncStatus.tsx; sync-runtime-state.test.mjs.

CURRENT WRITE PATH: Native outbox -> staged file transfer -> sync/push -> verified
receipts -> local acknowledgement. Six October 21 events remain pending: two
resource creates, one resource delete and three updates to one inventory item.

WHY IT BYPASSES OFFLINE-FIRST: No bypass established. The problem is incomplete
delivery/acknowledgement and inadequate diagnostics, not missing local storage.

RISK: Indefinite misleading spinner, delayed authored work, and unsafe manual
queue cleanup if server acceptance is mistaken for locally confirmed completion.

EVIDENCE: Read-only SQLite checks found six owned pending events, no recorded
failures/conflicts and ready file staging entries (0 and 891216 bytes). On
October 24 after login the matching account lease was valid. Server receipt
lookup (including compact UUID normalization) found only the deletion accepted.
Both upload staging records exist but are unpublished. PostgreSQL had no blocked
database query at inspection. Screenshot shows Syncing with six pending, no
conflicts and no successful sync. These facts do not identify the exact blocked
await, nor prove that the empty file is the cause.

RECOMMENDED CHANGE: Surface unexpected run failures instead of allowing the
automatic caller to swallow them while status remains syncing. Display current
stage to locate a genuinely unresolved await. Preserve original IDs and payloads;
do not mark rows synced, rewrite conflicts or force server writes during diagnosis.

ACTUAL CHANGE MADE: Added account-scoped top-level failure publication/backoff,
with normal promise cleanup and rejection preserved. Added transient stages for
queue reads, upload session/status/body/chunk, push, receipt confirmation and pull
steps. Stages are not persisted and clear on non-syncing state/account changes.
No queue or database records changed by the diagnostic patch.

VERIFICATION: All 30 targeted runtime/upload tests passed with the actual API
stopped, including stage reset/restart/account isolation. API restored healthy.
TypeScript/Vite frontend build and diff whitespace check passed; native embedding
build in progress at this checkpoint.
Existing switched-account tests cover suppression of errors from an old login.

STATUS: Diagnostics source implemented; underlying six-event stall NOT FIXED or
verified. Awaiting rebuilt desktop observation. User approved saved-edit restart.
On October 25 the API/database and desktop were no longer running; existing
PostgreSQL/API containers restarted without replacing their data volumes.

## Root cause located in live desktop

Rebuilt diagnostic desktop restored the existing login. Using the computer-use
skill, observed the sync panel persist at **Confirming server receipts locally**.
The installed Tauri JS SDK constructs the IPC envelope as
`{cmd, callback, error, ...args}`. All four `record_sync_failure` callers supplied
`error: message`, replacing Tauri's numeric error callback with an application
string. This breaks IPC dispatch/response delivery while attempting to report
the first failed receipt; later changes cannot progress and no failure is recorded.

Changed all four callers to `errorMessage` and the Rust command parameter to
`error_message`. Coordinated frontend/native rebuild is required. Added an AST
regression covering every failure-recording call and checking native argument
agreement; 16 runtime/receipt regression cases pass. This fixes the callback
collision, not the underlying server failure(s) that it concealed. No manual ACK,
queue removal, ownership reassignment or payload rewrite is authorized by this fix.

## Follow-up: explicit null resource metadata

MODULE: Resource creation through sync (primary agent).

FILE: `backend/src/routes/sync.js`; regression suite
`backend/src/routes/sync-resource-create-defaults.test.js`.

CURRENT WRITE PATH: Native staged upload -> immutable outbox create -> server
resource INSERT -> receipt -> local acknowledgement.

WHY IT BYPASSES OFFLINE-FIRST: It does not bypass the outbox; explicit null fields
in native snapshots override PostgreSQL NOT NULL defaults and prevent publishing.

RISK: Retry repeats the same failure indefinitely. The IPC fix exposed it and
allowed four other events to finish, leaving two resource creates pending.

RECOMMENDED CHANGE / ACTUAL CHANGE MADE: Apply category `general`, description
empty string, tags empty array and validated visibility on the create INSERT
projection only. Do not mutate queued payloads, change IDs, or loosen constraints.
Existing explicit metadata is retained. Updates and permission checks unchanged.

VERIFICATION: User screenshot and read-only SQLite diagnostics confirm exactly
the two original create events remain, both failing category NOT NULL (8 attempts
at inspection). Fifteen targeted contract/receipt/media tests passed with the real
API stopped and restored; new tests cover null/missing/explicit metadata and
payload immutability for files/folders. PostgreSQL check and deployment pending.

STATUS: Deployed; awaiting live replay verification.

The opt-in PostgreSQL check passed against the existing database using a temporary
table cloned from public.resources, inside BEGIN/ROLLBACK. All seven cases in that
run passed (six contract cases plus PostgreSQL insert). Candidate image
`labos-api:sync-defaults-20261025`, SHA256
`a231724769862560422156bb2b299475329d5a469738edd4c7e54fbce9609b28`,
was deployed with compose --no-deps --no-build; database/storage volumes unchanged.
API/database/storage health passed at 2026-10-25T13:28:40Z. Immediate read-only
outbox inspection still showed two entries with their previous error and nine
attempts; a post-deployment retry has not yet been verified. Do not claim queue
clearance from build/test success. Also check final state of the earlier deleted
resource during acceptance, not merely receipt counts.
