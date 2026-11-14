# LabOS architecture and operations

Updated: 2026-11-14. Progress lives only in [PLAN](PLAN.md); evidence in [WORK_LOG](WORK_LOG.md). This file records current contracts, operations and website content, not a competing task list.

## Architecture and write contract

```text
Desktop -> native SQLite transaction: authorized projection + immutable outbox
        -> sync worker -> authenticated API -> PostgreSQL effects/audit/receipt
        <- confirmed state / conflicts / tombstones <- authorized server pull
Files: managed PC storage <-> verified resumable transfer <-> server storage
```

Desktop never connects directly to PostgreSQL. Failed local reads/writes must not switch to HTTP. Browser transports are explicitly online, not desktop fallbacks. Deliberately device-local preferences need no outbox. Central security changes and provider/server execution retain explicit online boundaries; a queued intention is not an executed effect.

Stable entity UUIDs/change IDs persist across retry. Business state and outbox commit atomically in SQLite. Server effects, required audit and idempotency receipt share a PostgreSQL transaction. Replay verifies original identity/payload and current authority; it cannot duplicate a record, overwrite newer work or resurrect deletion. ACKs are exact verified receipts, not generic success. Pull preserves pending/rejected authored work and original authorship.

Authorized local deletion records a durable intention; server confirmation/tombstones later propagate it. Metadata deletion is not permission to purge shared bytes, sole recovery proofs or unacknowledged versions. Cached relationships/rows are not positive authorization grants.

## Original-source online viewing

Server download completion, verified PC availability and online provider playback are separate states. The viewer defaults to a verified native copy. When a link has no verified PC copy, an explicit user action may load a recognized YouTube embed directly from YouTube; other supported HTTPS links open the original site in the external browser. Provider embedding restrictions, login requirements or WebView referrer checks can require that browser fallback. LabOS does not proxy or stream the server's downloaded media for this feature, does not pass LabOS tokens to providers and does not mark online viewing as a local download. Browser link previews likewise do not substitute LabOS server media streams for PC copies. No blanket CSP relaxation is permitted.

Player requests begin only after the user's choice. Offline transition, session expiry or audio-focus preemption removes the online iframe; reconnecting does not automatically restart it. A verified PC copy arriving during online viewing does not interrupt the player. The user may explicitly switch to that copy. Server-download/copy wording reflects synchronized metadata and local verification, not a guarantee of current server freshness.

## Resource authority transport and background copies

Authority protocol 4 carries at most 100 unique resource IDs per request, retains complete ancestor/note scope bindings, and uses an explicitly bounded 2 MiB native JSON reader. Protocols 2/3 remain limited to four IDs; ordinary authentication responses keep the 64 KiB default. This requires a coordinated API/native update. Responses remain account/session/origin/revision/lease bound; an incomplete, foreign or malformed grant set cannot be cached as authority.

The bulk authority transport has a 20-second total deadline and five-second connection deadline; ordinary authentication keeps its five-second total deadline. Body limits and all authority validation remain unchanged. HTTP 429 is throttling, not positive authority or permission to fall back to cached login. Failed-password cooldown starts after password verification, so expensive hashing cannot consume its own backoff period.

Resource list defaults remain shallow. Explicit `include_descendants=true` requests all authorized nested rows only when no narrower item/project/note/parent filter was supplied. Ancestor authorization still applies. Desktop overview/report projections use account-fenced metadata reads without waiting for file scans; metadata never establishes local byte availability.

The synchronization resource pull authorizes at most four rows concurrently, preserving query order and each full access/ancestor check. Any failed check aborts the response; a partially checked visibility list must not be applied as a complete snapshot. This bounds database pressure and avoids serial per-resource latency, without creating a cross-request authority cache.

On Windows packaged launches, the logical Roaming directory and physical files can resolve differently. Managed encrypted byte paths anchor to the existing protected key file's canonical parent, with link/reparse, account, origin and authenticated-byte checks retained. No key regeneration or plaintext fallback repairs a mismatch. Save As rejects destinations inside either logical or physical managed profile storage. See WORK_LOG for deployment/verification status; contracts here do not certify an installed candidate.

Background file replication is independent of authored outbox ACKs. Account-scoped local verification identifies already-ready copies; incomplete copies rotate through bounded batches, preserving native resumable progress and security checks. Copy completion refreshes capabilities/UI once per batch. Browser/server download completion is distinct from a verified PC copy. Larger initial collections can take multiple cycles; a queued or copying file must never be shown as locally available merely because metadata exists.

The independent renderer queue (see WORK_LOG for installed-version acceptance) consumes the latest authorized metadata intake and schedules four native chunk calls at least six seconds apart. Each native call still performs its own account/session, current permission, manifest/range, revision, digest, quota and encryption checks. The shared API limit remains 240 requests per minute. New metadata cannot bypass pacing or retry backoff. Transient failures back off from 30 seconds to five minutes; storage/quota exhaustion pauses the whole queue, while isolated file errors retain fair rotation. Logout and account/session replacement cancel abandoned timers. Renderer scheduling hints are not access grants; durable native copy rows and encrypted partial files preserve progress across restart. Copy progress invalidates only resource/file-access and Downloads PC-file queries, separately from full synchronization completion. This conservative pacing is not a certification of initial-copy speed for a large library.

## Authentication and visibility

- Native authority binds account, exact trusted API origin, device/session, lease, revision and ancestor/destination scope. Edit/delete/create-child rights are distinct; old grants acquire no new rights implicitly.
- Privileged offline access uses the approved 24-hour lease. Unknown server revocation cannot be observed offline; verified observed revocation invalidates access. Preserve authored work for controlled recovery.
- Persist server JWTs only through current-user DPAPI/native verified login. Renderer credentials stay in active memory, not persistent localStorage. Passwords never enter outbox/receipts/logs.
- CSP and native transports pin the origin. `localhost` and `127.0.0.1` are different trust identities; never rewrite database origin columns to repair a build mismatch.
- Recheck current actor/credential version/permissions and lock authoritative scope within mutation transactions. Middleware snapshots alone are insufficient.
- Restricted ancestors remain authoritative. Finance, audit, user management and administrative permissions remain separate gates. Expiry/reauthentication preserves drafts/pending work; administrative intentions cannot grant effective offline authority.

## Working encryption and owner recovery

V2 Preview explicitly selects Cargo feature `working-encryption`; personal V1 2.2.5 does not. Never test experimental V2 encryption against personal V1 data.

SQLCipher protects working SQLite/WAL; SQLite temporary storage is memory-only. An origin-bound random workspace key is current-user DPAPI-protected. Managed files use bounded authenticated chunks and path-derived keys. An exclusive profile lease precedes WebView/database access. Keys precede reads; missing/bad keys, schema or markers enter recovery rather than creating an empty replacement.

Migration verifies SQLCipher export/shadow equality and uses protected journals/recoverable renames. Originals retain their recorded protected format. Owner-held recovery format 2 authenticates database/catalogue/files and carries the workspace key only inside ciphertext. Packages use an owner secret, Argon2id and authenticated encryption; possession is not application access. Restore clears device sessions/leases/tokens, preserves original authors/outbox and rewraps keys on the current Windows account. Activation retains the previous workspace. Current-key repair verifies current ciphertext/custodian without replacing newer data with an older snapshot.

Manual retention is owner/session-fenced and protects the latest valid package and sole pending-work proofs. Actual database AND file backups are required; keys alone are not backups. Explicit external exports remain readable plaintext. OS compromise, paging and forensic erasure are outside this at-rest contract. Final deployment acceptance remains in PLAN.

Implementation: [startup](../desktop/src-tauri/src/startup.rs), [migration](../desktop/src-tauri/src/working_migration.rs), [managed encryption](../desktop/src-tauri/src/managed_encryption.rs), [profile recovery](../desktop/src-tauri/src/profile_recovery.rs).

Resource write scopes: [resource-scope-lock.js](../backend/src/resource-scope-lock.js) shares transaction-bound ancestor/note/project/membership/grant locking across the reviewed resource mutations. Callers still authenticate/recheck domain authority in their owning transaction. Direct moves and legacy updates require audit before receipt commit. This is groundwork for tree moves, not a tree-move protocol or a generic permission grant.

## Resources and downloads

SQLite holds metadata, relationships and outbox; bytes live in managed PC files. Server storage is a separate copy. Metadata/thumbnail presence does not prove offline file availability. Native verified-copy capabilities replace bearer URLs.

Folder manifests include actual empty/nested folders and imported logical paths. Canonical destinations and case-insensitive equality/prefix namespace checks prevent collisions. UUID physical storage is independent of display names. Folder upload does not imply full tree reparenting; that remains A5.

Metadata edits preserve original filenames/bytes/storage identity. Explicit user names are never replaced by enrichment. Offline links use an explicit URL fallback; supported bounded metadata enrichment replaces only that fallback. No unrestricted website-fetch proxy is implied.

Saved media links appear automatically in Downloads for scheduling. Desktop queue/settings/control intentions persist locally. Downloads execute on the server when connectivity/schedule allow. Distinguish awaiting schedule, pending intention, server job completion and verified current PC copy. Verify transferred bytes before reporting PC availability. History removal, resource deletion and physical-byte reclamation are separate.

Browser multipart persists a request UUID and uses a byte-bound transactional receipt. Changed content under that identity rejects. Its journal stores neither credentials nor file bytes and does not retain a selected file after a closed tab. Native errors never route into browser multipart.

### Reviewed tree-move protocol (native integration 2026-11-13)

Server primitives: `POST /sync/resources/tree/review` and resource outbox operation `move_tree`, payload `tree_move.protocol=1`. They authorize every descendant and destination on the current transaction and preserve complete reviewed member snapshots plus source/destination context SHA-256. Fingerprints are compare-and-swap evidence, never permission grants. Bound: 500 members and 32 ancestor levels; unsafe legacy paths, incomplete/stale trees, inaccessible members, cycles, path collisions and conflicting project references reject with work preserved.

A move changes only the root parent/context/logical path. Descendant IDs, parent pointers, revisions and storage paths remain unchanged. Current topology and scope locks fence mutations; required audit and the router's immutable receipt commit together. Exact replay cannot duplicate effects/audit. Historical receipts reveal only normal minimal sync ACK fields.

Native folder, file and link roots now use `prepare_local_resource_tree_move` and `move_local_resource_tree`. The native review stores an opaque ticket bound to account, native session, lease, configured origin, exact destination, complete members and containing context. A matching unused review can be reused offline within that login lease. A new tree/destination needs an online review first; this is not unrestricted offline reparenting. The renderer cannot supply a manifest or positive grant. SQLite root projection, immutable `move_tree` outbox event, private before/after proof and ticket consumption commit atomically. Descendants and bytes remain unchanged.

Confirmation protocol **5** binds the exact owned payload and resulting root metadata, including name provenance and relative path. Protocols 1–4 cannot confirm tree moves; a generic ACK cannot clear their native intentions. Pending moves fence further member mutations. Changed membership/context/session, revocation or failed publication preserves existing work. Resource attachment controls expose eligible folder destinations and an explicit verification action on native builds. Individual file/link moves into folders and moves out of an existing folder use this same reviewed path. Pending members must synchronize first. Native-proven pending reviews preserve read continuity without granting further edits; exact confirmed metadata/topology receipts carry an already verified copy revision when byte identity remains unchanged.

This is source implementation with automated native/client/PostgreSQL evidence, not an installed V1 update or final desktop acceptance. Full GUI outage/reconnect, descendant read/copy consumers and recovery UX remain acceptance/review obligations under A5. Do not reinterpret old outbox events or route native failure into HTTP.

### Resource recovery and derived storage (2026-11-13)

Sync status exposes **Saved resource work & device storage** on the updated desktop. The owned recovery index shows pending and archived connected intentions, with a latest-500 disclosure and on-demand review of saved metadata/destinations. Descriptions beyond 5,000 characters are disclosed as excerpts; the original remains in the owner package. Verified native upload/editor versions can be exported through a native save dialog even when the live resource disappeared. Export rechecks account/session, immutable payload/private proof, size and digest; it does not restore permissions, overwrite the live projection or replay retired events. Unknown/unattributed legacy data stays in owner recovery packages; it is not reassigned or treated as verified native provenance. Rejected tree moves archive later member edits and derived-copy intentions as a connected group before retirement.

Device quota defaults to zero (unlimited) and limits **current derived-copy reservations**. It pauses replication instead of evicting work, and is device-local/account-scoped. Historical, authored, partial, unknown and recovery files are not included in a promised total-disk cap. Native retirement records only known superseded hashes. Complete visibility/removal observations fence copies even if the resource was already removed locally, allowing eligible derived copies to be reclaimed after pending work settles. Reconciliation protects the whole account while resource intentions are pending and retains authored versions and copy-source references. Only eligible derived complete files with matching digest and safe non-linked paths are reclaimed. Missing/changed/unknown bytes and uncertain history are preserved for review. No recursive storage sweep is used.

Server cleanup considers only filenames belonging to a known download attempt while its advisory lease is held, after an affirmative finish COMMIT. Changed/active/lost attempts and uncertain COMMIT do not authorize cleanup. Current stored paths, shared references, structured version/history/receipt references and symlinks protect artifacts. Published/authored/recoverable/unknown historical storage is retained; this does not promise aggressive whole-server garbage collection. Logical deletion/access revocation is separate from physical retention.

DOCX native execution uses the verified bundled engines with a startup handshake: at most 45 seconds to load the selected engine, followed by at most 20 seconds for conversion. Readiness can reset the deadline once; memory/output/input limits, isolation, process termination and no-server fallback remain. This addresses cold engine loading consuming the old conversion budget without allowing unbounded work or automatic duplicate retries.

## Approved domain decisions

| Concern | Contract |
|---|---|
| Custody | Quantity-first, optional serials. Assignment is responsibility, not physical issue. Support split issues/transfers/partial returns/outstanding balances; only authorized handlers post movements. Consuming issued stock must not deduct storeroom stock twice. |
| Demand | One canonical project requirement referenced by tasks/experiments; extra demand explicit. Canvas references do not duplicate/delete underlying records. |
| Cancellation/settlement | Release unused reservations only. Issued stock stays outstanding until return/consumption/loss. Unsettled projects may be archived but not called settled; preserve results/audit/finance history. |
| Salvage | Keep original consumption/cost/source history; quarantine for inspection. Human-reviewed recovery value is separate from expense/cash. Unknown stays unknown. |
| Assistant | Persist editable proposals; humans explicitly approve authorized planning graphs. No silent consumption/spending/grants/scientific results. |
| Voice | User-initiated/cancellable; explicit processing disclosure/consent; configured server transcription first. Editable transcript reviewed before insertion/send; no automatic submission/offline-recognition claim. |
| Audio | One music/lab-media/TTS/microphone coordinator; preserve position/volume/manual pause and reject stale callbacks. |
| Preferences | Notifications per account through versioned SQLite/outbox/server rules. Music volume/auto-pause device-local within the account; intentionally no sync event. |
| Legacy ownership | Never infer ownership of unattributed rows from current login. The historical owner-requested reset was one-time, not ongoing reset permission. |

## Personal V1 and isolated V2

| Environment | Endpoint / identity | Boundary |
|---|---|---|
| Personal V1 2.2.5 | `http://localhost:4010/api`; `com.lab-inventory.app.v1` | Pinned existing API image; private PostgreSQL/storage. Preserve data/pending work. |
| Current V2 acceptance | `http://127.0.0.1:4000/api`; DB `labos_phase2_acceptance_20261106`; encrypted acceptance profile `com.labos.phase2.encryptionacceptance` | Namespaced test fixtures; separate from ordinary Preview and V1. |
| Standard Preview build | Wrapper pins frontend/native/CSP; isolated Preview identity | Never install over V1 or reuse its database for tests. |
| Installed 2.3.1 Preview (November 13) | `http://127.0.0.1:4020/api`; `com.labos.preview.v2rc20261113`; DB `labos_v2_preview_20261113` | Separate encrypted profile, restricted role and `labos_v2_preview_storage_20261113` volume; testing preview only. |

Start existing personal V1 services without rebuilding WIP source:

```powershell
docker start labos-v1-db-1
# Wait for database health before starting the API.
docker start labos-v1-api-1
Invoke-RestMethod http://localhost:4010/api/health
```

Open **LabOS V1** using its installed shortcut. Last verified version: 2.2.5; repository package.json is not the installed-version source of truth. Last observed launch reached login after lease expiry; no bypass/reset was performed.

Open **LabOS V2 Preview** using its installed shortcut or `%LOCALAPPDATA%\LabOS V2 Preview\LabOS V2 Preview.exe`. This candidate contains synthetic fixtures, not a copy of V1 work. Keep V1 for daily-use data until stable acceptance and a separately verified migration/backup plan. Never copy its profile over V1.

With Docker Desktop running, start the existing preview without rebuilding/resetting:

```powershell
docker start labos-db-1
# Wait for PostgreSQL health before starting the API.
docker start labos-v2-preview-api-20261113
Invoke-RestMethod http://127.0.0.1:4020/api/health
Start-Process "$env:LOCALAPPDATA\LabOS V2 Preview\LabOS V2 Preview.exe"
```

The ignored `.tmp/v2-preview-20261113/optimization2/` holds the 2.3.1 installer, candidate metadata, profile backup and acceptance records; its parent retains the 2.3.0 evidence and private `server.env`. Retain the environment file privately; never publish its database/JWT secrets. This image is self-contained: checkout edits do not update the running API.

For outage acceptance, stop only the selected V2 API, leave its PostgreSQL/volumes intact, test the desktop, restart the same API and verify health. Record/restore prior service state. Do not stop unrelated Docker work or remove volumes as a shortcut.

## Responsiveness diagnostics

The final release protocol is in PLAN. `desktop/scripts/measure-desktop.ps1` is an opt-in Windows resource sampler for an explicitly selected V2 Preview/development process and its descendants. It refuses V1/other process names and refuses to overwrite an existing report. Supply the actual process ID, duration and a new output filename; for example, with the installed Preview running:

```powershell
$previewProcess = @(Get-Process -Name 'LabOS V2 Preview')
if ($previewProcess.Count -ne 1) { throw 'Select exactly one V2 Preview process before measuring.' }
& ./desktop/scripts/measure-desktop.ps1 -TargetProcessId $previewProcess[0].Id -DurationSeconds 120 -OutputPath ./.tmp/v2-preview-resource-sample.json
```

Samples include process identity/start time, cumulative CPU seconds, private/working-set memory, handles and the root's OS responsiveness flag. They exclude command lines, file/document titles, credentials and unrelated applications. Reports stay local; sample collection never changes app data. CPU deltas must be compared over elapsed time; an OS responsiveness flag is not proof that the renderer is interactive. Pair this with renderer/native traces and measured interactions, not a resource-only performance verdict. Use new reports for before/after and comparable idle checkpoints.

The first native optimization provides two background read lanes with a bounded outstanding queue. Slow-read diagnostic messages contain fixed command labels and queue/work milliseconds only; they are developer stderr diagnostics, not a persisted release tracing system. Broader profiling and installed soak acceptance remain required.

## Development and builds

From `desktop`, `npm run dev` serves the web frontend and `npm run dev:tauri` starts native development. These are not installed V1 launch commands. Install locked dependencies with `npm ci` in the appropriate build source; do not overwrite daily-use installation to test a build.

`npm run tauri:build:preview` invokes [build-preview.mjs](../desktop/scripts/build-preview.mjs), pins API origins and selects working encryption. Supply another approved endpoint consistently through `LABOS_NATIVE_API_BASE` and optionally identical `VITE_API_BASE_URL`; no credentials/query/fragment. Windows builds require Rust/MSVC/Tauri prerequisites. Vendored OpenSSL needs complete native Perl, not Git's trimmed Perl. Managed build tools or a verified static OpenSSL build (`OPENSSL_DIR`, `OPENSSL_STATIC=1`, `OPENSSL_NO_VENDOR=1`) are build-only dependencies. Preserve the isolated DOCX converter/runtime in packaged builds.

## Safe update, backup and restore

1. Select exact installed stable source and allowlisted backports; build/test first. Record source/artifact identity separately for V1 and V2.
2. Quiesce the target after saved-edit authorization. Back up SQLite, managed files and WebView/music storage. Verify hashes, integrity and pending identities; retain old executable and receipts.
3. Install a uniquely versioned update preserving profile/endpoint. Compare data BEFORE reopening; pending work must remain.
4. Reopen; verify installed version/window and service health. Distinguish source tests from signed-in desktop acceptance. Restore only through a reviewed procedure that preserves newer work.

Last verified local backup: `.tmp/v1-install-backup-20261107`; receipts: `.tmp/v1-stable-20261107`. These ignored machine-local paths are not portable release assets. Server backups need matching PostgreSQL and storage; test restore in an isolated destination. Never use volume removal, storage deletion or outbox clearing for updates.

## Website content and new-lab configuration

This replaces the separate website Markdown file. Exact previous copy remains as `docs/LABOS_WEBSITE_CONTENT.md` inside the history archive. Distinguish personal V1 availability, V2 source implementation and completed deployment acceptance. Never advertise planned work as shipped.

**Product copy:** LabOS connects projects, tasks, experiments, inventory, BOM/reservations, resources, notes, canvas, financial evidence and laboratory history in one desktop workspace, with a self-hosted central server and authorized local working storage.

Website sections: downloads/version/platform/checksums and release notes; workflows and features; offline/sync boundaries; permissions; server configuration; backups/recovery; provider/media dependencies; troubleshooting and known limitations.

### Configure a new lab

1. Choose a server with persistent PostgreSQL/file storage. Inspect [compose](../deploy/docker-compose.yml), [Dockerfile](../deploy/Dockerfile.backend) and [environment example](../deploy/.env.production.example).
2. Create a private `.env.production` without overwriting an existing environment. Set unique database credentials and JWT secret; keep `PG*`/`POSTGRES_*` identities consistent. Set public URL, allowed origins, storage/upload limits, proxy trust and optional providers.
3. Review actual ports/firewall/TLS. The example compose publishes `4000:4000`; do not assume its bind environment variable alone restricts that mapping. PostgreSQL need not be public. Reverse-proxy examples are under `deploy/nginx`.
4. Build/start the reviewed server release using its compose/environment; verify `/api/health` and follow that release's migration/account-provisioning procedure. Never invent default admin credentials or publish actual secrets.
5. Install the matching desktop configured for the exact API origin. Verify initial authorized sync and local file copies before relying on offline use. A web preview is not native acceptance.
6. Establish matching server database/storage and desktop/recovery backups, then test isolated restore. Optional provider/media tools and supported sources are configured dependencies, not universal guarantees.

**Boundary copy:** authorized retained data can remain usable offline. First-time authentication, unknown revocation, external downloads, AI and transcription retain their connectivity/lease/provider constraints. Cached reports disclose freshness/completeness. Unsupported presentations may open externally in V1. Server completion does not prove a current PC file; encryption source implementation is not final V2 certification.

Publish tested release-specific installer/server links and checksums when available. Do not invent download URLs, licensing terms, platform support or security/recovery guarantees.

## Documentation and history

Maintain only PLAN, WORK_LOG and REFERENCE; README is the short entry point. Status belongs in PLAN, dated evidence in WORK_LOG, decisions/runbooks here. No new per-change/helper Markdown reports.

[History archive](archive/history-through-2026-11-08.zip) contains exact previous central files, README, website copy and earlier reports at original relative paths. `_MANIFEST.json` records lengths/SHA-256. Extract/verify in a separate inspection directory. Old five-phase plans, status tables and helper assignments are history; they cannot reopen or close current work. No historical scope/evidence was discarded.
