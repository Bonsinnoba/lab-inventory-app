# Primary — offline reservation review and project acceptance

Identity: primary implementation/review agent. No helper contribution claimed.

## Change and boundaries

MODULE: Projects / reservation review

FILES: `desktop/src/api/projects.ts`,
`desktop/src/api/reservation-review-projection.ts`,
`desktop/src/components/ReservationReviewQueue.tsx`

CURRENT WRITE PATH: unchanged. Desktop decisions use the existing native
account-owned reservation intent and outbox writer. Server reconciliation owns
allocation authority. Browser decisions retain their existing HTTP path.

WHY IT BYPASSES OFFLINE-FIRST: the prior central queue reader always fetched
`/projects/reservations/review-queue`, although individual project reservations
already existed in native SQLite snapshots.

RISK: offline users could not inspect the queue; an empty/error screen obscured
cached requests. Deriving global availability from incomplete local records
could falsely promise stock unless clearly bounded.

RECOMMENDED CHANGE / ACTUAL CHANGE MADE:

- Desktop queue now reads existing authorized native project and inventory
  snapshots. It does not call HTTP when a native read fails or a snapshot is
  absent. Account changes suppress completed old-account reads.
- Missing inventory quantities stay unknown. Missing project reservation
  snapshots are counted separately from confirmed empty collections.
- Reusable assets count overlapping confirmed reservations; consumables count
  all confirmed reservations. Invalid quantities/dates produce unknown values.
- UI identifies the queue as a local subset, describes estimated availability,
  and preserves pending decision status without claiming confirmation.
- Repeated actions are disabled while a local decision is pending. Unknown stock
  disables confirmation. Rejection still requires a reason.
- Browser queue retains the server read, wrapped in the same snapshot envelope.
- Success messages no longer appear as errors; failed refresh retains available
  rows and offers Retry.

VERIFICATION: project/reservation boundary suite plus initial projection suite:
47 PASS, 0 FAIL. Final projection suite: 7 PASS, 0 FAIL (includes additional null
stock and missing-date cases). Tests execute actual TypeScript projection and
API orchestration with native-reader boundaries; they are not live database or
GUI acceptance. Existing production native readers were reused without changes.
TypeScript compile completed with exit 0 for the integration. Earlier Save repair compiled successfully and its
Preview binary rebuilt successfully in 3m 13s.

STATUS: implemented; integrated Preview deployment/GUI verification remains.
Current running Preview contains the header Save repair but not this new queue.

## Desktop test limitation

With development API stopped, rebuilt Preview opened the seeded project from
its local data. Window-control geometry became invalid after maximizing:
scroll reported a 12x12 window while capture displayed the full application.
Fresh window selection and capture reproduced a 12x12 primary surface plus a
full application surface. Further input was stopped instead of claiming the
save/restart/reconnect batch passed. Development API was restarted afterward.
No V1 app, database or storage was changed.

Assistant header wording corrected from `Connected` to `Configured`, matching
the saved enabled/model capability it actually displays. It no longer claims
live connectivity from cached configuration. No generation or authority change.

## Remaining acceptance

Deploy the queue frontend with Preview; verify request/review offline, pending
decision persistence over restart, reconciliation/rejection on reconnect, and
cross-project competition with real PostgreSQL. Also complete the repaired
header Save offline/restart check when reliable window input is available.
No A/B/C parent item is closed by these bounded changes.
