# LabOS architecture and operations

Updated: 2026-11-20. Progress lives only in [PLAN](PLAN.md); evidence in [WORK_LOG](WORK_LOG.md). This file records current contracts, operations and website content, not a competing task list.

Current installer: `desktop/src-tauri/target/release/bundle/nsis/LabOS V2_2.3.21_x64-setup.exe`, 34,256,196 bytes, SHA-256 `c360f164ee45006f15468a2adcf9cb41e6144b41117569846e93fe25020bc738`. The earlier 2.3.20 delivery below is historical.

## Assistant context controls (personal 2.3.21, November 20)

Open context from the composer chip. The selector stays above that composer inside the assistant panel; the workspace remains available. Choose a scope, then its project or custom data sources, and click Apply context. Missing selections show neutral guidance and disable Apply. Scope/project clicks alone do not change the active context or issue a preferences request. Cancel, Escape or clicking outside discards the draft. While applying, duplicate submission and dismissal are blocked. A failed or mismatched confirmation retains the previous active context; session changes discard late acknowledgements. Sending waits until the selector is closed and context saving has finished. Existing server authorization remains authoritative.

History opens below the header without a full-screen backdrop. Selector, composer and suggestions use appearance tokens, muted borders and a soft visible focus halo, including pure black/white. Short panels scroll the selector body to retain its footer. These changes are installed in personal 2.3.21. Isolated browser checks passed; full native/outage/performance acceptance remains separate.

## AI providers: cloud now, server-local infrastructure later (personal 2.3.21)

Personal 2.3.21 and its coordinated API are installed. The additive 20261120_ai_provider_settings migration is applied; existing PostgreSQL/storage are preserved and credentials use the separate labos_personal_v2_ai_secrets_20261120 volume at /app/private. No real cloud key has been configured/tested and no local inference engine/model is installed.

Administrators use Settings → AI & Models. For cloud, choose Google Gemini or an OpenAI-compatible endpoint, enter the exact provider model names and select Encrypted server credential to enter/replace an API key. Save changes with the profile disabled, run Test saved connection, then enable and save. Assign chat, planning and optional transcription independently to a profile or Disabled. Chat probes perform a complete synthetic function-call/result roundtrip; planning probes validate synthetic JSON. Audio still needs an actual consented recording acceptance test. Only Gemini audio currently has an adapter; local/compatible audio is unavailable. Changing model/credentials/endpoint invalidates prior readiness. Blank managed-key input preserves a compatible saved key; choosing credential source None removes it. Environment mode uses the server's GEMINI_API_KEY and is supported only for Gemini. Unsaved installations retain legacy environment bootstrap. No configuration/credential request is queued offline.

Every model request goes through the authenticated LabOS API, not directly from a desktop to a model service. Existing read permissions/context scopes and planning approval remain authoritative. There is no automatic cloud/local fallback; changing assignments is an explicit administrator action. Local inference can work without internet while the PC still reaches the lab server. A PC disconnected from the lab server cannot use a model hosted there.

Provider credentials are server-only encrypted database fields. The encryption key is generated in LABOS_AI_SECRET_DIR/master.key (0600 on Linux), or supplied as a canonical base64-encoded 32-byte LABOS_AI_MASTER_KEY. The normal Compose file persists /app/private in labos_ai_secrets; manually managed containers must mount equivalent persistent private storage before credential configuration. Protect and recover this master key separately from PostgreSQL: a database dump alone cannot decrypt credentials, and the desktop recovery package does not automatically include this server volume. Never put this key in source control, a container image, public resource storage or client sync. Stored credentials cannot be displayed; replacement is write-only. Remote administration containing a new API key requires HTTPS, or use loopback on the server PC. A Docker port published exclusively on host loopback may relay the PC connection through a gateway address. Only for that verified deployment, set LABOS_AI_TRUSTED_LOOPBACK_PEERS to the exact observed relay IP (never a private subnet or wildcard); the request must also use a loopback hostname. The default trusts no relay. Do not use this opt-in with a publicly/LAN-published HTTP port, and do not trust forwarded headers. This personal deployment uses 127.0.0.1:4010 and the explicitly verified 172.21.0.1 relay.

Compatible cloud endpoints default to https://api.openai.com/v1. Additional cloud origins require the operator's LABOS_AI_CLOUD_ORIGINS. Local defaults cover labos-model:11434, localhost/127.0.0.1:11434 and host.docker.internal:11434; approve a different server origin through LABOS_AI_LOCAL_ORIGINS. Endpoint URLs are interpreted on the API server, not the desktop. Approved-origin policy, fixed /v1 paths and redirect refusal protect the key-bearing request boundary.

Future local setup: choose hardware/runtime/model first. The optional deploy/docker-compose.local-ai.yml overlays the main Compose file under profile local-ai. It requires LABOS_LOCAL_MODEL_IMAGE with a reviewed pinned image; no default image is pulled and no model is downloaded automatically. LABOS_LOCAL_MODEL_CPUS and LABOS_LOCAL_MODEL_MEMORY bound the service (defaults 2 CPUs / 8 GiB; review against actual hardware before use). Its model files persist separately, and no inference port is published. Configure/load the selected model separately, save the disabled local profile, test it and enable only after acceptance. GPU provisioning, actual model choice/download and hardware throughput remain future work.

Runtime limits apply to both provider types: 1–4 concurrent requests, 0–32 queued, 5–60 seconds per call including waits, and 256–8192 output tokens. Local inference also has a single active-request ceiling. Probes use synthetic data, a 256-token ceiling per call and a 120-second overall deadline. Recent chat history is limited to 40 messages / 64,000 characters. These bounds and container separation do not constitute measured responsiveness or server load sign-off.

## Notebook and resource viewer controls

**Included in personal 2.3.21 (November 20):** Undo/Redo move to the notebook header; Delete moves under Note actions with confirmation. Symbols open a compact island popover. In the rich note body, paste a screenshot from Windows+Shift+S with Ctrl+V. PNG/JPEG/WebP/GIF clipboard files are supported up to four at once / 20 MiB each. The desktop saves them through managed local resources/outbox; the browser needs connectivity. Save the note after insertion to retain its reference. Removing or undoing an image reference does not delete its file from Resources; a saved image also remains there if a paste is cancelled. Existing-note pastes attach to that note; new unsaved notes use a selected project if present, otherwise retain standalone resource files. Preview requires the current account's authorized file copy; an unavailable image can be retried after synchronization. Installed/native OS clipboard acceptance is not claimed by the synthetic browser checks; the owner authorized the 2.3.21 installation.

**Visual-editor correction delivered in 2.3.20:** the toolbar now applies visible marks and structured editable blocks directly in the editor. Fonts apply to selected text/future typing and persist. Read mode displays the same document; authors need not type or inspect markup. Markdown remains the internal save representation for compatibility with the existing string body and sync contract. The earlier source/preview description below records 2.3.19 behavior and is superseded by the installed 2.3.20 visual editor. A large-note fallback is explicitly source-only, retains all text and disables rich editing above 200,000 characters / 4,000 lines. Current delivery status remains in PLAN.

These changes and the visual-editor correction are included in personal **2.3.20**, installed/reopened November 20. Installer: `desktop/src-tauri/target/release/bundle/nsis/LabOS V2_2.3.20_x64-setup.exe`, 34,257,245 bytes, SHA-256 `fe1f727702eafdf67e4dd75040f7dc4921a2075023391a34dae91caec5b3f7a5`. Identity remains `com.labos.personal.v2`, API `http://localhost:4010/api`. Closed data profiles were preserved; the existing server was unchanged. Startup observation is not full native/offline/performance acceptance or public stable release sign-off.

The November 19 source notebook composer retains existing plain-text note bodies and the normal authorized Save path. Its bottom island inserts Markdown for paragraph/headings, bold/italic/underline/strike, lists/checklists, table templates, quotes, dividers, code and collapsible sections. Edit shows the stored source; Preview renders the supported subset without executing arbitrary HTML. Checking a preview task changes the draft and still requires Save. Font choices affect the current editor display, not persisted inline typography. Preview has explicit character/line limits for responsiveness; the complete source remains editable. This is not a full WYSIWYG/CommonMark editor.

Existing LabOS resource insertion creates a stable reference, leaving file location and permissions unchanged; selecting it opens the existing authorized viewer. Upload new files through Resources. External image/video/link URLs are not copied or made available offline by inserting them, require their source connection, and remain subject to the existing app content-security/host/codec policy. Do not broaden CSP or bypass the managed-file path to make arbitrary remote media load. Existing managed resources are the reliable offline reference path. Videos never autoplay from note preview.

The owner-refined viewer keyboard contract is contextual: plain Left/Right changes loaded PDF pages, stopping at page boundaries, or changes immediate sibling files for non-PDF folder contents. An unloaded PDF cannot fall through into another file. Shift+Left/Right moves through the supplied outer collection, using the originating folder's position when leaving an inner file. Compare panes retain separate sibling lists and outer anchors; pointer/focus chooses the active pane. Repeat copies both contexts; explicit Change resets them. Inputs/selectors/buttons/editable text and focused media keep their own controls. Closing the viewer preserves the underlying folder-browser location. Package/installed availability is listed in PLAN, not inferred from this source contract.

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

## Bounded overview reads and server performance measurements

Dashboard, Reports, Operations, Automation and local reservation review use one five-second collection budget and at most four pending native project reads per view. Failed, timed-out and unstarted records remain unknown; later completions cannot alter the published snapshot. Each scheduled read and publication checks the current account. The deadline does not cancel an already-running native invoke. It stops new scheduling, avoiding another wave of timed-out work. Readable sections remain visible; partial reservation coverage makes competing allocations unknown rather than zero. These are read projections, with no outbox mutations or HTTP fallback.

Updated API source supports `LABOS_SERVER_PERFORMANCE_PROBE=1`; the default is disabled. Enable it only in an updated server deployment when collecting a controlled measurement. Every ten seconds it writes a `LABOS_PERFORMANCE` JSON record to the private server console: numeric process memory/CPU, event-loop delay/utilization, pool total/idle/waiting counts, active requests and fixed API-group completion/error/throttle/abort counters. No diagnostic HTTP endpoint is exposed. It records no request URLs, SQL, identifiers, headers, tokens, documents or audio. Per-group latency percentiles use only the last 512 completions in that interval; counts and maximum cover all interval completions. CPU percentage represents core usage and can exceed 100%. This is bounded observational instrumentation, not a full query-plan profiler or proof that release performance budgets passed. The personal live API was not rebuilt or reconfigured by the November 18 acceptance runs.

Renderer measurements reset their heartbeat baseline when a window becomes visible, so background timer throttling is not mislabeled as a foreground freeze. Unsupported WebView performance observers are marked unavailable and disconnected; heartbeat measurement and normal app startup remain usable. None of these measurements replaces the required sustained mixed-use/device tests.

## Original-source online viewing

Server download completion, verified PC availability and online provider playback are separate states. The viewer defaults to a verified native copy. When a link has no verified PC copy, an explicit user action may load a recognized YouTube embed directly from YouTube; other supported HTTPS links open the original site in the external browser. Provider embedding restrictions, login requirements or WebView referrer checks can require that browser fallback. LabOS does not proxy or stream the server's downloaded media for this feature, does not pass LabOS tokens to providers and does not mark online viewing as a local download. Browser link previews likewise do not substitute LabOS server media streams for PC copies. No blanket CSP relaxation is permitted.

Player requests begin only after the user's choice. Offline transition, session expiry or audio-focus preemption removes the online iframe; reconnecting does not automatically restart it. A verified PC copy arriving during online viewing does not interrupt the player. The user may explicitly switch to that copy. Server-download/copy wording reflects synchronized metadata and local verification, not a guarantee of current server freshness.

## Resource authority transport and background copies

Authority protocol 4 carries at most 100 unique resource IDs per request, retains complete ancestor/note scope bindings, and uses an explicitly bounded 2 MiB native JSON reader. Protocols 2/3 remain limited to four IDs; ordinary authentication responses keep the 64 KiB default. This requires a coordinated API/native update. Responses remain account/session/origin/revision/lease bound; an incomplete, foreign or malformed grant set cannot be cached as authority.

The bulk authority transport has a 20-second total deadline and five-second connection deadline; ordinary authentication keeps its five-second total deadline. Body limits and all authority validation remain unchanged. HTTP 429 is throttling, not positive authority or permission to fall back to cached login. Failed-password cooldown starts after password verification, so expensive hashing cannot consume its own backoff period.

Resource list defaults remain shallow. Explicit `include_descendants=true` requests all authorized nested rows only when no narrower item/project/note/parent filter was supplied. Ancestor authorization still applies. Desktop overview/report projections use account-fenced metadata reads without waiting for file scans; metadata never establishes local byte availability.

Native availability and copy-status scans retain one SQLite read transaction across cooperative worker turns. At most two scans retain snapshot state, with at most 64 outstanding requests; excess requests return a retryable busy error without changing saved work. Each turn examines at most 16 records or approximately 75 ms, yielding between records so other responsive reads can run. A single record may exceed the time target. Existing per-file authorization, encrypted-byte identity, origin, revision and path checks remain; completion commits the read transaction and rechecks current account/lease/permission before publishing the complete result. Failure/cancellation drops the connection without publishing partial results. Concurrent observational client reads may share an in-flight scan only within the same account session; post-write refreshes still request fresh work. Total scan duration remains distinct from worker occupancy, and neither metadata nor scheduling hints grant file access.

The desktop Resources page reads authorized SQLite metadata separately from the slower file-proof query. Metadata controls membership, titles, ancestry and current revision; matching scan results can supply only local availability/pending/copy fields. A changed revision, kind or downloaded-media identity discards the older availability result. Missing proof is NOT VERIFIED, never proof of a running copy or readable bytes. Filters for local files require positive verification. Independent availability and copy-status scans start concurrently, with existing same-session coalescing and native scheduling bounds retained. Manual refresh requests both metadata and file proofs; background copy invalidation reaches both queries. Browser reads retain their existing online transport. Deployment and acceptance evidence belong in WORK_LOG.

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

V2 Preview and personal V2 explicitly select Cargo feature `working-encryption`; legacy personal V1 2.2.5 does not. Personal V2 uses a verified migrated copy; never test new encryption against the preserved V1 originals.

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

## Daily personal V2 and isolated historical environments

| Environment | Endpoint / identity | Boundary |
|---|---|---|
| Daily personal V2 2.3.21 | `http://localhost:4010/api`; `com.labos.personal.v2` | Installed/reopened November 20. Registry/executable match the candidate; closed comparison preserved 874 roaming / 1216 WebView entries and selected critical hashes. Existing personal PostgreSQL/storage preserved, AI settings additive migration deployed. Cloud key/local model not configured; native, outage and sustained client/server acceptance remain open. |
| Historical V1 2.2.5 | `com.lab-inventory.app.v1`; original port 4010 | Retired November 17 by owner decision. Old API/database containers, API images and V1 volumes removed. Not a runnable rollback. File-backup deletion remains blocked. |
| Historical V2 acceptance (November 6) | `http://127.0.0.1:4000/api`; DB `labos_phase2_acceptance_20261106`; encrypted acceptance profile `com.labos.phase2.encryptionacceptance` | Namespaced test fixtures; separate from ordinary Preview and V1. |
| Standard Preview build | Wrapper pins frontend/native/CSP; isolated Preview identity | Never install over V1 or reuse its database for tests. |
| Installed 2.3.1 Preview (November 13) | `http://127.0.0.1:4020/api`; `com.labos.preview.v2rc20261113`; DB `labos_v2_preview_20261113` | Separate encrypted profile, restricted role and `labos_v2_preview_storage_20261113` volume; testing preview only. |

With Docker Desktop running, start the existing migrated personal server from the repository root:

```powershell
& ./deploy/scripts/start-personal-v2.ps1
```

This starts only `labos-personal-v2-db-20261114`, waits for PostgreSQL readiness, starts `labos-personal-v2-api-20261114` and checks `http://localhost:4010/api/health`. It never seeds, rebuilds or deletes volumes. If an existing container is missing, investigate rather than creating an empty replacement.

Open **LabOS V2** from its desktop shortcut, targeting `%LOCALAPPDATA%\LabOS V2\LabOS V2.exe`. The normal Windows profile is `%APPDATA%\com.labos.personal.v2`. Launch from the ordinary Windows shortcut: launching from the packaged Codex process can redirect AppData into the Codex package cache. Do not copy keys/databases between redirected and ordinary profiles to work around that boundary.

Personal V2 is the current baseline. On November 17 the owner requested retirement of historical backups, retaining the documented transition. V1 server containers, old API images and original V1 volumes were removed; the old V1 installation/profile alone cannot serve as a verified rollback. Historical workspace backup folders/dumps remain because automatic approval review blocked their deletion. Preview remains an isolated test environment; never substitute its fixtures for personal lab data.

Reproducible personal build, from `desktop`:

```powershell
npm run tauri:build:personal
```

The wrapper selects `tauri.personal.conf.json` and `working-encryption`, validates matching frontend/native API origins, and defaults to `http://localhost:4010/api`. Personal and Preview identities remain separate. Eleven shared/personal build-environment regression checks passed. Personal 2.3.14 and subsequent packages use this wrapper; source edits alone do not replace an installed executable. Verify the version and installer receipt for each update.

Migration backups and receipts are private in `.tmp/personal-v2-migration-20261114/`. They include real data and secrets: do not commit, publish or distribute the directory. They are machine-local, not verified off-machine disaster recovery. Original V1 server volumes were removed November 17; do not use earlier retention statements as current rollback instructions.

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

The final release protocol is in PLAN. `desktop/scripts/measure-desktop.ps1` is an opt-in Windows resource sampler for an explicitly selected personal V2, V2 Preview or development process and its descendants. It refuses V1/other process names and refuses to overwrite an existing report. Supply the actual process ID, duration and a new output filename; for example, with the installed Preview running:

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

Historical backup evidence: `.tmp/v1-install-backup-20261107`; receipts: `.tmp/v1-stable-20261107`. Owner requested historical backup deletion November 17; filesystem cleanup was blocked and must not be assumed complete. These ignored machine-local paths are not portable release assets. Server backups need matching PostgreSQL and storage; test restore in an isolated destination. Never use volume removal, storage deletion or outbox clearing for updates.

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

## Device-local music organization

Active implementation: MusicDock + MusicLibraryBrowser, with musicLibrary.ts storage/queue helpers. IndexedDB `labos-local-media` version 3 preserves existing `tracks` and `playlists`, adding `state` and a content lookup index. Imported music is copied onto this device; music is not implicitly published through lab-resource synchronization. Files/folders are reviewed before import. Identical-byte fingerprints prevent duplicate imports; membership is unique within each queue/playlist, while the same track may belong to multiple playlists. Queue position/order/preferences persist and restore paused. Use explicit Resume, Replace or Merge for an existing folder/playlist queue. Deleting a playlist/queue does not delete library audio. Removing library audio updates stored references atomically and leaves original source files unchanged.

Developer acceptance fixture: run desktop Vite on loopback port 15317, then open `/test-fixtures/music-library/index.html`. Its guard restricts seeding to that dedicated origin and uses generated audio only. It exercises old-store upgrade and committed transaction behavior before mounting the real player. Never use this fixture to seed the installed personal app or a live-data origin. Native OS folder-drop routing remains a separate acceptance check.

## Appearance background preferences

In Settings → Appearance, select Tinted theme, Pure white / black, or Custom background. Accent selection is separate; choose a named accent to leave custom-accent mode. Pure white/black follows light/dark mode. Custom backgrounds choose readable text/control color scheme automatically. Preferences stay on this device in the existing `lab-inventory-theme` browser setting; old mode/color records retain the tinted look. No server write or outbox event is needed for these device-local choices.

The shared Resource Viewer uses the same variables for its shell, panes, file headers, picker and navigation. Original document/media colors are preserved. Embedded third-party playback has its own provider appearance. Developer fixture: loopback port 15318, `/test-fixtures/appearance/index.html`; synthetic resource only, with controls to change the actual viewer live. It is not a production HTML entry.

Music presentation: the library's Player tab returns to Now Playing; folder/song views expose imports, while queue/playlist views prioritize their contents. The header + creates a queue/playlist. Row … opens extra song actions; queue … contains rename/clear/delete. Embedded title/artist/album tags are cached when the selected song is inspected, with original filename/path retained. Queue grips support dragging and adjacent up/down controls provide a keyboard alternative. Import review/summary stays inside the scrollable library, and the selection toolbar stays visible while scrolling. These source changes still require a coordinated installed update.
