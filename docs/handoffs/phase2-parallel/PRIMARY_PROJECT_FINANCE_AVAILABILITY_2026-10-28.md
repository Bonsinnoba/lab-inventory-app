# Project finance availability — October 28

Identity: primary agent. A3/B3/B5 source follow-up, not helper evidence.

- MODULE: Desktop project financial summary.
- FILE: desktop/src/api/projects.ts; desktop/src/pages/ProjectFinanceView.tsx; desktop/src/api/project-reservation-boundaries.test.mjs.
- CURRENT WRITE PATH: No writes changed. Desktop summary combines local projects, transactions, inventory and project workspace. Browser summary remains HTTP.
- WHY IT BYPASSES OFFLINE-FIRST: No write bypass; workspace read failures were converted into empty allocations, while absent costs/items were converted into zero value.
- RISK: Misleading zero valuations or understated totals; composite responses could also span an account switch.
- RECOMMENDED CHANGE: Preserve known ledger values, distinguish unknown valuation from confirmed empty allocation, and fence the full composite response by account/session.
- ACTUAL CHANGE MADE: Unknown inventory or workspace data yields null allocated_inventory_value, not zero. Missing/nonfinite/blank costs and quantities cannot masquerade as known values. Confirmed empty allocations and explicit zero cost remain zero. Invalid ledger amounts/directions fail the summary rather than inventing spending figures. Missing/nonpositive budgets produce no percentage. Account checks run across composite reads. UI shows Unavailable for unknown row valuation and for the combined valuation total if any row is unknown.
- VERIFICATION: 34 project adapter regression tests passed, including five unavailable-valuation scenarios, confirmed empty/zero/known valuation, invalid ledger amounts and account changes. Mocked repositories/IPC; no real database or desktop outage test in this batch.
- STATUS: Implemented in source, desktop acceptance pending. This does not establish durable initial-sync completeness or close A3/B3/B5.

TypeScript no-emit and scoped diff whitespace checks passed.

No changes to stock, custody, expense history or financial authority. Allocated inventory value remains the existing allocation-times-current-unit-cost measure, not actual physical issue or historical expense. No V1 change, deployment, service restart or personal-data mutation.
