# Primary — salvage source quantities and legacy provenance

MODULE: B1/B2 inventory custody and salvage

FILES: `backend/src/migrations/20261029_salvage_source_movement.sql`,
`backend/src/salvage-release.js`, `backend/src/routes/items.js`,
`backend/src/salvage-release-live-probe.mjs`, `desktop/src/api/items.ts`.

CURRENT WRITE PATH: existing authenticated HTTP salvage routes. Native salvage
snapshot/outbox path remains to implement. No native offline write claim.

RISK: distinct recovery rows could each credit the same consumed source;
source item identity alone is not proof of consumed quantity; custody returns
could credit stock without settling the original issue.

ACTUAL CHANGE MADE:

- Add optional source_movement_id with immutable-history FK and index. Existing
  recovery rows are preserved without invented provenance.
- Movement-backed creation derives source item/project from a consumption
  movement; mismatched references reject. Project-linked creation requires
  project edit access.
- Release locks the source movement and compares the sum of already released
  source quantities plus this claim against its original consumed quantity.
  Original consumption and finance entries are not rewritten. Pending proposals
  do not become accepted claims; excess release stays quarantined for review.
- Source item/project must match the original movement at release. Reviewed
  output quantity may differ from source quantity (disassembly yields).
- Historical source without a movement requires explicit attestation even when
  the item identity is known. Inspection supports adding those notes to old
  unreleased records; no automatic assignment of source provenance.
- Equipment/unused-stock returns with outstanding custody reject with an
  instruction to use custody settlement. Source inventory is locked before
  checking outstanding custody, serializing against issue writers.
- API types expose the source movement and inspection attestation fields.

VERIFICATION: production salvage service and authenticated HTTP routes on real
development PostgreSQL PASS partial/excess source claims, replay, mismatched
item, missing attestation, custody bypass, source derivation, project denial,
legacy attestation review, released inspection guard and nonfinite valuation.
Earlier balance/cost/scrap/failure rollback matrix also PASS. All fixtures and
movements absent after rollback. Migration applied only inside rollback test
transaction; it has not been deployed. This is sequential/savepoint evidence,
not independent committed-transaction race acceptance.

STATUS: source implemented; migration/API/desktop deployment pending. Native
salvage intents and receipts, offline reads/edits, full record visibility policy,
custody-aware quarantine return, multi-output recovery batches and simultaneous
release testing remain. Attested historical sources cannot have a machine-
verified quantity ceiling; human provenance review is the explicit exception.
No B1/B2 parent closure and no V1 changes.
