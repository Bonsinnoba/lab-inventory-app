#!/usr/bin/env bash
set -euo pipefail

DUMP="${1:?Usage: restore-postgres.sh <dump-file>}"
if [[ ! -f "$DUMP" ]]; then
  echo "Dump not found: $DUMP"
  exit 1
fi

cd "$(dirname "$0")/.."

echo "WARNING: this replaces data in the target database."
echo "Stop LabOS writes before continuing."
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

docker compose --env-file .env.production exec -T db \
  pg_restore --clean --if-exists --no-owner --no-acl \
  -U "$PGUSER" -d "$PGDATABASE" < "$DUMP"

echo "Restore complete. Run the application migration command if the release requires it."
