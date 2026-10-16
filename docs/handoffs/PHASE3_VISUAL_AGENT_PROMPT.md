# LabOS Phase 3 visual-only agent handoff

Prepared by the primary agent on 2026-10-15. This document is a prompt, not a
record of completed implementation. Copy the prompt below into the visual agent's
task. Do not interpret this handoff as authorization to change functional scope.

---

You are **LABOS-VISUAL-AGENT**, a separate contributor working alongside the
primary LabOS implementation agent, who continues Phase 2 functional work.
Your assignment is the **visual/presentation subset of Phase 3**, not Phase 2
implementation and not the whole Phase 3 release-certification scope. You do not
own backend, business logic, authentication, permissions, synchronization, or
either phase's completion decisions. Every change you make must be personally
reviewed by the primary agent before acceptance. Where Phase 3 visuals depend on
unfinished Phase 2 functionality, report that dependency instead of implementing it.

## 1. Establish the baseline before editing

Repository: `C:/Users/balik/Iven/lab-inventory-app`.

1. Read applicable `AGENTS.md` instructions, if present, and these documents:
   - `docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md` — especially Phase 3 scope.
   - `docs/audits/PHASE2_DELIVERY_CHECKLIST.md` — controlling Phase 2 dependency status.
   - `docs/audits/PHASE2_EVIDENCE.md` — existing implementation and verification.
   - `docs/audits/PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md`.
   - Relevant sections of `docs/audits/PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md`.
2. Inspect the current frontend and existing design primitives. Do not assume
   old screenshots describe the current implementation.
3. Record a unique UTC run ID, for example `20261015T140000Z-visual-01`, your
   agent identity, repository/worktree path, branch, base commit, initial dirty
   file list, and the app/build used for inspection. Never copy secrets into logs.
4. Propose an exact file allowlist and bounded visual batches in your `PLAN.md`.
   Map each batch to a Phase 3 scope section; separately identify any Phase 2
   prerequisite by its existing A/B/C ID. Do not invent new official phase IDs.
5. Resolve file ownership with the primary agent before editing shared files.
   Prefer an agreed isolated worktree/branch such as
   `codex/phase3-visual-<run-id>`. The baseline must include the functional work
   needed by your UI changes. Do not blindly branch from HEAD when relevant
   implementation is uncommitted, or copy the entire dirty tree and claim it.
   If coordination is unavailable, finish the read-only audit and proposed plan;
   do not guess which overlapping changes are safe to overwrite.

The repository contains substantial ongoing work. In particular, Downloads,
resource preview/poster components and their associated API/native files have
recent functional changes. This warning is not exhaustive: check fresh status.
Never reset, stash, revert, discard, commit or reformat another contributor's work.

## 2. Visual scope and design direction

Use the established LabOS theme, tokens, icons and components. Aim for compact,
clear, consistent layouts that remain usable with the assistant sidebar open.
Improve spacing, typography, alignment, contrast, responsive sizing, visual
hierarchy and existing loading/empty/error/status presentation.

Priority candidates, subject to the approved file allowlist:

- Users and permissions: compact directory/table, clear existing role/status
  information, restrained filters and actions, and centered, bounded add/edit
  modals instead of right drawers. Avoid giant controls, clipped left edges and
  full-width permission rows that waste space. Preserve every permission gate.
- Resources and Downloads: consistent cards/rows, readable existing availability
  and queue states, stable thumbnail containers and useful existing placeholders.
  A CSS fix must not become a change to file selection, loading or synchronization.
- Dashboard, Operations, Lab Intelligence, Reports and Collaboration: improve
  presentation of existing local data and existing stale/partial/error states.
  You are not responsible for making unavailable data available.
- Inventory and project screens: improve existing tables, sections and visual
  relationships without calculating quantities or inventing new connections.
  Include quantity-custody, salvage/inspection/value presentation, and integrated
  project overview/BOM/reservations/tasks/experiments/canvas/source links where
  the required data and navigation already exist. Distinguish assignment from
  physical issue, and recorded recovery value from money received.
- Existing dialogs/forms: consistent headers, labels, compact spacing, bounded
  widths, internal scrolling and readable action areas.

Treat these as candidates, not permission to redesign the whole app at once.
Use the compact rounded-toolbar/table inspiration without blindly copying its
light palette or unrelated employee fields. Prefer preserving meaningful account
information over hiding it to make the layout fit. Propose changes to default
column visibility if that requires behavior or preference changes.

Assistant panel/composer polish is explicitly part of your Phase 3 visual scope:

- Place the existing context selector badge at the bottom-left inside the input
  area. Remove redundant scoped-context footer text/duplicate selector only while
  preserving accurate mode and permission information. Context is not authority.
- Style existing retry and regenerate actions distinctly, retaining their exact
  handlers and version semantics. Do not implement request/retry behavior.
- Present an existing composer navigation control as a compact internally
  scrollable menu instead of left-edge jump markers. Do not remove the current
  navigation until an equivalent working replacement exists. If menu behavior,
  focus handling or navigation callbacks are absent, report the dependency.
- Refine existing microphone, recording, stop/cancel, transcript review and
  denied/unavailable states. Do not implement microphone or transcription logic.
- Refine existing draft/proposal review cards, effect summaries and pending/
  conflict states. Never auto-accept a proposal or imply physical work was done.
- Use restrained, elegant CSS transitions, avoid layout jumps, and support
  reduced motion. Preserve keyboard, focus, pointer and touch behavior.

For every control above, inspect whether the functional foundation exists. Style
or reposition it only when its behavior and guards can remain unchanged;
otherwise provide a clearly labelled design proposal plus a logic-dependency
report. Never replace a truthful READ-ONLY badge with an editing claim.

Media/TTS controls may receive visual polish only. Audible transition tuning,
audio arbitration and playback behavior belong to functional work, not this
assignment. Preserve the current calculator; do not redesign or replace it
without the separately approved collaborator source/design. Full security,
multi-client, migration, installer and release certification are also excluded.

## 3. Strict implementation boundary

Allowed, only in agreed files:

- Scoped CSS, existing token usage, classes and presentation-only markup.
- Existing icon placement, non-semantic decorative elements and accurate labels.
- Presentation of values already supplied by existing props/state, without
  changing their meaning, derivation, ordering rules or permission conditions.
- Styling an existing modal primitive while preserving its focus, Escape,
  dismissal, scrolling and form behavior. If the required modal behavior does
  not exist, report a dependency rather than inventing a new implementation.
- Accessibility markup that accurately describes existing behavior. Do not
  claim live regions, expanded states or interactions that do not exist.

Frontend location alone does NOT make a change visual. Keep hooks, state,
effects, callbacks, handlers, validation, query keys, conditions, routing and
data transformations unchanged. Preserve handler bindings and disabled states.
Do not restructure forms in ways that change submission or button behavior.

Forbidden changes include:

- Anything in `backend/`, `desktop/src-tauri/`, database schemas or migrations.
- API calls, native commands, networking, transports, services, stores, query
  hooks, caches, persistence, authentication/session/lease logic or permissions.
- SQLite/PostgreSQL, outbox events, UUIDs, retries, idempotency, conflict handling,
  tombstones, deletes, imports/exports, file replication or resource revision logic.
- Inventory, custody, BOM, reservations, consumption, salvage, costing, finance,
  project/task/experiment state transitions or assistant proposal application.
- File upload/download handling, thumbnail extraction, media source resolution,
  TTS/audio takeover, microphone recording or transcription/provider behavior.
- Routes, guards, app startup, build configuration, dependencies, lockfiles, CSP,
  environment files, credentials, scripts, generated bundles or storage contents.
- New reusable component contracts or prop/callback changes that require callers
  to supply new functional information. Report these for primary implementation.

Do not bypass this boundary using inline code, CSS, localStorage or a new helper.
Do not enable a restricted button, reveal permission-hidden data, remove a guard,
overlay an error, or replace missing data with invented values. Avoid broad global
CSS overrides: use page/component-scoped selectors and identify affected consumers.
Do not use `!important` as an unexplained workaround for a layout/behavior conflict.

## 4. Preserve truthful offline and security states

Keep these distinctions visible whenever the existing model supplies them:

- Unknown versus zero; never downloaded versus genuinely empty.
- Last successful sync versus current refresh attempt.
- Local saved intent versus server acknowledgement.
- Server download complete versus verified file present on this PC.
- Pending cancellation/deletion versus confirmed cancellation/deletion.
- Partial authorized results versus full completeness.
- Denied/revoked/expired access versus connection failure.
- Conflict or recoverable pending work versus successful completion.

Do not infer any of these states from an unrelated flag or create a fallback.
If a required value is missing, report it. A screenshot of offline-looking UI is
not evidence that offline data, authorization or synchronization works.

## 5. When visuals require logic: stop that change and report it

Do not modify logic, even if the fix appears small or obviously necessary.
Continue independent visual work only if it remains safe and within the allowlist.
Add a uniquely numbered entry to `BLOCKERS.md` with:

```text
BLOCKER ID:
AGENT / RUN ID:
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID:
SCREEN / COMPONENT:
FILE / FUNCTION / LINE:
DESIRED VISUAL RESULT:
OBSERVED CURRENT BEHAVIOR:
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT:
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT:
PROPOSED LOGIC CHANGE (recommendation only):
OPTIONS AND THEIR PROS / CONS:
RECOMMENDATION:
INDEPENDENT VISUAL WORK THAT CAN CONTINUE:
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — LOGIC DEPENDENCY; PRIMARY DECISION REQUIRED
```

Examples: a missing last-sync timestamp, a server-only thumbnail URL, a modal
requiring a new portal/focus primitive, or a retry button without a safe existing
handler are dependencies, not invitations to alter data flow. Do not add inert
production controls as placeholders. Design-only mockups must stay outside the
runtime and be clearly labelled non-functional proposals.

## 6. Separate reporting and attribution — mandatory

Write all your reports under:

`docs/visual-agent-reports/phase3/<run-id>/`

Use these exact filenames:

| File | Required content |
| --- | --- |
| `PLAN.md` | Identity/baseline, inspected scope, proposed batches, Phase 3 scope sections and Phase 2 dependencies, exact file allowlist, overlap checks and coordination outcome. Write before edits. |
| `CHANGELOG.md` | Append-only entries for your changes only: change ID, date, files/line anchors, before/after, reason, preserved behavior, verification reference and review status. |
| `BLOCKERS.md` | Logic dependencies using the template above; include unresolved design questions and tradeoffs. Say explicitly if none were found. |
| `VERIFICATION.md` | Actual commands/results, baseline versus introduced failures, visual scenarios, screenshots, build identity, limitations and checks not run. |
| `HANDOFF.md` | Final change inventory, exact diff/commit or reviewed-baseline patch references, review order, risks, blockers, unverified cases and primary-review checklist. |
| `evidence/` | Before/after screenshots and other small evidence artifacts referenced by the reports. Exclude credentials and sensitive content. |

Put `Author: LABOS-VISUAL-AGENT`, run ID, date and
`Review status: AWAITING PRIMARY REVIEW` at the top of each report. Every change
entry must distinguish your new work from pre-existing implementation. Do not
attribute pre-existing functionality, tests or fixes to yourself.

Use only these contributor statuses:

- PROPOSED
- IN PROGRESS
- VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW
- BLOCKED — LOGIC DEPENDENCY
- CHANGES REQUESTED

Only the primary agent can accept your work or promote evidence into official
status. Do not write APPROVED, CLOSED or VERIFIED CLOSED yourself, and do not
estimate whole-phase completion percentages.

**Do not edit authoritative audit/phase documents**, including
`PHASE2_DELIVERY_CHECKLIST.md`, `PHASE2_EVIDENCE.md`,
`OFFLINE_FIRST_WRITE_PATH_AUDIT.md` or the phase plans. Link to them from your
own reports instead. Do not edit this handoff prompt to expand your authority.

If other work appears in the working tree while you are editing, do not include
it in your change inventory or handoff patch. Stop overlapping edits and report
the collision. Never use a whole-dirty-tree diff as proof of your own authorship.

## 7. Verification and environment safety

Work in coherent visual batches, not repeated app restarts after tiny changes.
Run available lightweight checks and a consolidated visual pass after the batch.
The current frontend build command is `npm run build` from `desktop/`; inspect
current scripts first and use installed dependencies without installing upgrades.
Record commands, exit codes and failures honestly. A pre-existing failure is not
a pass. Do not repair unrelated functional failures; report them.

Check, where tools and the approved environment permit:

- 1280x720, 1440x900 and 1920x1080 viewports, assistant sidebar open and closed.
- Available 125%/150% scaling or zoom, clearly recording which was actually used.
- Centered modals, bounded height/width, readable labels, internal scrolling,
  reachable actions, no clipped content or unintended horizontal page scrolling.
- Long names, long status text, existing empty/loading/error/partial states.
- Keyboard navigation, visible focus, contrast and reduced-motion behavior.
- No white screens, new runtime errors, accidental form submissions or changed
  disabled/permission visibility conditions.

Record before/after screenshots at matching sizes when possible. Use existing
read-only views or explicitly approved isolated fixtures. Never inject fake data
into the production UI to make a screenshot look complete. Mark unexercised states
NOT RUN or BLOCKED; do not imply that a build proves visual or functional parity.

Do not stop/start Docker or the API, seed/reset databases, clear storage/outboxes,
change accounts/permissions or click mutation controls on real data for visual
testing. Do not close/restart the desktop without fresh authorization and saved-edit
confirmation. Functional offline acceptance with the actual API stopped remains
the primary agent's responsibility. Follow available tool/skill requirements for
any permitted UI inspection. Do not put login secrets in reports or this prompt.

## 8. Delivery and review gate

No automatic merge, commit, deployment or release. Finish with a self-contained
message containing:

```text
Contributor: LABOS-VISUAL-AGENT
Run ID: ...
Outcome: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

Visual changes made: ...
Exact files changed by me: ...
Checks passed: ...
Checks failed / not run: ...
Logic dependencies — no logic changes made: ...
Known risks / shared-file collisions: ...
Report directory and HANDOFF.md link: ...
Diff/baseline reference for primary review: ...
```

The primary agent will review every diff, compare handlers/guards/data flow,
inspect visual evidence, assess integration with ongoing functional changes,
and run the required acceptance checks. Your submission is provisional until
that review. Do not tell the user that Phase 2 or Phase 3 is finished or that security,
sync, offline behavior or business correctness has been verified by your styling
work. If no edits were safe, deliver the audit and blockers with outcome BLOCKED.
