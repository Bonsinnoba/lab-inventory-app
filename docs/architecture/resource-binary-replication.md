# Resource binary replication — Phase 2

Status (2026-10-12): **server transfer foundation, desktop staging and initial
automatic server-to-PC worker implemented; live acceptance pending.** The guarded
reader now supports both authored files and verified derived PC copies.
Metadata/poster rows alone still do not prove originals exist offline.

## October 12 — native PC-copy worker

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

## Desktop-authored uploads — October 11 continuation

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

## Implemented server contract

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

## Native implementation requirements — acceptance checklist

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

## Acceptance still required

The focused file/handler checks do not exercise PostgreSQL. The phase-end sweep
must use the existing PostgreSQL service and actual desktop with Docker API stopped:
uploads, completed downloaded media, images/PDF/audio/video, large/empty files,
restart/resume, uncertain chunk acknowledgement, replacement, deletion, scoped
members, revoked/disabled accounts, two accounts/devices, storage-full and recovery.
Validate the final hash on PC and local seek/playback offline, then reconnect and
verify no duplicate resources or resurrected deletes. Preserve the current data.
