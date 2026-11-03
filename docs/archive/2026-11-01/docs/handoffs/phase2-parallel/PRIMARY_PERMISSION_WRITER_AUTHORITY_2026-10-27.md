# A1/B3/B4 permission writer authority race

Identity / role: LABOS-P2-PRIMARY. Primary implementation and verification.

MODULE: Permission override replacement; project review authority concurrency.

FILE: backend/src/permission-replacement-authority.js, routes/auth.js,
permission-replacement-authority.test.js, permission-replacement-lock-live-probe.mjs,
project-review-authority.test.js.

CURRENT WRITE PATH: authenticated permission HTTP request -> middleware check ->
transaction -> locked actor/target authority recheck -> replace overrides ->
mandatory audit -> commit. This is an existing online administrative operation,
not a new desktop data-write fallback.

WHY IT BYPASSES OFFLINE-FIRST: no new bypass. Previous code locked only the target
and trusted earlier actor role/permissions, allowing stale actor authority after
concurrent demotion/disable or permission revocation. Replacement also omitted
implicit removals from its escalation check (removing a deny can restore access).

RISK: stale authorization or delegated permission escalation.

RECOMMENDED CHANGE: lock actor and target in deterministic order, re-read current
authority inside the write transaction, and authorize every changed override,
including removal. Retain atomic audit and administrator-role protection.

ACTUAL CHANGE MADE: shared transactional helper locks both users ORDER BY id FOR
UPDATE; rejects inactive/missing actor, missing management permission and admin
target. Reads actor permissions using the same transaction. Delegated managers
must hold each changed permission; unchanged target exceptions may be retained.
Route uses this helper before DELETE/INSERT, removes stale actor precheck, and
returns typed authorization errors rather than masking them as generic HTTP500.
No production data edits, migrations, server deployment or desktop update.

VERIFICATION: 16 focused Node tests PASS. Real development PostgreSQL probe PASS:
actor/target updates blocked while replacement authority locks held; reverse
actor-disable lock blocked authorization; observed disabled/demoted actors rejected.
All changes rolled back. Route syntax and diff whitespace checks PASS. Development
API stayed stopped; development DB restored stopped. V1 untouched.

STATUS: SOURCE IMPLEMENTED — bounded tests pass; deployment/full HTTP acceptance pending.

Remaining: full authenticated permission HTTP replacement/review concurrent request
integration, reciprocal manager request behavior, broader role/password/account
writers and real desktop reconnect. Helper/lock tests are not end-to-end HTTP proof.
