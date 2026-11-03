# V1 backup and isolated restore evidence

Identity: LABOS-P2-PRIMARY. MODULE: A2 / V1 data protection.
FILE: deploy/scripts/backup-lab-pilot.ps1; verify-pilot-backup.py.
CURRENT WRITE PATH: Quiesced desktop copy + PostgreSQL dump + server storage
and protected configuration captured into a new private backup directory.
WHY IT BYPASSES OFFLINE-FIRST: Previous PostgreSQL-only backups omitted desktop
pending work/bytes. No application mutation path changed.
RISK: Loss of pending work or restoration of metadata without files.
RECOMMENDED CHANGE: Capture both sides; verify an isolated restore.
ACTUAL CHANGE MADE: Configuration capture, hashes, copied-SQLite/file verifier.
Capture ran with desktop closed, API stopped and no other PostgreSQL clients.
API restarted in finally. New backup root ACL permits owner, SYSTEM and admins;
this is access restriction, not encryption. No live data overwritten or deleted.

VERIFICATION:

- Backup: C:\Users\balik\LabOS-Backups\v1-pilot-20261024.
  All 64 manifest files / 361,301,878 bytes match size and SHA-256.
  protected-config/server.env included without printing its contents.
- SQLite verification copy: C:\Users\balik\LabOS-Backups\v1-restore-check-20261024.
  integrity_check OK; zero FK violations; 75 outbox entries, including 6 pending.
- Four ready authored files and five ready replicated files match stored sizes
  and hashes; none missing/invalid.
- Dump restored with --exit-on-error --single-transaction --no-owner --no-acl
  into labos_restore in labos-v1-restore-check-20261024. Same PostgreSQL image,
  network none, no published ports/live volumes, tmpfs database. PASS: 63 tables,
  6 projects, 50 items, 6 resources and 84 sync receipts.
- Five restored server storage/media references match backed-up files and sizes.
  Initial reference-check harness needed multiline JSON joined before parsing;
  corrected rerun passed. This was not a database/file defect.
- Disposable restore container stopped; tmpfs database is disposable. Container
  remains, along with its copied dump. Live API/database/storage health OK.

STATUS: Captured dataset integrity and isolated database restore VERIFIED.
Not full A2 closure, application login recovery or replacement-PC acceptance.

Remaining: second encrypted/off-device copy; full restored app startup; key and
credential portability; complete key inventory beyond server env. Backup contains
private credentials/session material: do not share or commit it. Manifest keeps
its original CAPTURED_NOT_RESTORE_VERIFIED capture-time label; this report records
subsequent verification without modifying the snapshot. Six pending events remain
pending, not discarded or falsely acknowledged.

Retained staging dump in live DB container:
/tmp/labos-pilot-607aa470cc654388a4c01c73d924b432.dump.
Clean up only this exact artifact and the named disposable container after the
retention decision; no broad cleanup performed. No app restart or deployment.
