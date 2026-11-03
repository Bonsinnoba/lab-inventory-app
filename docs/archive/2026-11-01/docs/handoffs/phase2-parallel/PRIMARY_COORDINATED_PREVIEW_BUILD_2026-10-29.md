# Primary — coordinated development deployment

Scope: project Save repair, calendar-date edit fields, local reservation review,
budget permission enforcement, authored-field server reconciliation and conflict
guidance. Existing source verification is recorded in the adjacent primary
reports. V1 is outside this deployment.

## Current operations

- Development API build: `docker compose -p labos -f deploy/docker-compose.yml build labos-api`.
  Running. Fresh Node base image downloaded/extracted; apt media dependency step
  started. No build success or container replacement claimed.
- Preview build: debug/no installer, preview configuration; both compile-time
  API URLs explicitly port 4000. Running frontend TypeScript/build step.
- No database volumes or storage files removed or reset.
- Native desktop inspector timed out twice on list_windows, then timed out
  after kernel reset/reinitialization. Further UI input stopped. A successful
  desktop restart or GUI acceptance is not claimed.

## Remaining deployment steps

1. Obtain both successful build results.
2. Replace only development API using compose up with no dependency rebuild;
   verify API/database/storage health and preserve existing volumes.
3. Inspect/save/close only Preview, launch its newly built binary using its
   separate profile. Do not close or replace V1.
4. Complete offline save/restart/reconnect acceptance, including local review
   queue pending state and rejection recovery. Preserve authored test work.

No acceptance parent closes while the builds or GUI tests remain pending.

## Build/deployment result

Both builds succeeded. Preview frontend: 2,267 transformed modules, Vite
49.12s; native dev build: 53.51s, one existing unused-function warning.
New `target/debug/LabOS Preview.exe` is 25,456,640 bytes, modified October29
13:23:10 (client timezone UTC). No Preview process was present at the final
read-only process check; launch is pending reliable desktop control.

Development image built successfully:
`sha256:3b4a448051e87159d0a1af7912103b244aa8e6c83fa6ed0254add6394d7fe604`.
Recreated only `labos-labos-api-1` with compose `up -d --no-deps --no-build`.
Health endpoint returned API/database/storage OK; container healthy. V1 API and
database remained healthy. Existing volumes preserved. Runtime sha256 hashes
for `project-edit-patch.js` and `routes/sync.js` match workspace source.

Packaged HTTP/PostgreSQL probes PASS inside the new development container,
without source mounts: nine auth/read cases, task replay/mismatch/delete/receipt
rollback, researcher prose edit replay/budget denial/field conflict, and
reservation overlap/consumable/stock-preservation rules. All fixture absence
checks PASS after rollback. The probes use isolated loopback listeners and
savepoint transactions, not requests through the deployed port4000 listener;
health separately verifies that listener. Concurrency and GUI remain open.
Build npm audit reported one moderate and two high findings; no automatic
dependency rewrite was performed. Dependency triage remains an A1 follow-up,
not evidence of an exploited runtime vulnerability.
