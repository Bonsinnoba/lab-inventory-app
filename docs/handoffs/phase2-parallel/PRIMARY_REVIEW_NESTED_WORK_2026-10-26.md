# B3/B4 resumed: pending nested-work review boundaries

Identity / role: LABOS-P2-PRIMARY. Primary review and verification, not helper work.

MODULE: Connected projects / review decisions.

FILE: desktop/src-tauri/src/local_project_review.rs.

CURRENT WRITE PATH: review UI -> native displayed-token, authority and pending-plan
checks -> account-owned SQLite outbox -> server decision -> confirmed snapshot.

WHY IT BYPASSES OFFLINE-FIRST: no bypass identified in this bounded check. The
October24 handoff explicitly lacked nested pending-work regression coverage.

RISK: accepting a stale plan while related local work remains unsynchronized, or
blocking one project because a different account/project has outstanding work.

RECOMMENDED CHANGE: exercise pending nested event shapes and acknowledgement/token
boundaries before changing production review behavior.

ACTUAL CHANGE MADE: tests only. Added 66 combinations (11 child entity types,
create/update/delete, top-level/nested project_id), verifying rejection preserves
cached project and immutable event payload without inserting review intent.
Added unrelated-project/foreign-account nonblocking checks, plus child ACK followed
by refreshed snapshot requiring a newly displayed token before authoring review.

VERIFICATION: development API labos-labos-api-1 confirmed exited. Disposable native
SQLite fixtures only; no live database writes. Native suite passed 10/10, including
the 66 nested-event combinations; native compilation took 30.51 seconds. Whitespace
check passed. No runtime/desktop/deployment acceptance inferred.

STATUS: BOUNDED NATIVE REGRESSION PASS. Production behavior unchanged; B3/B4 remain open.

Remaining: tests of production child writers (this matrix injects their expected
payload shapes), real desktop transport/restart/reconnect, concurrent server child
edits/approvals and full permission request integration. V1 remains untouched.
