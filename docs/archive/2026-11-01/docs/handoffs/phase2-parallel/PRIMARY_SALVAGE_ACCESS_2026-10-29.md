# Primary — salvage read and mutation authority

MODULE: Salvage / project visibility / stock mutation permissions

FILES: `backend/src/salvage-access.js`, `backend/src/salvage-release.js`,
`backend/src/routes/items.js`, `backend/src/salvage-release-live-probe.mjs`.

CURRENT WRITE PATH: authenticated HTTP routes; inspection and release own
PostgreSQL transactions. Native salvage repository/outbox is still outstanding.

RISK: inventory permission alone previously allowed reading or modifying a
recovery linked to a restricted project. Inspection's separate read/update
also lacked transaction-bound project authority.

ACTUAL CHANGE MADE:

- Salvage list binds authenticated account/role into the shared linked-project
  visibility predicate before applying status/project filters. Restricted
  project names and records do not escape through this list.
- New transaction helper reloads active database user, current domain permission,
  project and membership/grant authority. It uses shared project access semantics.
  Existing user/project/override/membership/grant rows are read with share locks
  through the mutation client rather than a role supplied by the request body.
- Release rechecks authority before even returning an already-released record.
  A formerly authorized client cannot use replay to retrieve it after revocation.
- Inspection now owns its transaction and row lock; authority check and guarded
  update occur in that same transaction. Error paths roll back and release the
  client; existing business status/code errors remain explicit.

VERIFICATION: actual development PostgreSQL with production authentication and
HTTP router passed restricted owner-without-grant hiding, explicit filter hiding,
view-grant read with mutation denial, edit-grant inspect/release success, grant
revocation hiding plus release/replay denial, and disabled-account denial.
Earlier source quantity, legacy attestation, balances, valuation, scrap and fault
rollback matrices also passed. Test route transactions are savepoints inside
one outer rollback, not independently committed concurrent transactions. All
fixture users/projects/recoveries/items/movements absent after rollback. Syntax
and whitespace checks passed.

STATUS: source implemented, not deployed. Domain permission middleware remains
on public routes; this helper does not grant inventory authority from project
access. Native cached visibility/revocation and outbox handling still need code.
Creation currently retains its earlier project access check; its stable intent/
receipt transaction contract belongs to the next native/server integration.
No parent closure and no V1 data or application changes.
