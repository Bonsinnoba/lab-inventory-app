# V1 presentation viewing — primary-agent report

Identity: LABOS-P2-PRIMARY. Owner chose external presentation viewing for V1;
in-app slide rendering/editing is deferred. This work is separate from the
already-installed project approval/date hotfix.

## Scope and implementation

- Shared resource viewer recognizes original `.ppt` / `.pptx` filenames and offers
  **Open in presentation app** in desktop; web retains ordinary download guidance.
- Native command takes only resource/account/session identifiers, checks current
  resource-view permission and session, and resolves the existing authorized local
  file through the same managed-file resolution used by other local viewers.
- Missing local copies fail clearly; there is no direct server-write fallback or
  new download/sync architecture. Existing replication obtains files when online.
- A bounded, separate copy gets a generated temporary directory and fixed safe
  filename. Revision, session and source-path checks repeat before handing it to
  the OS default application. No caller-supplied path or command is executed.
- Shell-open scope retains URL support and adds only the generated Windows path
  pattern ending in `Presentation.ppt` or `Presentation.pptx`; no general file-open
  or execute scope is enabled.
- Successful temporary copies are retained for the external reader. They are
  outside LabOS managed storage, not remotely revocable, and external edits do not
  sync back. UI discloses the separate-copy behavior. No auto cleanup while the
  external app may still be using the file; failed copies are removed.
- No backend, database, outbox or document conversion changes. No executable
  rebuild/install or live-data mutation claimed by source implementation alone.

## Verification and remaining checks

Native unit test checks extension allowlisting, including double extensions and
macro-enabled extension rejection. TypeScript passed; the saved JavaScript shell
scope regression passed (1/1), and diff whitespace checks passed. Native test
build completed successfully (5m52s); extension allowlist test passed (1/1).
Before delivery: record results, build the V1 overlay, verify OS opening with a
locally available presentation offline, missing-file/default-app handling and
preservation of the managed original. Real opening in PowerPoint is not yet verified.

STATUS: SOURCE IMPLEMENTED — CHECKS / PACKAGING / DESKTOP ACCEPTANCE PENDING.
