# Resource create/delete ordering — primary agent

Identity: LABOS-P2-PRIMARY; not helper work. V1 safety fix, not phase completion.

MODULE: Resources / synchronization.

FILE: `backend/src/routes/sync.js`; `sync-resource-ordering.test.js` and
`sync-resource-create-defaults.test.js` alongside it.

CURRENT WRITE PATH: Native resource/outbox -> staged bytes -> sync push ->
PostgreSQL transaction + immutable receipt -> native confirmation -> pull.

WHY IT BYPASSES OFFLINE-FIRST: No direct-write bypass. A failed create did not
prevent the same batch's later absent delete from receiving a successful receipt.
Retrying the create after that acknowledgement resurrected a deleted resource.

RISK: Empty outbox can hide incorrect final state and silently lost deletion intent.

RECOMMENDED CHANGE: Never treat absence without a deletion tombstone as proof
of completed deletion. Reject new creates for deleted identities, preserving the
queued work. Serialize different sync mutations for the same resource.

ACTUAL CHANGE MADE:

- Added normalized resource-identity transaction advisory lock for ordinary sync
  resource create/update/delete/attach paths (specialized edit_content/metadata
  paths retain their existing locking).
- Missing resource delete requires a tombstone to return already_deleted;
  otherwise retryable 503 RESOURCE_DELETE_WAITING_FOR_CREATE, with no success
  receipt. Existing desktop failed-receipt behavior preserves/retries the event.
- Create/create_copy rejects tombstones and this account's historical successful
  delete receipts, including older absent-delete acknowledgements. Foreign
  absent-delete receipts cannot poison another account's unused identity.
- Historical successful create receipt replay remains idempotent: it does not
  invoke a new INSERT or resurrect a deleted resource.
- No queued payload rewrite, manual ACK, schema migration, fixture seeding of
  live rows, or cleanup of the actual resurrected resource.

VERIFICATION:

- 19 targeted contract/receipt/media checks passed with actual API stopped and
  restored. Two opt-in PostgreSQL tests skipped in this unit run.
- Candidate real PostgreSQL run: all 12 tests passed (including those two).
  Temporary tables shadow live tables; outer transaction rolled back. The actual
  push handler uses nested savepoints, exercising receipt persistence and status
  classification, not HTTP/auth middleware. Sequence: failed create + delete ->
  both failed/no receipt -> unchanged retry -> create/delete synced -> repeated
  accepted receipts leave resource absent -> new create rejected.
- Also verifies null metadata defaults, UUID lock normalization, tombstoned
  absent delete, owned legacy deletion and foreign-receipt isolation.
- Node syntax and scoped diff whitespace checks passed.

STATUS: Deployed and healthy; live cleanup and full desktop acceptance
remain separate. Candidate `labos-api:resource-ordering-20261025`, SHA256
`030bdf774d21678136f760fb701e1e148e80a3d7b29478d00bd8c82fa2d45c05`.
No desktop rebuild needed. Existing backup remains at
`C:\Users\balik\LabOS-Backups\v1-pilot-20261025`.

BOUNDARIES: This fixes sync resource create/delete ordering, not a claim of an
entire-system tombstone audit. A missing delete with no create ever arriving now
remains pending safely; it is not silently discarded. Actual zero-byte resource
`ac7046e8-a331-4199-af71-0f0564add409` still requires the explicitly requested
repair approval or owner deletion. Nonzero image and all other files untouched.

Post-deployment: API/database/storage healthy at 20:57:41 UTC; read-only desktop
outbox inspection reports zero pending. All 23 rollback-only lifecycle checks
passed again on the deployed image. No claim that these replace desktop CRUD,
offline playback, full-app recovery or cleanup acceptance.
