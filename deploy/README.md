# LabOS v2.2 — Deployment & Operations

This directory provides the production-oriented LabOS server deployment. PostgreSQL is private to the server and is never exposed directly to desktop clients.

## Topology

```
LabOS Desktop A ─┐
LabOS Desktop B ─┼── LAN / HTTPS / VPN ──> LabOS Server
LabOS Desktop C ─┘                         ├─ Node/Express API
                                           ├─ PostgreSQL
                                           └─ persistent storage
```

The desktop remains an offline-first Tauri + SQLite client. The server remains the central PostgreSQL authority.

## Clean deployment

The Compose file is intentionally deterministic:

- Compose project name: `labos`
- PostgreSQL volume: `labos_postgres`
- persistent storage volume: `labos_storage`
- API: `localhost:4000` by default
- PostgreSQL: never published to the host
- both services read `.env.production` directly
- migrations run automatically before the API starts

### First setup

1. Copy `.env.production.example` to `.env.production`.
2. Set the real secrets. Keep `PGDATABASE/PGUSER/PGPASSWORD` and `POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD` aligned.
3. Choose the server exposure:
   - HTTPS reverse proxy: `LABOS_BIND_ADDRESS=127.0.0.1`, `TRUST_PROXY=true`
   - LAN-only: use the server LAN address and `TRUST_PROXY=false`; firewall TCP 4000 to the lab network.
4. Start:

```powershell
docker compose --env-file .env.production up -d --build
docker compose ps
```

5. Confirm the API health endpoint and migration logs before opening the desktop.

## Ultra-clean disposable test reset

Use this only when the current LabOS Docker data is disposable.

From `deploy`:

```powershell
.\scripts\reset-clean-test.ps1
docker compose --env-file .env.production up -d --build
docker compose ps
```

The reset removes only the LabOS Compose project, its containers, and the named LabOS PostgreSQL/storage volumes. It does not delete unrelated Docker projects.

**Important:** this resets the server database, but it does not reset a desktop's local SQLite database or WebView session.

### Reset a desktop installation before physical testing

Close every LabOS Tauri window and Vite/Tauri process first.

The desktop stores its local SQLite database as `labos-local.db` under Tauri's application data directory. On Windows, Tauri's `appDataDir` is based on the configured bundle identifier; LabOS uses `com.lab-inventory.app`.

For a disposable clean workstation test, remove the LabOS application-data directory after confirming it contains only LabOS data. This clears the cached local account/session and local SQLite state together.

You can locate the database first:

```powershell
Get-ChildItem "$env:APPDATA" -Filter labos-local.db -Recurse -ErrorAction SilentlyContinue |
    Select-Object FullName
```

Do not delete a directory until its contents are confirmed to belong to LabOS.

Tauri documents that `appDataDir` resolves to an application-specific directory based on the bundle identifier; on Windows the underlying data directory is the user's roaming application-data directory. urlTauri appDataDir documentationhttps://tauri.app/reference/javascript/api/namespacepath/

## Backups

From `deploy`:

```powershell
.\scripts\backup-postgres.sh .\backups
```

Back up PostgreSQL and the `labos_storage` volume as one set because database records reference uploaded/generated files. A backup is not considered verified until a restore has been tested.

## Restore

Stop application writes and restore the matching database/storage backup set:

```powershell
.\scripts\restore-postgres.sh .\backups\labos-postgres-YYYYMMDDT...dump
```

## HTTPS

`nginx/labos.conf.example` is a reference reverse-proxy configuration. Keep private keys out of Git.

When nginx is active, bind the API to `127.0.0.1:4000`; nginx is the Internet-facing component.

## Desktop release endpoint

Release builds receive their central API endpoint from the GitHub repository variable `LABOS_API_BASE_URL`. It must include `/api`, for example:

```
https://labos.example.com/api
```

For local physical testing, the development desktop defaults to:

```
http://localhost:4000/api
```

Do not run a second backend on port 4000 while testing the Dockerized LabOS API. A second API process can make the desktop appear to be connected to an old database.

## Deployment rule

The desktop must never connect directly to PostgreSQL. The supported production path is:

**Tauri SQLite → sync/outbox → LabOS API → PostgreSQL.**
