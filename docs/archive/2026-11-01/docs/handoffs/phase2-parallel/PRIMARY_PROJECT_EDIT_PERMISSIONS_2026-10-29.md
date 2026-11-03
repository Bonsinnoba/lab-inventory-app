# Primary — ordinary project edit permissions and concurrent changes

Owner: primary implementation/review agent.

MODULE: Projects / native writes / sync reconciliation / conflict recovery

FILES: `backend/src/project-edit-patch.js`, `backend/src/routes/sync.js`,
`desktop/src-tauri/src/local_projects.rs`,
`desktop/src/api/project-conflict-guidance.ts` and focused tests/probe.

CURRENT WRITE PATH: desktop project edit -> native SQLite snapshot and outbox
transaction -> authenticated sync -> PostgreSQL transaction and retry receipt.

WHY IT NEEDED CHANGE: native events carry complete project records. The sync
handler previously interpreted an unchanged budget as a financial mutation,
rejecting ordinary description edits by researchers. Applying every field in
the full record could also overwrite unrelated newer server values.

RISK: stuck ordinary edits, accidental stale-value overwrites, and budget
changes saved provisionally without the finance permission needed to sync them.

ACTUAL CHANGE MADE:

- For events with a before snapshot, derive the authored field changes on a copy
  of the record. Unchanged fields are omitted, including equivalent numeric
  budget/date representations. Original outbox payload and retry hash remain
  unchanged.
- Conflicting authored fields reject with PROJECT_EDIT_CONFLICT. Matching
  already-applied values converge. Lifecycle changes retain their existing
  revision checks. Legacy events without a before snapshot retain prior behavior.
- Actual native budget changes require finance.edit before saving local state
  or creating an event. An unchanged numeric budget remains an ordinary edit.
- Conflict UI blocks blind retries and explains preservation/review/reapply.
  Existing native recovery and authorization remain authoritative.

VERIFICATION: focused pure projection tests passed (three), alongside optional
date projection (one PASS / one separate PostgreSQL test SKIP). Production
authenticated HTTP/PostgreSQL probe initially passed ordinary prose replay,
actual budget denial for a researcher, and conflicting prose rejection. A first
fixture attempt incorrectly used an admin deny override (admins retain baseline
authority); fixed by using a researcher and refreshing its credential version.
Every probe run confirms fixture absence after rollback. Final extension also
checks a newer unrelated budget survives the prose edit. Final native/build
results: authenticated HTTP/PostgreSQL extension PASS including newer budget
preservation; all rollback fixtures absent. All 17 native project tests PASS
with development API stopped, including unchanged numeric budget acceptance and
denied changed budget leaving the outbox count unchanged. Eight conflict UI
tests PASS; TypeScript exit 0 and whitespace checks PASS. Development API restored.

STATUS: source implemented; coordinated API/Preview deployment and full desktop
acceptance remain. Independent concurrent transactions and legacy events lacking
before snapshots are outside the new field conflict guarantee. No phase parent
closed and no V1 changes.
