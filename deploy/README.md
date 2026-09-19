# LabOS v2.2 — Deployment & Operations

This directory provides a production-oriented deployment baseline for a LabOS server. It does not expose PostgreSQL directly.

## Recommended topology

Internet/VPN -> HTTPS reverse proxy -> LabOS API -> PostgreSQL
                                  \-> persistent storage

For a LAN-only lab, keep the server private and bind the API to the lab network. For remote access, use a properly secured HTTPS reverse proxy or private VPN.

## Docker quick start

1. Copy `.env.production.example` to `.env.production`.
2. Replace every placeholder secret and set the real public URL/origins.
3. Choose the API bind boundary:
   - **HTTPS reverse proxy:** set `LABOS_BIND_ADDRESS=127.0.0.1` and `TRUST_PROXY=true`.
   - **LAN-only without reverse proxy:** set `LABOS_BIND_ADDRESS` to the server's LAN IP and `TRUST_PROXY=false`; firewall TCP 4000 to the lab network only.
4. Run `docker compose --env-file .env.production up -d --build`.
5. Check container health with `docker compose ps`.
6. Check `/api/health` from the server or reverse proxy. The API container runs migrations automatically before starting.
7. If you need to rerun migrations manually, use `docker compose --env-file .env.production exec labos-api npm run migrate`.

The Compose file persists PostgreSQL and LabOS storage in named volumes. PostgreSQL has no published host port.

## Backups

The PostgreSQL backup script is Docker-native and uses the same database container/configuration as production; it does not depend on a separate host `DATABASE_URL`.

From the `deploy` directory:

```bash
./scripts/backup-postgres.sh ./backups
```

Back up the LabOS storage volume at the same time as the database. The database dump and storage backup must be treated as one backup set because uploaded/generated files are referenced by database records.

At minimum:
- PostgreSQL: `scripts/backup-postgres.sh`
- persistent storage: back up the `labos_storage` Docker volume
- retain the SHA-256 checksum generated for each database dump
- periodically perform a full restore test on a separate environment

A backup that has never been restored is not considered verified.

## Restore

Stop application writes before restoring. Use the matching database/storage backup set.

```bash
./scripts/restore-postgres.sh ./backups/labos-postgres-YYYYMMDDT...dump
```

The restore script is Docker-native and targets the Compose PostgreSQL service. Restore the matching `labos_storage` volume separately, then run migrations if the release requires them.

## HTTPS

`nginx/labos.conf.example` is a reference reverse-proxy configuration. Supply your real certificate paths and domain. Do not commit private keys.

When nginx is active, the API should remain bound to `127.0.0.1:4000`; only nginx should be Internet-facing. Set `TRUST_PROXY=true` only when the API is behind a trusted reverse proxy.

## Server role

The production backend runs on a **dedicated server machine**, separate from every LabOS desktop. Desktop installers contain the Tauri client and local SQLite runtime only; they do not contain the Node/Express backend or PostgreSQL.

Production topology:

```text
LabOS Desktop A ─┐
LabOS Desktop B ─┼── HTTPS / LAN / VPN ──> LabOS Server
LabOS Desktop C ─┘                         ├─ Node/Express API
                                           ├─ PostgreSQL
                                           └─ persistent storage
```

The repository remains the development source of truth. Developers can continue running `backend/npm run dev` locally while production uses the Dockerized backend on the server machine.

### Desktop release endpoint

Release builds receive their central API endpoint from the GitHub repository variable `LABOS_API_BASE_URL`. Set it to the server URL including `/api`, for example `https://labos.example.com/api` or a private LAN endpoint when appropriate.

### Remote/mobile readiness

The server remains the single source of truth for future mobile clients. Mobile is not part of V1 implementation. When mobile is added later, it should use the same HTTPS API/auth/sync boundary; PostgreSQL and Docker volumes must remain private.
