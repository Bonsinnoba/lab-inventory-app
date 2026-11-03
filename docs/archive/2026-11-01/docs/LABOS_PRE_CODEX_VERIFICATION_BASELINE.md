# LabOS — pre-Codex verification baseline

Baseline captured: 2026-09-30. Scope: **Stage 1 evidence collection only**. No production behavior changes in this stage.

## Repository snapshot
- Branch: `main`; last previously identified UI commit: `2d002341f86d7347237bd129f4361c373ae0ed54` (redundant scientific calculator header hidden). This document commit is subsequent; record the exact HEAD before executing tests.
- Desktop: `desktop/package.json` version 2.2.1, `npm run build` executes `tsc && vite build`, `npm run dev:tauri` launches Tauri development mode. TypeScript `strict` and `noUnusedParameters` enabled.
- Backend: `backend/package.json` version 2.2.1; `npm run check` performs Node syntax checks, `npm run test:security-baseline` runs permissions and context tests. The PostgreSQL CI integration suite and additional tests must be located and run separately.
- GitHub combined commit status for `2d002341...` returned an **empty statuses array**, not a passing build. No open issues or PRs were returned in the review. CI workflow runs and local test execution remain **UNVERIFIED**.
- Preserve architecture: per-desktop SQLite -> authenticated sync/outbox -> backend API -> PostgreSQL. Preserve lab-wide ordinary reads for active members and separate sensitive-finance grants.

## Evidence required before any remediation
1. Record HEAD SHA, Node/npm/Rust versions and OS; record whether dependencies were installed from lockfiles.
2. Run `cd desktop && npm ci && npm run build`; capture complete logs, exit status and generated output. If `npm ci` cannot run, record reason and do not claim the build passed.
3. Run `cd backend && npm ci && npm run check && npm run test:security-baseline`; capture logs and exit status. Enumerate and run remaining relevant backend suites separately.
4. Locate actual GitHub Actions workflow filenames and fetch the newest runs for the tested commit; capture job URLs, status, failure excerpts and any unavailable checks. Do not infer success from an empty commit-status response.
5. For database integration, run the PostgreSQL 16 migration, transaction/rollback, concurrency and authenticated HTTP role-matrix suites against a disposable real database; capture database version, migration set and exact test commands. Do not use production credentials or production data.
6. For offline sync, run disconnected edits, app restart, duplicate replay, reconnect, two-client conflict and permission-revocation cases; record expected/observed outcomes.
7. For LabCalc, exercise keypad, DEG/RAD, 2x2/3x3 unique/dependent/inconsistent systems, quadratic real/repeated/complex roots, graph import/export, ten electronics modes, right-column latest result and 20-entry Q&A persistence. Include desktop expanded, floating and narrow-window screenshots.

## Source-inspection findings to validate
- EquationWorkspace shares one coefficient matrix across 2- and 3-variable modes; verify switching preserves intended coefficient-to-variable mapping. The default matrix includes different right-hand-side positions for 2x2 and 3x3.
- The quadratic solver uses scale-based tolerances; test very small nonzero leading coefficients, near-repeated roots and large coefficients against high-precision references before altering algorithms.
- Equation solutions are strings while existing engineering save mutation expects `result_numeric`; verify save/insertion behavior and decide on a typed multi-result contract.
- GraphingWorkspace keeps graph state in component memory, so switching away may discard unexported work. Verify intended persistence contract.
- Desktop JSX was previously fixed after a reported Vite parse error; independently compile current HEAD rather than relying on the fix commit.

## Remediation rules
- Classify each finding: confirmed reproducible defect, source-level risk, missing test/evidence, visual polish, or new feature. Attach exact files, reproduction, severity and acceptance test.
- Fix security/data integrity and build blockers first; then calculator/graph correctness and workflow consistency; then app-wide UI/UX; then packaging and restore.
- For every fix record commit, rationale, alternatives, tests, screenshots where relevant and regression coverage. Codex independently reviews the final frozen commit and test evidence; no automatic declaration of release readiness.

## Stage 1 status
Source inventory and evidence requirements recorded. **Local builds, actual GitHub workflow runs, real PostgreSQL and two-client tests are pending.** No production code was modified during this baseline.
