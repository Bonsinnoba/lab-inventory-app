# LabOS website content source

**Purpose:** accurate, reusable copy and documentation for the LabOS download website.

**Publication rule:** distinguish the currently implemented application from planned work. This document describes the V2 source and deployment template inspected on 2026-11-03. It is not a promise that every V2 feature is in the installed V1 release or has completed deployment acceptance.

---

## 1. Short product description

### LabOS — one connected workspace for laboratory work

LabOS brings projects, experiments, inventory, technical knowledge, resources, planning, and laboratory history into one workspace. Keep the evidence around the work: what a project needs, what was tested, what changed, which resources were used, and what the lab learned.

LabOS is designed for independent laboratories, engineering and research groups, teaching labs, and makers who need an organized record of work that spans more than a single experiment or spreadsheet.

### The idea

```text
Plan a project → organize tasks and experiments → connect resources and materials
→ record observations and outcomes → preserve what the lab learned
```

The value is in the connections. A project can bring its plan, tasks, experiments, bill of materials, reservations, canvas, resources, and history together, so work is easier to follow and useful knowledge is easier to find again.

---

## 2. Feature highlights

Use the status column when deciding what the public site may call “available.” V2 development and V1 availability are not interchangeable.

| Feature | Website description | Status for public copy |
|---|---|---|
| Project workspace | Organize research and engineering efforts into projects with lifecycle, ownership, tasks, experiments, plans, comments, and activity. | Implemented in the application; V2 workflow and deployment acceptance continue. |
| Experiments and lab history | Keep experiment plans, observations, results, and history connected to the work they document. | Implemented core workflows; expanded review and reproducibility work continues. |
| Inventory and custody | Track items, quantities, locations, movements, assignments, maintenance, calibration, project demand, and recorded returns. | Implemented core workflows; quantity and offline acceptance varies by workflow. |
| Project planning and BOM | Connect project requirements with inventory, tasks, experiments, reservations, and canvas references. | V2 supports reviewed project planning/BOM workflows; use current release notes for exact availability. |
| Resources and folders | Keep files, links, and folder structures alongside projects, notes, and inventory context. | Implemented; desktop availability depends on having a verified local copy and current access. |
| Notebook and knowledge | Preserve notes, document revisions, references, and reusable technical knowledge. | Implemented core workflows; the exact supported editing and preview formats depend on release. |
| Canvas | Arrange project material, resources, and engineering information visually, with connected blocks and relationships. | Available in the application; advanced workflows and V2 acceptance continue. |
| Reports and finance | Review project/lab financial information, budgets, activity, and reports. | Available in the application; live server-derived reports require the server. |
| Downloads and media | Queue supported media work and run downloads through the configured server worker. | Implemented in current source; downloads require a connected, configured server and supported media tools. |
| Lab Assistant | Ask questions with permission-aware project or workspace context. | Online provider integration; provider configuration and network access are required. It is not an offline assistant. |
| Offline-first desktop | Continue supported work against the local SQLite database and sync authored changes when connectivity returns. | Implemented for selected workflows; not every page, privileged operation, report, or assistant feature is available offline. |
| Self-hosting | Run the backend and PostgreSQL on infrastructure controlled by the lab. | A Docker Compose deployment template exists in source. A polished, signed, supported public server package and complete production runbook are still release work. |

### A practical distinction: local data and server data

The desktop application stores supported local work in SQLite and uses an outbox to synchronize changes to the LabOS server. The desktop client does not connect directly to PostgreSQL. Offline availability is feature-specific: local records and verified local file copies can remain available, while server-only computations, assistant requests, server download execution, and privileged account administration need a connection. A “completed on server” download does not by itself prove the resulting file has been copied to a particular desktop.

---

## 3. How to use LabOS

### Start a project

1. Create a project with a clear goal, description, and lifecycle status.
2. Break the work into tasks and experiments. Keep planned work distinct from completed results.
3. Add project requirements/BOM entries and relate them to inventory where applicable.
4. Attach resources, notes, and references to the project or the specific work they support.
5. Use the canvas to arrange the project's connected material when a visual map helps.

### Record an experiment

1. Create or select the project and experiment.
2. Record the plan before performing the work.
3. Add observations and results as the experiment progresses.
4. Link relevant resources and notes so the result retains its context.
5. Preserve the outcome in the project history for later review.

### Manage inventory responsibly

Record stock movements when material is physically received, issued, returned, consumed, lost, or recovered. An assignment identifies responsibility; it does not on its own prove that stock was physically issued. Recovered material can retain its source history and be quarantined for inspection before it is released as usable inventory. Financial recovery value is a reviewed valuation, not an automatic refund or cash transaction.

### Work offline on desktop

1. Sign in while connected so the desktop can establish its local account/session state and synchronize the authorized data available to that user.
2. Continue only in workflows that show local/offline support. Local changes are retained in SQLite and queued for synchronization.
3. Reconnect to the same LabOS server to upload pending work and retrieve updates.
4. Review any sync conflicts or rejected changes before assuming that another device or the server has received them.
5. Keep server backups and desktop backups separate; a local SQLite copy is not a backup of the server's PostgreSQL database or server file storage.

Do not advertise “the entire lab works offline.” Offline authentication has a bounded lease, revocation is learned when the client reconnects or the lease expires, and some server-derived features cannot be reconstructed locally.

---

## 4. Self-hosting: deployment status and supported facts

### Important status notice for the download page

> **LabOS server deployment is under active development.** The source repository currently includes a Docker Compose template for the backend and PostgreSQL, but the public website's downloadable setup helpers are prototypes. They create generic starter files; they do not download or install LabOS. Do not present them as production installers. Publish a one-click server download only after a versioned artifact, configuration contract, upgrade/restore procedure, architecture support, and security review are available.

The present Compose source is useful for maintainers and controlled lab evaluation. It describes:

- PostgreSQL 16 (`postgres:16-alpine`) with a persistent Docker volume.
- A Node.js 22 backend container.
- A separate persistent storage volume for uploaded resource files.
- An API port of `4000`.
- A startup migration step before the API process.
- A health check at `/api/health`.
- Server-side `yt-dlp` and `ffmpeg` for media download/processing.
- No published PostgreSQL host port in the checked-in Compose file.

These facts do not establish minimum hardware requirements, ARM/Raspberry Pi support, a public image registry, signed installer packages, automatic backup, TLS configuration, or a supported internet-facing deployment.

### Lab host choices

| Host | Suitable for | Guidance |
|---|---|---|
| Everyday computer | Learning and private evaluation | Service availability depends on the computer and its container runtime staying on. |
| Spare desktop or mini PC | A lab's always-on private host | A supported 64-bit Linux server is the simplest headless target to evaluate; confirm the release's actual support matrix first. |
| Raspberry Pi | Potential low-power host | Do not promise support until the LabOS image, dependencies, database, and release process are verified for the exact ARM64 model/OS. |
| Windows or macOS host | Local evaluation | Docker Desktop can run the current source template where supported. It is not automatically a validated production host. |

### Current source-based evaluation procedure

These commands describe the repository template, not a polished end-user installer. Run them only from a checked-out LabOS source tree on a Docker-capable host.

1. Install Docker Engine with the Compose plugin on Linux, or Docker Desktop on Windows/macOS. Confirm the Docker engine is running.
2. Create a private deployment configuration from the example:

   ```sh
   cp deploy/.env.production.example deploy/.env.production
   ```

   In PowerShell:

   ```powershell
   Copy-Item deploy/.env.production.example deploy/.env.production
   notepad deploy/.env.production
   ```

3. Replace all example values before startup. At minimum:

   - Set a unique, long random `JWT_SECRET` (the backend requires at least 32 characters in production).
   - Set a unique PostgreSQL password. Keep `PGPASSWORD` equal to `POSTGRES_PASSWORD` in this Compose template.
   - Set `ALLOWED_ORIGINS` to the actual trusted frontend origin(s), not a wildcard.
   - Set `PUBLIC_BASE_URL` to the address users actually use.
   - For local/private LAN evaluation, use an appropriate `LABOS_BIND_ADDRESS` and firewall rule. For an HTTPS reverse proxy, the example binds the API to loopback and sets `TRUST_PROXY=true`; configure and verify the proxy separately.
   - Leave `GEMINI_API_KEY` empty if the lab does not want the Lab Assistant. The core app can run without this key; AI features will not be available.
   - Leave optional transcription disabled unless the operator has configured a supported audio-capable model and an accurate provider processing/retention disclosure.

   Restrict access to the file; `.env.production` contains secrets. Never upload it to the marketing site, commit it, include it in screenshots/support bundles, or send it to helpers.

4. From the repository root, build and start the source deployment:

   ```sh
   docker compose -f deploy/docker-compose.yml up -d --build
   docker compose -f deploy/docker-compose.yml ps
   docker compose -f deploy/docker-compose.yml logs -f labos-api
   ```

5. Confirm the API health endpoint from the host:

   ```sh
   curl http://127.0.0.1:4000/api/health
   ```

   If the host or reverse proxy uses a different address, test that actual address instead.

6. Create the first administrator while the database has no users by using the app's registration screen. The server's first successful registration is assigned the `admin` role; once an account exists, public registration closes and an administrator manages additional accounts. Choose a strong unique password and store it in the lab's password manager.

7. Verify a backup and restore procedure before adding valuable laboratory data. PostgreSQL and the `labos_storage` file volume must be backed up as a coordinated set.

### Stop and restart

```sh
docker compose -f deploy/docker-compose.yml stop
docker compose -f deploy/docker-compose.yml start
```

To stop and remove containers while retaining named volumes:

```sh
docker compose -f deploy/docker-compose.yml down
```

Do **not** append `-v` to `down` unless intentionally deleting the PostgreSQL and resource-storage volumes. Removing the containers is different from deleting the named data volumes.

### Configuration reference

| Setting | Purpose | Guidance |
|---|---|---|
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Backend's PostgreSQL connection | In the provided Compose network, the host is `db`; keep credentials aligned with `POSTGRES_*`. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Initialize the PostgreSQL container | Changing these after the database volume has been initialized does not reinitialize existing database users/data. |
| `JWT_SECRET` | Signs login tokens | Unique secret per deployment; production requires at least 32 characters. Treat rotation as a planned session/security operation. |
| `JWT_EXPIRES_IN` | Token lifetime | Current example is `7d`; offline desktop use also has its own bounded local lease rules. |
| `ALLOWED_ORIGINS` | Browser CORS allowlist | Use exact trusted frontend origins. It is not an authentication or firewall substitute. |
| `LABOS_BIND_ADDRESS`, `TRUST_PROXY` | Bind/network trust settings | Use only with a reviewed LAN/firewall or reverse proxy configuration. |
| `STORAGE_DIR` | Server resource-file storage root | The Compose service persists `/app/storage` in the `labos_storage` volume. Back it up with PostgreSQL. |
| `MAX_UPLOAD_MB`, `MAX_JSON_MB` | Request size limits | Tune to the host's available disk/memory and the lab's file needs; current template allows up to 500 MB resource uploads. |
| `GEMINI_API_KEY` | Lab Assistant provider credential | Optional for core operation. Configure only on the private server; never enter it on the public website. |
| `LABOS_TRANSCRIPTION_ENABLED`, `GEMINI_TRANSCRIPTION_MODEL`, `LABOS_TRANSCRIPTION_PROVIDER_POLICY` | Optional consented voice transcription | Disabled by default. Require a confirmed audio-capable model and accurate provider disclosure before enabling. |
| `YTDLP_PATH`, `FFMPEG_PATH` | Media tools | The checked-in backend image installs these tools in the container; custom deployments must verify their presence/version. |

Do not publish a web form that asks visitors to paste any of these secrets. A future setup wizard should run locally or inside the lab's private instance.

---

## 5. Security, privacy, and data ownership

### Safe public claims

- The desktop communicates with the LabOS API; it does not connect directly to PostgreSQL.
- The server enforces access permissions for protected operations.
- Self-hosting keeps the database and uploaded-resource storage under the lab operator's infrastructure control.
- Selected desktop workflows use local SQLite and a synchronization outbox to support work through connectivity interruptions.
- AI and transcription are optional server integrations; sending data to a configured hosted provider is a separate data-sharing choice.

### Do not claim without separate verification

- End-to-end encryption or database/file encryption at rest.
- Automatic backup, disaster recovery, or a tested restore unless that exact deployment has it.
- Complete offline availability, instant revocation while disconnected, or identical offline feature coverage across modules.
- Raspberry Pi/ARM support, minimum RAM/disk, or a universal supported OS matrix.
- A signed, auto-updating, production-ready server installer if only source/Compose files are available.
- That prompts, audio, or files never leave the host when an operator enables an external AI/media service.

The lab administrator is responsible for host security, account lifecycle, network exposure, secret custody, updates, database backups, resource-file backups, and restore testing.

---

## 6. Backups, updates, and support content the site should provide

Before offering a production download, publish and verify these procedures for each supported release:

1. **Backup:** consistent PostgreSQL backup plus the complete resource-storage volume; include version/configuration metadata, but keep `.env.production` in a separate protected secret backup.
2. **Restore:** restore both database and storage into a clean host, verify file references/checksums, then verify login and representative project/resource workflows.
3. **Upgrade:** identify the old/new versions, compatibility rules, pre-upgrade backup, migration behavior, health checks, and rollback limits. Do not promise downgrade after a schema migration unless tested.
4. **Uninstall:** distinguish removing containers from deleting persistent volumes; give an explicit confirmation step for irreversible volume deletion.
5. **Troubleshooting:** engine not running, database health failure, migration errors, port collision, invalid origin, missing storage permissions, expired/revoked session, provider configuration, and failed server downloads.
6. **Release authenticity:** publish version, supported CPU/OS targets, source revision, checksums/signatures, release notes, and vulnerability reporting channel.

---

## 7. Download page copy

### Heading

**Run LabOS where your lab works.**

### Supporting text

LabOS is being built as a connected desktop and self-hosted laboratory workspace. The desktop application is in active use and development. The server repository includes a Docker Compose deployment template; the public setup helper is not yet a production installer.

### Current action labels

- **Desktop app:** show only the exact version, operating system, CPU architecture, checksum, and installation notes for a published, verified artifact.
- **Server source / evaluation:** label clearly as maintainer or controlled lab evaluation until a versioned, signed server package and production runbook are released.
- **Hosting guide:** explain machine preparation, then link to the verified release-specific server installation guide when available.
- **Setup helper:** label “configuration-file prototype” until its output matches the supported deployment contract and is tested end to end.

Do not show a “Download server” button that points to a generic compose template or a helper that only creates placeholder files.

---

## 8. FAQ copy

### Does LabOS need an AI key?

No. The core application can run without a Gemini key. The Lab Assistant requires a configured server-side provider credential and network access. Optional voice transcription is separately disabled until explicitly configured and disclosed.

### Can I use LabOS without internet?

The desktop keeps supported data locally and can queue changes for later synchronization. Offline coverage depends on the feature. Server-side reports, assistant/provider calls, server download execution, and privileged account operations need connectivity.

### Where are uploaded files stored?

The server stores resource bytes under its configured `STORAGE_DIR` (the current Compose template uses the persistent `labos_storage` volume). The desktop may also hold local copies for supported offline use. Back up server database and storage together; a database-only backup does not contain uploaded file bytes.

### Can I install LabOS on a Raspberry Pi?

The public release support matrix must answer this for each server release. Do not assume compatibility from Docker alone; the LabOS image and all dependencies must support the Pi's operating system and processor architecture.

### Can I expose it to the internet?

Use a release-specific security guide. Begin on localhost or a private LAN. Remote access requires a reviewed HTTPS/reverse-proxy or VPN design, strong account security, firewall rules, updates, and tested backups. Do not expose the API port directly based only on the development Compose template.

### How is the first administrator created?

In the current server source, registration is available only while the database contains no user. The first account is created as an administrator; later accounts are created by an authorized administrator. A production installer still needs a verified, release-specific bootstrap and recovery guide.

---

## 9. Publication checklist

Before copying this content into public website pages:

- Confirm the exact V1 and V2 release labels and which desktop features ship in each.
- Replace “current source” instructions with the exact released server artifact and supported version.
- Verify all configuration names against that tagged release, not a moving development branch.
- Verify supported Linux distributions, Windows/macOS host behavior, CPU architectures, and hardware minimums.
- Exercise clean installation, first-admin creation, update, backup, restore, and uninstall on a fresh lab host.
- Verify TLS, proxy, origin, session, upload, and storage behavior in the exact release configuration.
- Add only checksums/signatures generated by the actual release pipeline.
- Remove every generic setup helper or mark it clearly as a prototype until it is safe to use.
- Review all feature status labels and links against the released application.
- Never publish or request a user's deployment `.env` file, password, token, or model key.

---

## Source-of-truth references

Use the application repository's current configuration and product scope as the source of truth when revising this copy:

- `README.md` — product overview and current V1/V2 distinction.
- `docs/PLAN.md` — Phase 2 scope, open work, and verification status.
- `docs/REFERENCE.md` — architecture, security, offline, and operating contracts.
- `deploy/docker-compose.yml` — current source deployment topology.
- `deploy/Dockerfile.backend` — backend runtime and included media tools.
- `deploy/.env.production.example` — current server configuration names and comments.
- `backend/src/routes/auth.js` — first-account administrator bootstrap and registration closure.
- The standalone website's `docs/labos/` pages — existing draft site copy that this source is intended to replace or consolidate.
