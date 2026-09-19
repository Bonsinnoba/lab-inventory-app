#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-./backups}"
mkdir -p "$ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$ROOT/labos-postgres-$STAMP.dump"

cd "$(dirname "$0")/.."

echo "Creating PostgreSQL backup: $FILE"
docker compose --env-file .env.production exec -T db \
  pg_dump --format=custom --no-owner --no-acl \
  -U "$PGUSER" -d "$PGDATABASE" > "$FILE"

sha256sum "$FILE" > "$FILE.sha256"
echo "Backup complete: $FILE"
