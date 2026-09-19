# LabOS v2.2 — Deployment & Operations

This directory provides a production-oriented deployment baseline for a LabOS server. It does not expose the development server directly to the Internet.

## Recommended topology

Internet/VPN -> HTTPS reverse proxy -> LabOS API -> PostgreSQL
                                  \-> persistent storage

For a LAN-only lab, keep the server private and bind the reverse proxy/API to the lab network. For remote access, prefer a VPN (WireGuard/Tailscale/etc.) or a properly secured HTTPS reverse proxy.

## Docker quick start

1. Copy `.env.production.example` to `.env.production`.
2. Replace every placeholder secret.
3. Set `ALLOWED_ORIGINS` to the exact origin(s) used by the web client.
4. Run `docker compose --env-file .env.production up -d --build`.
5. Run `docker compose --env-file .env.production exec labos-api npm run migrate`.
6. Check `/api/health` from the server/reverse proxy.

The compose file persists PostgreSQL and LabOS storage in named volumes.

## Backups

Use `scripts/backup-postgres.sh` for a compressed PostgreSQL dump. Back up the LabOS storage volume/directory at the same time. Test restores periodically; a backup that has never been restored is not considered verified.

## Restore

Use `scripts/restore-postgres.sh <dump-file>` after stopping writes. Restore the storage directory/volume from the matching backup set, then run migrations if the release requires them.

## HTTPS

`nginx/labos.conf.example` is a reference reverse-proxy configuration. Supply your real certificate paths and domain. Do not commit private keys.

## Operational checklist

- [ ] Production `NODE_ENV`
- [ ] Long random `JWT_SECRET`
- [ ] Strong PostgreSQL password
- [ ] Exact CORS origins
- [ ] HTTPS or private VPN
- [ ] PostgreSQL backup schedule
- [ ] Storage backup schedule
- [ ] Restore test completed
- [ ] Health monitoring configured
- [ ] Logs retained and rotated
- [ ] AI key stored only as a server secret


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
