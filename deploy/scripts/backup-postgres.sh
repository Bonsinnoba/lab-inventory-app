#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-./backups}"
mkdir -p "$ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$ROOT/labos-postgres-$STAMP.dump"

echo "Creating PostgreSQL backup: $FILE"
pg_dump --format=custom --no-owner --no-acl --file="$FILE" "${DATABASE_URL:?Set DATABASE_URL}"
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup complete."
