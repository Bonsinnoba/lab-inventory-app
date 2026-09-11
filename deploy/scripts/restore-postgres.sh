#!/usr/bin/env bash
set -euo pipefail
DUMP="${1:?Usage: restore-postgres.sh <dump-file>}"
if [[ ! -f "$DUMP" ]]; then echo "Dump not found: $DUMP"; exit 1; fi

echo "WARNING: this replaces data in the target database."
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

pg_restore --clean --if-exists --no-owner --no-acl --dbname="${DATABASE_URL:?Set DATABASE_URL}" "$DUMP"
echo "Restore complete. Run migrations if required by the release."
