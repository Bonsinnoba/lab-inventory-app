#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-./backups}"
mkdir -p "$ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$ROOT/labos-postgres-$STAMP.dump"

cd "$(dirname "$0")/.."
[[ -f .env.production ]] || { echo "Missing deploy/.env.production"; exit 1; }

echo "Creating PostgreSQL backup: $FILE"
docker compose --env-file .env.production exec -T db \
  sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$FILE"

sha256sum "$FILE" > "$FILE.sha256"
echo "Backup complete: $FILE"
