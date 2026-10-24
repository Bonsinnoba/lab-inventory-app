# Coordinated project-history/conflict deployment

Identity / role: LABOS-P2-PRIMARY.

Owner explicitly confirmed all edits saved and approved API update/desktop restart.

Deployed batches: PRIMARY_PROJECT_RECORDED_HISTORY, PRIMARY_PROJECT_DELETE_RECOVERY,
PRIMARY_PROJECT_CONFLICT_GUIDANCE and PRIMARY_CONFLICT_ACCOUNT_FENCE (October 22).
Their earlier source-only deployment status is superseded by this checkpoint;
remaining acceptance and implementation limitations are unchanged.

- TypeScript and Vite production build PASS (2259 modules).
- Locked/offline native debug build PASS; executable timestamp October 22 18:15 UTC.
  One non-fatal dead-code warning for the test-used resolve_conflict wrapper remains.
- API image sha256:7f06ea39b769e82e0f557d1b71ea378242f5bd5adf80cbc049e57b03905f65e9
  deployed with compose up -d --no-deps labos-api. Existing database/container and
  labos_postgres/labos_storage volumes retained. No new migration in this batch.
- Deployed PostgreSQL probes: 23 focused history/lifecycle PASS and 29 sync/browser
  handler PASS, all fixtures rolled back. Handler harness does not exercise HTTP
  middleware or two clients. Existing pg query-concurrency warning remains.
- Adapter/presentation rerun: 11 PASS. Earlier same-source stopped-API native batch
  was 9 PASS; this deployment does not replace integrated desktop acceptance.
- Closed only the verified existing LabOS executable after saved-edit approval;
  launched rebuilt executable using the existing app data. No reset/reseed,
  file removal, pending-change deletion or installer replacement.
- API health reports API/database/storage OK. Desktop process launch verification
  is not a claim of visual/login/conflict-to-pull acceptance.

STATUS: Coordinated deployment complete. B4/A1/A2 remain open for integrated
desktop workflow, account-switch/concurrent-client verification, recovery
listing/export and other recorded obligations. No Phase 2 completion claim.
