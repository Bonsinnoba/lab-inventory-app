# LabOS Self-Hosted Backend & Remote Mobile Access
## Independent Architecture Assessment and Implementation Planning Mandate

**Repository:** `Bonsinnoba/lab-inventory-app`  
**Branch:** `main`  
**Phase:** Research, architecture assessment, and implementation planning  
**Implementation authorization:** Not yet granted for this task

## 1. Objective

Independently investigate how to evolve LabOS to support a self-hosted central backend inside the laboratory while allowing authorized users to access LabOS remotely through mobile phones over the internet.

The objective is to make LabOS operationally independent of the internet for normal laboratory workstation operations, while providing secure internet-based remote access when connectivity is available.

Do not assume that the current architecture already satisfies these requirements. Inspect the actual codebase, deployment configuration, database migrations, authentication system, and synchronization implementation before making recommendations.

Your responsibility at this stage is to produce a technically sound, evidence-based implementation plan tailored to the existing application.

**Do not begin implementation until the assessment and proposed plan have been documented.**

## 2. Required Operating Model

The proposed architecture must address the following requirements.

### A. Self-hosted central backend

The laboratory must be able to host its central backend on equipment under its own control.

The assessment must consider:

- PostgreSQL running on a laboratory-owned server.
- The LabOS backend API running on that server.
- Access from laboratory workstations through the local network.
- Reliable startup and recovery after a server restart.
- Persistent database storage.
- Database backups and restoration.
- Appropriate security and administrative controls.

Determine the practical server and operating-system requirements from the application's actual needs. Do not prescribe hardware specifications without a supporting rationale.

### B. Internet-independent laboratory operations

When the laboratory loses its internet connection but its local network and server remain operational:

- Laboratory workstations must still be able to reach the central LabOS API.
- Workstations must be able to access shared central data through the normal application backend.
- Authorized users must continue using supported laboratory functions.
- Central database operations must not depend on an external cloud database being reachable.
- Local SQLite and the synchronization outbox must continue supporting their intended offline capabilities.

Identify all current dependencies that could prevent these outcomes.

Do not assume that every feature works offline merely because PostgreSQL is hosted locally.

For example, investigate dependencies on external authentication providers, AI services, file storage, external APIs, remote resource providers, and other cloud services.

Document which functions can operate without internet access and which require additional work.

### C. Remote mobile access

Authorized users must be able to access LabOS from outside the laboratory using their mobile phones and an internet connection.

The intended experience should support a mobile-friendly interface, preferably through the existing web application or an appropriately designed Progressive Web App if the assessment establishes that this is suitable.

The investigation must cover:

- Secure access through a stable web address or another justified access mechanism.
- Authentication for remote users.
- Server-side authorization and permission enforcement.
- HTTPS and secure session management.
- Revocation of access for disabled users and lost devices.
- Mobile usability.
- Protection against unauthorized access to laboratory and financial information.

Remote access is expected to work when the laboratory's internet connection is available.

**Remote access during a complete laboratory internet outage is not a requirement for this phase.**

Do not introduce a separate cloud database simply to address an outage scenario that is outside the agreed scope.

### D. One authoritative central database

The intended starting point is one authoritative PostgreSQL database hosted inside the laboratory.

The plan must preserve the existing architecture:

**Desktop application → local SQLite and synchronization outbox → LabOS API → PostgreSQL.**

The desktop application must not connect directly to PostgreSQL.

The assessment must establish how local workstation access and remote mobile access can use the same backend safely.

Do not propose two independently writable central databases unless you can demonstrate a concrete requirement that makes them necessary and present the resulting consistency, conflict-resolution, security, and operational implications.

Optional off-site backups or disaster-recovery capabilities may be considered separately from the authoritative database.

## 3. Independently Investigate the Existing Codebase

Inspect the repository thoroughly before proposing changes.

At minimum, investigate the following areas.

| Area | Questions to answer |
|---|---|
| PostgreSQL | How is the database connection configured? Are credentials and connection settings environment-driven? |
| Backend API | Which host and port does the server bind to? Can it serve local-network clients securely? |
| Desktop application | How does it determine the API endpoint? Is the current configuration tied to a remote environment? |
| SQLite | Which data and operations are available locally? Which still require the backend? |
| Synchronization | How are queued changes delivered, retried, deduplicated, and reconciled? |
| Authentication | Does login require an external provider? Can users authenticate when the laboratory has no internet? |
| Authorization | Are permissions enforced on the server for every protected operation? |
| Finance and sensitive data | Are existing finance-specific permission boundaries preserved for mobile access? |
| File storage | Where are uploaded documents, thumbnails, and other resources stored? |
| AI and integrations | Which functions depend on external services? |
| Deployment | How is the backend currently hosted, started, upgraded, and configured? |
| Backups | What backup mechanisms exist, and has restoration been tested? |
| Mobile interface | Which existing pages and workflows are usable on mobile, and what needs improvement? |
| Networking | What local-network and remote-access configuration would be required? |

These are investigation requirements, not assumptions that the features are missing.

For each finding, identify the relevant files, configuration, migrations, functions, or other repository evidence.

Distinguish clearly between:

1. Existing and verified capabilities.
2. Existing capabilities that have not been adequately tested.
3. Identified deficiencies.
4. Proposed future work.

## 4. Independently Research the Infrastructure Options

Research the available deployment and networking options rather than automatically adopting the first suggested technology.

Evaluate appropriate options for:

- Self-hosting PostgreSQL and the LabOS API.
- Providing secure remote access to the API.
- Local-network access and address management.
- Authentication and remote-access protection.
- Backup storage and disaster recovery.
- Service monitoring and restart behavior.
- Secure application updates and database migrations.

A secure tunnel, VPN, or another suitable approach may be considered where relevant.

Compare the options against the actual LabOS requirements, operational complexity, security, cost, reliability, and maintenance burden.

Use current primary documentation where possible.

Do not select a technology solely because it is popular or easy to deploy. Explain why the recommended approach fits the existing system and identify its limitations.

## 5. Security Requirements

The plan must address security across both local and remote access.

In particular:

- PostgreSQL must not be exposed directly to the public internet.
- Remote users must authenticate through an appropriate mechanism.
- Protected operations must enforce authorization on the server.
- Existing role and permission boundaries must remain intact.
- Financially sensitive information must retain its existing access restrictions.
- Disabled users must not retain access.
- Secrets must not be embedded in frontend code or committed to the repository.
- Remote connections must use appropriate transport security.
- Database and API administrative interfaces must not be unintentionally exposed.
- Important actions should be auditable.
- Backups must be protected from unauthorized access.
- Recovery procedures must be documented and tested.

Consider the consequences of a compromised mobile device or a compromised user account.

Do not weaken existing security controls to make local or remote connectivity easier.

## 6. Reliability and Data Integrity

The plan must establish how the system behaves when:

- The laboratory loses internet connectivity.
- A workstation temporarily disconnects from the local network.
- The backend service restarts.
- PostgreSQL becomes temporarily unavailable.
- A workstation submits a change more than once.
- Synchronization is interrupted midway.
- Two workstations modify related records concurrently.
- A user loses permission while a workstation is offline.
- A database migration fails.
- A backup must be restored after server failure.

Pay particular attention to idempotency, transactional integrity, synchronization retries, conflict handling, and the possibility of data loss.

Do not claim that an operation is safe merely because it has an outbox or retry mechanism.

Identify the evidence needed to demonstrate that queued changes are applied correctly and that repeated requests do not create duplicate records or transactions.

## 7. Deployment and Operational Requirements

Produce a deployment plan that an administrator can follow.

It should address:

- Server prerequisites.
- Installation and configuration.
- Database initialization or migration.
- Environment variables and secrets.
- Local-network access.
- Remote-access configuration.
- DNS or address management, where applicable.
- Firewall rules.
- Authentication configuration.
- Automated backups.
- Restoration testing.
- Monitoring and service recovery.
- Upgrade and rollback procedures.
- Workstation configuration.
- Troubleshooting and maintenance documentation.

Clearly separate what must be configured once on the server from what must be configured on each workstation or mobile device.

Identify any hardware, domain, connectivity, subscription, or third-party service requirements.

Do not assume the laboratory has a static public IP address or that its internet provider permits inbound connections. Evaluate the implications of those conditions.

## 8. Testing and Acceptance Criteria

Create a concrete acceptance-test matrix.

At minimum, include these scenarios:

### Local-network operation
- Two or more workstations can access the same central data.
- A change made on one workstation becomes visible to another through the central backend.
- Normal central operations continue when the internet connection is disconnected but the local network remains operational.

### Remote access
- An authorized user can sign in from a phone using an external internet connection.
- The mobile interface works at common phone screen sizes.
- Unauthorized users cannot access protected data.
- Financial permissions remain enforced.
- Disabling a user or revoking their session prevents further access as designed.

### Offline operation and synchronization
- A workstation can perform supported offline operations.
- Queued changes synchronize after connectivity returns.
- Repeated synchronization does not duplicate records or transactions.
- Interrupted synchronization recovers safely.
- Conflicts are handled according to documented rules.

### Server recovery
- The backend starts correctly after a server restart.
- PostgreSQL data survives the restart.
- A backup can be restored and the service brought back online.
- Failed upgrades have a documented recovery path.

### Security
- PostgreSQL is not publicly reachable.
- Only intended services are exposed.
- Secrets are not leaked to the client or repository.
- Authentication and authorization checks are exercised through actual API requests.

For each test, define:

- Preconditions.
- Test procedure.
- Expected outcome.
- Evidence to collect.
- Whether the test can be automated.
- Whether the result has actually been verified.

Do not mark a test as passed merely because the implementation looks correct.

## 9. Required Deliverables

Before any implementation, produce the following documentation.

**Deliverable 1 — Existing Architecture Audit**

Document the current state, evidence, dependencies, gaps, and risks.

**Deliverable 2 — Architecture Proposal**

Describe the proposed deployment and request flows, including local desktop access and remote mobile access.

Include a clear explanation of the authoritative database and the role of SQLite and synchronization.

**Deliverable 3 — Technology Evaluation**

Compare the practical options for self-hosting, remote access, authentication, backups, and monitoring. Document the recommendation and the reasons behind it.

**Deliverable 4 — Implementation Roadmap**

Break the work into logical stages, identify dependencies, list the affected components, and define the completion criteria for each stage.

**Deliverable 5 — Security and Data-Integrity Assessment**

Document the relevant risks, mitigations, existing protections, and unresolved questions.

**Deliverable 6 — Acceptance-Test Plan**

Provide reproducible tests and expected results for local operation, remote access, synchronization, recovery, and security.

**Deliverable 7 — Operational Runbook Outline**

Explain how the eventual system should be installed, maintained, backed up, restored, updated, and troubleshot.

**Deliverable 8 — Decision Register**

Record important architectural decisions, the evidence supporting each recommendation, alternatives considered, trade-offs, and any assumptions that still require confirmation.

## 10. Working Rules and Authorization

You have permission to investigate the repository and conduct the necessary technical research.

However, this assignment is currently **planning-only**.

- Do not implement the proposed infrastructure.
- Do not modify application behavior.
- Do not change the database architecture.
- Do not introduce new dependencies merely to explore an option.
- Do not change authentication or authorization behavior.
- Do not deploy services or expose the application to the internet.
- Do not make destructive changes to the database or repository.
- Do not claim that functionality has been tested when it has only been inspected.
- Do not silently resolve major architectural trade-offs without documenting them.

Work on `main` only if repository access is necessary for the audit, and avoid committing implementation changes during this planning phase.

Document all significant findings and decisions so that the plan can be independently reviewed before implementation is authorized.

If an essential operational requirement cannot be determined from the repository, state the uncertainty and explain what information is needed. Do not invent infrastructure details.

## Final instruction

Approach this as an independent architecture and engineering assignment, not as a request to implement a predetermined design.

**Inspect first. Research independently. Document the evidence. Compare alternatives. Recommend a coherent architecture. Produce the complete implementation plan and acceptance criteria. Then stop and await authorization.**

The eventual outcome should be a LabOS deployment that supports reliable, shared laboratory operations without internet access, secure remote mobile access when internet connectivity is available, and recoverable, permission-controlled data management.
