# Lab pilot backup/restore readiness

October 24: capture and isolated database restore verified; see
[primary evidence](../handoffs/phase2-parallel/PRIMARY_V1_BACKUP_2026-10-24.md).
Full app recovery/key portability/off-device copy remain open, not release sign-off.

## Verified locations

- Desktop: C:\Users\balik\AppData\Roaming\com.lab-inventory.app
  contains labos-local.db, resource-files (authored/staged files) and
  resource-copies (replicated files). Preserve any WAL/SHM files alongside them.
- PostgreSQL: labos-db-1, named volume labos_postgres.
- Server files: labos-labos-api-1:/app/storage, named volume labos_storage.
- Capture the exact candidate source/build/image identifiers separately.
- Keep deploy/.env.production and any additional encryption/recovery keys in
  separate owner-controlled protected storage. Never print or commit secrets.

## Capture procedure

1. Choose a private, access-controlled backup destination outside the repository
   and outside live app data. Prefer an encrypted disk, with a second offline
   copy. The backup contains credentials/session material and authored content;
   the capture script does not encrypt it or claim portable key recovery.
2. Save all edits; close the desktop normally (including tray instance). Confirm
   all other LabOS clients/direct database writers are quiesced. Stop only the API
   to stop sync and media workers. Keep PostgreSQL running; never remove volumes.
3. Run deploy/scripts/backup-lab-pilot.ps1 with explicit DesktopData and a new
   Destination. Default mode is read-only planning. Capture additionally requires
   -Capture -WritesQuiesced and refuses a running API or detected desktop process.
4. The script copies the entire desktop data tree, uses pg_dump custom format,
   checks the dump catalog, copies the server storage tree from the stopped API
   and writes size/SHA-256 metadata. It leaves a uniquely named staging dump in
   the database container; remove only that exact file after verified off-device
   backup in a separately reviewed cleanup. No source files are deleted.
5. On failure, retain the partial directory for diagnosis; it is not a completed
   backup. Choose another new destination on retry. Restore prior service state
   explicitly, verify health, and reopen the desktop only after capture completes.

## Isolated restore drill — still to implement and execute

- Never run the existing restore-postgres.sh against live PostgreSQL for testing:
  it uses --clean against the configured database.
- Verify every manifest entry's size/hash, rejecting missing/changed files.
- Restore postgres.dump into a NEW isolated PostgreSQL instance/database, with
  matching major version and no API/worker connected; inspect schema and relevant
  project/resource/outbox linkage counts without exposing private records.
- Copy desktop-data into a separate verification directory. Use SQLite integrity
  and foreign-key checks on the copy, retaining WAL/SHM handling. Verify authored
  pending payloads, source references and managed file hashes. Do not boot a
  copied logged-in app against the live API: it may replay real queued changes.
- Validate server-file references against restored server storage; separately
  identify missing bytes versus external link-only resources.
- Test access to required secrets/keys under the intended recovery scenario;
  same-PC readability is not proof of replacement-PC recovery.
- Record evidence and exact paths. Do not overwrite the user's current databases
  or storage, and do not clean up test data using broad/globbed deletes.

## Limitations

PowerShell syntax validation and default PLAN ONLY execution passed against the
actual desktop path and Docker mounts. The plan observed API running and zero
matching desktop processes; it copied nothing and changed no service state.
Capture and an isolated database restore subsequently passed as recorded above.
In general, pg_restore --list and
hashes are integrity checks, not proof of a successful restore. Desktop process
name checks are a guard, not proof that every writer is stopped; the explicit
quiescence assertion remains necessary. Custom server storage mounts require
manual review. Capture does not include unknown external files or secrets.
