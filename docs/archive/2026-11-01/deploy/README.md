# LabOS v2.2 — Deployment & Operations

This directory contains the production-oriented LabOS server deployment. PostgreSQL is private to the server and is never exposed directly to desktop clients.

## Topology

```
LabOS Desktop A ─┐
LabOS Desktop B ─┼── LAN / HTTPS / VPN ──> LabOS Server
LabOS Desktop C ─┘                         ├─ Node/Express API
                                           ├─ PostgreSQL
                                           └─ persistent storage
```

The desktop remains an offline-first Tauri + SQLite client. The server remains the central PostgreSQL authority.

## Deployment

The Compose file uses deterministic names:

- Compose project: `labos`
- PostgreSQL volume: `labos_postgres`
- persistent storage volume: `labos_storage`
- API: `localhost:4000` by default
- PostgreSQL is never published to the host
- both services read `.env.production`
- migrations run automatically before the API starts

### First setup

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

## Disposable local reset

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

## Backups

From `deploy`:

```powershell
.\scripts\backup-postgres.sh .\backups
```

Back up PostgreSQL and the `labos_storage` volume as one set because database records can reference uploaded/generated files. A backup is not considered verified until a restore has been tested.

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

Never run a second backend on port 4000 while testing the Dockerized LabOS API. A second API process can make the desktop appear to be connected to an old database.

## Architecture rule

The desktop must never connect directly to PostgreSQL. The supported production path is:

**Tauri SQLite → sync/outbox → LabOS API → PostgreSQL.**
