# Clean personal V1 setup — 2026-10-26

## User-approved scope

Separate clean V1; only balika administrator; no sample lab records. Preserve all existing development databases, storage, and pending work. Do not remove the old zero-byte resource. This is a personal-use milestone, not a claim that all Phase 2 acceptance is complete.

## Isolation contract

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

## Daily startup

1. Start Docker Desktop and wait for its engine to be ready.
2. From this repository run `powershell -NoProfile -File deploy/scripts/start-v1.ps1`.
3. Launch the installed **LabOS V1** application, not the development shortcut.

Normal startup does not compile anything. A running server is required for first login and server download execution. Offline work remains subject to the existing login lease and local-copy availability contracts.

## Credentials and backups

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

## Evidence and remaining handoff

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
