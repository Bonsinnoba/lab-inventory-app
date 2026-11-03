# Project recorded-history deletion protection

Identity / role: LABOS-P2-PRIMARY. Primary implementation and review, not helper work.

MODULE: B4 project lifecycle/history, with B2 salvage and B5 finance provenance.

FILE: backend/src/project-lifecycle.js; project-lifecycle-live-probe.mjs;
custody-sync-live-probe.mjs. Existing sync and browser project delete handlers
already call this shared guard under their transaction/project lock.

CURRENT WRITE PATH: Desktop delete intention -> SQLite/outbox -> server project
delete transaction; browser delete -> same server guard. This batch changes only
the authoritative deletion boundary, not the native queue or rejection recovery.

WHY IT BYPASSES OFFLINE-FIRST: No new write bypass. Existing deletion could detach
transactions/purchases/salvage via SET NULL and cascade-delete scientific evidence.
An outbox alone does not make these destructive server effects safe.

RISK: Loss of project provenance and experiment/results history, including records
linked only through an experiment rather than a direct project ID.

RECOMMENDED CHANGE: Reject hard deletion when recorded history exists; archive
instead. Keep empty projects deletable and retain existing inventory guard codes.

ACTUAL CHANGE MADE:
- Protect transactions (including zero amounts), purchase batches and salvage.
- Protect experiment execution markers, inline results/observations/conclusions,
  measurements, observations and revision history even if current results cleared.
- Protect findings, lab results and engineering calculations through direct project
  or experiment references; protect engineering test execution/results/conclusions.
- Lock existing experiments/tests NOWAIT before inspection. Busy writers return a
  retryable conflict rather than waiting on an inverted parent/child lock order.
- Return PROJECT_RECORDED_HISTORY_PROTECTED (409); no deletion or tombstone follows.
- No migration, stock/financial adjustment, automatic archive or data cleanup.

VERIFICATION:
- Existing real PostgreSQL, source injected in memory: 23 focused checks PASS;
  includes 11 added independent history cases. Fixture transaction rolled back.
- Expanded real PostgreSQL sync/browser-handler harness: 29 PASS, 0 FAIL;
  rollback verified. Includes financial sync rejection without receipt/tombstone
  and browser scientific-history rejection retaining measurements.
- JavaScript syntax checks passed. Expected browser rejection logging is now
  suppressed only for its specific error code in the harness to avoid data-URL
  stack noise; other errors still print. Existing pg concurrency warning remains.

STATUS: IMPLEMENTED — AWAITING DEPLOYMENT AND INTEGRATED VERIFICATION, bounded
server history guard only. No API update or desktop restart in this batch.
HTTP/auth middleware, native rejected-delete recovery, GUI and simultaneous-client
lock/contention cases not certified. No offline capability code changed, so this
batch did not stop the API or claim new desktop outage evidence. Direct child
deletion policies and broader B4 recovery/revision/review work remain open.
