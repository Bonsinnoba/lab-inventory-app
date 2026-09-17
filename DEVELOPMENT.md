# LabOS Development Guide

This document is the technical reference for developing, testing, maintaining, and releasing LabOS.

For a product overview, capabilities, and user-facing information, see [`README.md`](README.md).

---

## 1. Development Principles

LabOS is a laboratory operating system, not a generic CRUD dashboard. Changes should preserve:

- data integrity
- project and laboratory context
- backend-enforced authorization
- offline reliability
- synchronization correctness
- traceable history
- predictable UX
- safe failure and recovery

Prefer small, verifiable changes over broad rewrites. Existing working behavior should not be replaced merely for architectural preference.

All production changes are made against `main` unless a release workflow explicitly requires another mechanism.

---

## 2. System Architecture

```text
┌──────────────────────┐
│   LabOS Desktop      │
│ React + Tauri        │
│ Local SQLite         │
└──────────┬───────────┘
           │ HTTPS / HTTP API
           ▼
┌──────────────────────┐
│   LabOS Backend      │
│ Express / Node.js    │
└──────────┬───────────┘
           │ SQL
           ▼
┌──────────────────────┐
│     PostgreSQL       │
│ Central application  │
│ database             │
└──────────────────────┘
```

The desktop client must **never connect directly to PostgreSQL**. The backend is the authoritative API and authorization boundary.

The desktop application may continue operating against its local SQLite data while offline and later synchronize through the backend.

---

## 3. Repository Structure

```text
lab-inventory-app/
├── backend/                 # API, authentication, business logic, migrations
│   ├── src/
│   └── migrations/
├── desktop/                 # React + Tauri desktop client
│   ├── src/
│   └── src-tauri/
├── deploy/                  # Deployment-related files
├── scripts/                 # Project utilities
├── README.md                # Product-facing documentation
├── DEVELOPMENT.md           # Technical/developer documentation
└── .gitignore
```

Runtime data, local databases, generated builds, secrets, backups, dependency directories, and temporary files must remain outside source control unless explicitly required by the project.

---

## 4. Frontend / Desktop

The desktop application is a React application packaged with Tauri.

Current frontend stack includes:

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- Lucide icons
- Tauri

The desktop package currently uses version `2.2.1`.

### Development

```powershell
cd desktop
npm install
npm run dev:tauri
```

Browser-only development can use:

```powershell
npm run dev
```

The browser does not provide the Tauri IPC bridge, so features that depend on native/local SQLite access must be tested through Tauri.

### Production build

```powershell
npm run build
```

### Tauri package build

```powershell
npm run tauri:build
```

---

## 5. Backend

The backend is a Node.js/Express API backed by PostgreSQL.

Current backend package version is `2.2.1`.

### Development

```powershell
cd backend
npm install
npm run dev
```

### Production

```powershell
npm start
```

### Syntax check

```powershell
npm run check
```

On Windows PowerShell, backend source can also be checked with:

```powershell
Get-ChildItem .\src -Recurse -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

---

## 6. PostgreSQL and Migrations

PostgreSQL is the central server database.

Migrations are stored in:

```text
backend/migrations/
```

Run migrations with:

```powershell
cd backend
npm run migrate
```

### Migration rule

Never modify an already-applied migration to repair production state. Add a new repair migration instead.

This matters because the migration runner records applied migrations. A previously recorded migration will not automatically execute again after its file contents are changed.

Example: the `sync_tombstones` repair was added as a new migration after the original migration had already been recorded.

---

## 7. Local SQLite

The desktop client maintains local laboratory data for offline operation.

Local SQLite is an implementation detail of the desktop client and is not a replacement for the central PostgreSQL database.

Local mutations should be designed so that:

1. the local state is updated atomically;
2. the required outbox entry is created atomically;
3. synchronization can retry safely;
4. a failed server request does not falsely report success;
5. conflict information remains actionable.

---

## 8. Offline and Synchronization Model

The synchronization architecture is:

```text
Local mutation
     │
     ├── Local SQLite state
     │
     └── Outbox entry
              │
              ▼
        Sync / retry
              │
              ▼
        Backend API
              │
              ▼
        PostgreSQL
```

The server provides push and pull synchronization.

Important properties:

- synchronization is retryable;
- duplicate delivery must be safe through idempotency;
- stale offline updates can be rejected as conflicts;
- conflicts can be reconciled explicitly;
- server-side deletions are represented through tombstones;
- pull synchronization uses a stable composite cursor;
- reconnecting should recover pending work;
- retry backoff should prevent aggressive repeated failures;
- manual retry should be available when automatic retry is insufficient.

The pull cursor is based on `(event_at, event_type, event_id)` rather than timestamp alone so events sharing a timestamp do not get skipped or repeatedly returned.

---

## 9. Conflict and Reconciliation Rules

When an offline mutation conflicts with newer server state, the user must be able to understand and resolve the conflict.

The desktop conflict system supports actions including:

- keep local changes and retry
- accept server state
- dismiss the conflict

Conflict resolution must not silently overwrite newer server data.

Server-side stale-update protection is authoritative; frontend state is not sufficient protection.

---

## 10. Authentication and Authorization

Authorization is enforced by the backend.

Frontend visibility is not a security boundary.

The permission model includes global roles and project-level access.

The `admin` role receives the complete administrator baseline permission set. Individual non-admin overrides may refine access, but administrator access must not be accidentally stripped by ordinary per-user permission overrides.

Any new protected capability should be evaluated at the backend route/tool level before being exposed in the UI.

---

## 11. Lab Assistant

The Lab Assistant is permission-aware and context-aware.

Its context model supports scopes such as:

- no context
- project context
- project laboratory-data context
- custom context

When a project is selected, project-scoped tools receive the project ID rather than relying on the assistant to infer the project from conversation text.

The assistant must respect the effective permissions available to the current user.

### Tool-calling behavior

The assistant uses Gemini function calling. Data-oriented questions within an enabled context must invoke an appropriate available tool before producing a factual answer.

The implementation also preserves the chat-level tools and system instruction across follow-up tool-response turns. This is important because per-request Gemini configuration does not automatically inherit the complete chat configuration.

When debugging assistant behavior, verify all of the following:

1. the selected context is correct;
2. the effective permissions expose the required tool;
3. the project ID is injected into project-scoped tools;
4. tool calling is forced when required for data questions;
5. follow-up requests retain tools and system instructions;
6. the tool result is actually incorporated into the final response.

---

## 12. Resources and Local Media

Resources may include images, video, audio, PDFs, text, Markdown, and other supported files.

Downloaded media must be treated as local application data. A downloaded video must not unexpectedly fall back to the original remote URL for playback.

Runtime resource storage is not source-controlled.

When changing resource handling, test both:

- resources that already have local downloaded media;
- resources that are remote/link-only.

---

## 13. CRUD Verification

A CRUD operation is not complete merely because the UI shows a success toast or an HTTP request returns successfully.

Verify the complete chain:

```text
UI action
   ↓
API request
   ↓
Authentication
   ↓
Authorization
   ↓
Backend route
   ↓
Database mutation
   ↓
API response
   ↓
Frontend state
   ↓
Reload / persistence
```

For destructive operations, also verify relationships, references, and history.

---

## 14. Error Handling

User-facing errors should explain:

- what failed;
- why it failed when known;
- what the user can do next.

Never expose raw JavaScript object serialization such as:

```text
[object Object]
```

Do not display a success state when the underlying operation failed.

Errors should avoid leaking unnecessary implementation details or secrets.

---

## 15. Testing and Verification

The repository contains static verification scripts for major development tracks and reliability areas.

Available backend checks include tests for:

- security foundation
- core application behavior
- project/workspace functionality
- track-specific functionality
- phase-specific functionality
- downloaded media
- synchronization reliability

Examples:

```powershell
cd backend
npm run test:security
npm run test:media-downloads-static
npm run test:sync-reliability-static
```

Static checks are useful but do not replace runtime testing.

For launch readiness, test the application as a user would use it, including offline operation, reconnection, persistence, permissions, and recovery.

---

## 16. Development Workflow

Recommended workflow:

1. Inspect the existing implementation before changing it.
2. Identify the smallest correct change.
3. Make the change on `main` when working directly on the project release baseline.
4. Run the relevant static checks.
5. Run build/type checks where applicable.
6. Verify the affected behavior at runtime when possible.
7. Review the resulting Git diff.
8. Commit with a clear message.
9. Do not leave temporary repair workflows, debug files, generated artifacts, or test data in the repository.

Avoid broad rewrites when a focused fix is sufficient.

---

## 17. Environment Configuration

Secrets and environment-specific values belong in local environment configuration, not source control.

Typical backend configuration includes:

- PostgreSQL connection information
- JWT/authentication configuration
- model/API credentials
- resource storage configuration
- server configuration

Never commit real credentials, tokens, private keys, or local secrets.

When documenting environment variables, document names and purpose, not secret values.

---

## 18. Backup and Recovery

Before risky schema or data changes, create a verified backup according to the deployment environment's backup procedure.

Recovery testing should verify that:

- the backup can actually be restored;
- migrations can be reapplied correctly to a restored environment;
- application data remains consistent;
- local desktop synchronization can recover afterward.

A backup that has never been restored is not considered fully verified.

---

## 19. Security Rules

The following are non-negotiable:

1. Backend authorization is authoritative.
2. Project-scoped data must enforce project access.
3. SQL must be safely parameterized.
4. User input must be validated.
5. Secrets must never enter Git.
6. Runtime storage must not enter Git.
7. Resource deletion must account for references and ownership.
8. Authentication failures must not expose sensitive information.
9. Error responses must avoid unnecessary internal details.
10. New assistant tools must enforce the same permissions as the underlying data.

---

## 20. Versioning

LabOS uses semantic-style version numbers:

```text
MAJOR.MINOR.PATCH
```

Examples:

- `1.0.0` — first stable release
- `1.1.0` — backward-compatible feature release
- `1.1.1` — backward-compatible bug-fix release
- `2.0.0` — major release with significant new capabilities or breaking changes

The desktop and backend package versions should remain aligned unless there is a documented reason not to do so.

The current repository baseline is `2.2.1`.

---

## 21. Release Mechanism

The V1 release mechanism will use GitHub as the source of truth.

Target flow:

```text
Validated main
      │
      ▼
Version update
      │
      ▼
Git tag
      │
      ▼
Automated release build
      │
      ├── Desktop installer/artifacts
      ├── Checksums
      └── Release notes
      │
      ▼
GitHub Release
```

The release process should be reproducible and should not depend on manually copying files from a developer machine.

The final mechanism will be completed during the release-system phase of the V1 launch plan.

---

## 22. V1 Launch Plan

The launch work is intentionally limited to five phases:

### Phase 1 — V1 Completion

Close remaining functional gaps and verify the existing implementation.

### Phase 2 — V1 Polish and Hardening

Complete UI/UX consistency, error states, permissions, security, recovery, migrations, backups, and production hardening.

### Phase 3 — Release System

Implement versioning, automated builds, GitHub releases, installers/artifacts, checksums, and release notes.

### Phase 4 — Launch and Real-World Validation

Perform fresh-machine installation and end-to-end testing, then use LabOS in real laboratory workflows and fix release-blocking issues.

### Phase 5 — V2 Planning

Use real V1 usage and feedback to define, prioritize, and architect V2 without destabilizing the V1 release.

---

## 23. Technical Decision Log

Important architectural decisions should be recorded here or in a dedicated technical decision record when they have lasting impact.

Current key decisions include:

- PostgreSQL remains the central server database.
- Desktop clients use local SQLite for offline-first operation.
- Desktop clients do not connect directly to PostgreSQL.
- Synchronization uses an outbox and idempotent server processing.
- Server pull synchronization uses a composite cursor.
- Tombstones represent server-side deletions during synchronization.
- Backend authorization is the final security boundary.
- Lab Assistant tools are permission-aware and context-aware.
- Product documentation and technical documentation are intentionally separated.

---

## 24. Troubleshooting Principles

When a feature appears broken:

1. Reproduce it.
2. Determine whether the failure is UI, API, authorization, database, local SQLite, synchronization, or environment related.
3. Inspect the actual persisted state.
4. Check backend logs and browser/Tauri console output where appropriate.
5. Fix the underlying state transition rather than masking the symptom.
6. Add or update a regression check when practical.
7. Re-test the original workflow from a clean state.

Do not assume a successful UI notification proves the backend or database operation succeeded.

---

## 25. Documentation Rule

Keep this file technical and maintainable.

Put user-facing explanations, product positioning, feature descriptions, screenshots, and launch messaging in `README.md`.

Put implementation details, development commands, architecture decisions, testing procedures, migration rules, and release mechanics here.
