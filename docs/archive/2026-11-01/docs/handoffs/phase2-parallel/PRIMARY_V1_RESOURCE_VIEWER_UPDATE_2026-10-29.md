# V1 resource upload and viewer update — primary

Scope authorized by owner: fix resource batch uploads, Windows drag/drop, folder
upload/browsing, movable minimized viewer, 99% expansion, toolbar placement,
collapsible file headers, media display ratios and reachable zoom/pan; update V1
before returning to Phase2. This explicitly authorizes this V1 hotfix, superseding
the earlier development-only boundary for these named changes.

## Plan and implementation

1. Reuse native offline file staging/outbox and existing folder APIs. Read all
   selected files; enumerate dropped directories through every reader batch;
   preserve relative paths. Bound uploads to200 files and directory traversal to
   2,000 entries/32 levels; reject unreadable/empty selections visibly.
2. Disable Tauri's native file-drop interception in base, Preview and V1 window
   configuration so Windows HTML drag/drop reaches Resources. Installed schema
   explicitly documents that this is required for frontend drops on Windows.
3. Upload loose files and folder groups through existing adapters. Track confirmed
   successes and created folder IDs during a selection, skip them on retry and
   keep original destination/metadata fixed. Do not fall back to HTTP on native
   errors. Folder children continue using existing atomic native batch staging.
   A cancelled/closed selection does not erase already saved resources.
4. Show top-level resource cards with folder entry into the existing grouped
   manifest browser. Open its files in the same viewer, including documents and
   the existing external-presentation action. Closing the folder browser before
   opening a file allows minimization to reveal the workspace.
5. Keep viewer panes mounted while minimized; a movable icon restores them without
   discarding zoom/page/media state. Middle toolbar holds preview controls;
   minimize/normal/expanded/close sit on the right. Expanded mode99vw/99vh.
6. Toggle secondary file bars; image/video panes have independent original,
   16:9,4:3,1:1,9:16 display ratios. These affect display, not saved file contents.
7. Replace image/PDF centered scale-only layout with measured scrollable extents,
   top-left transform origin, center-preserving zoom and pointer-captured drag
   panning. Image corners and PDF page tops remain reachable with scrollbars/pan.

## V1 isolation and packaging

The installer uses a separate source snapshot at
`.tmp/v1-resources-20261029/source`, based on HEAD `ffbfb22`, with only eight
named resource/viewer/drop-configuration files overlaid. Dirty Phase2 project,
reservation, salvage, authentication/sync implementation changes were excluded.
The V1 staged sync source contains no salvage pull endpoint. No API image,
PostgreSQL migration, database reset or managed-resource relocation is required.

Only staged package/native/lock/package metadata is bumped to2.2.2. Identifier
remains `com.lab-inventory.app.v1`; both API endpoints are explicitly
`http://localhost:4010/api`. Existing bundled DOCX runtime is included unchanged.
Build: TypeScript/Vite PASS; optimized native build PASS6m17s; NSIS PASS.
Installer31,856,069 bytes:
`desktop/src-tauri/target/release/bundle/nsis/LabOS V1_2.2.2_x64-setup.exe`.
SHA256 `1F1CB403809B36F3F597EAFC677C38EC583281EEA2E83DC688F09A007FC91FFB`.

## Verification

-20 focused selection and resource API checks PASS, including complete directory
  reader pagination, nested paths, multi-file fallback, unreadable/empty/oversize
  selection handling and existing native folder/create/manifest/move boundaries.
- Main source TypeScript PASS; isolated V1 TypeScript and production frontend PASS.
- Actual browser interaction with generated test imagery PASS: zoom expands
  scrollable extents; drag changes horizontal/vertical scroll and reaches top;
  minimize reveals workspace; floating icon drag changes position without
  restoring; click restores; expanded dimensions98.999% each; header hide/show;
  split panes expose independent aspect-ratio selectors.
- Initial floating drag observation used stale screenshot geometry after browser
  viewport changed. Fresh coordinate-backed retry and captured pointer events
  verified correct drag suppression; no source change was needed.
- Browser fixture uses no real lab records/uploads. Windows Explorer -> installed
  WebView drop and upload persistence/reconnect still need actual desktop smoke
  acceptance; browser selector tests do not prove OS drag integration.
- Source whitespace check PASS. Existing unused native resolve_conflict warning.

## Backup and installation

Owner confirmed all edits saved and approved backup, update and reopening.
Exact installed V1 process closed; top-level profile files and previous executable
copied to `.tmp/v1-resources-20261029/pre-update-backup`. Source/copy database
SHA256 matched and backup SQLite quick_check returned `ok`. Resource-files and
resource-copies directories remain untouched. This is a local hotfix rollback
backup, not a new whole-server/off-device disaster recovery claim.

STATUS: installation running at this checkpoint; final installed version/reopen
verification follows. Phase2 source work remains present in the main checkout.

## Installed result

- NSIS returned exit0. Actual installed executable at the existing redirected
  LocalAppData location reports ProductVersion2.2.2. Same V1 identity/profile.
- Database hash still matched the pre-update backup immediately after installer
  completion, before reopening. No installation-time database modification.
- Reopened approved V1 executable. Existing authenticated session restored;
  dashboard showed the owner's two projects and saved resources. Installed
  Resources page shows20 top-level resources, Upload files, Upload folder and
  Drop files or folders here. No fixture uploads or lab records were created.
- Existing pinned V1 API/database containers started with `up -d --no-build`;
  no image update or new migration was shipped. Final health check tracked in
  tool output. Development app/server changes remain separate.
- Native accessibility clicking initially lacked geometry; fresh screenshot-based
  navigation succeeded. Further window input stopped when the tool detected user
  interaction. No destructive action or unsaved editor close followed that event.
- Generated browser fixture files removed after testing. Installer, isolated
  source and local rollback backup retained in the workspace.

STATUS: INSTALLED AND REOPENED. Browser viewer interaction and installed launch/
Resources controls verified. Windows Explorer drag-to-WebView and real upload/
reconnect acceptance remain user smoke checks; no false end-to-end upload claim.
