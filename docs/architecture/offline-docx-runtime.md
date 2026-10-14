# Offline DOCX runtime contract

Owner decision, October 13: bundle an isolated converter rather than reduce DOCX
editing to plain text. Users must not install Node or use a server for conversion.
This is an implementation contract, not a claim that offline DOCX is finished.

## Existing foundation

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

## Native implementation checkpoint (October 13)

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

## Implementation contract and remaining verification

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

## Acceptance

Run the packaged runtime from outside the repository with no host Node dependency.
Test real offline opening/edit/copy/save, restart, queued transfer and reconnect
against existing PostgreSQL. Include formatting, embedded images, unsupported
features, corrupt ZIP/XML, high compression, external relationships, unsafe links,
hang/crash, disk-full, permission/lease expiry, account switching, conflict,
replay/lost acknowledgement and unchanged original. Collect independent failures
in the phase-end sweep before grouped correction/retest. A worker-only smoke test
is not native desktop or database acceptance.
