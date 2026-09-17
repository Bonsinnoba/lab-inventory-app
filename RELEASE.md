# LabOS Release Process

This document defines the V1 release flow for LabOS.

## Release model

LabOS releases are versioned from Git tags using semantic versioning:

```text
vMAJOR.MINOR.PATCH
```

The release workflow builds the Windows desktop application and publishes the generated installers and SHA-256 checksums to a GitHub Release.

The release tag must match the application version in all four locations:

- `desktop/package.json`
- `backend/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`

## Before creating a release

1. Finish and verify the changes intended for the release.
2. Make sure `main` is clean and synchronized with `origin/main`.
3. Update the version in all four files above.
4. Commit the version change to `main`.
5. Push `main`.
6. Confirm the pushed commit is the exact source intended for the release.

Example version update:

```text
2.2.1 -> 2.2.2
```

## Create the release

From the repository root:

```powershell
git checkout main
git pull origin main
git tag v2.2.2
git push origin v2.2.2
```

Pushing a tag matching `v*.*.*` starts `.github/workflows/release.yml` automatically.

The workflow:

1. Checks out the tagged source.
2. Validates that the tag version matches the desktop, backend, Tauri and Cargo versions.
3. Installs desktop dependencies with `npm ci`.
4. Builds the Tauri desktop application.
5. Collects the Windows `.msi` and `.exe` installers.
6. Generates `LabOS-SHA256SUMS.txt`.
7. Creates or updates the GitHub Release for the tag with generated release notes and the installers/checksum file.

## Manual release rebuild

The workflow also supports `workflow_dispatch`. This is useful when a release needs to be rebuilt without creating another tag.

Use the GitHub Actions UI and provide the existing release tag, for example:

```text
v2.2.2
```

The tag must already exist and its version must still match the four version files.

## Verifying a release

After the workflow finishes:

- Confirm the GitHub Release exists for the exact tag.
- Confirm both Windows installer formats that were produced are attached.
- Confirm `LabOS-SHA256SUMS.txt` is attached.
- Download the installer and perform a clean installation test.
- Start LabOS and verify login, inventory, project/knowledge/resource flows, synchronization and the system tray.
- Verify the installed application reports the intended version.

For an integrity check on Windows:

```powershell
Get-FileHash .\LabOS-<version>.msi -Algorithm SHA256
```

Compare the result with the corresponding line in `LabOS-SHA256SUMS.txt`.

## Important rules

- Do not release from an uncommitted working tree.
- Do not create a release tag before the version files have been updated and pushed.
- Do not manually upload locally built installers as the normal release path; the GitHub Actions workflow is the canonical build path.
- Do not commit `backend/yt-dlp.exe` or other generated third-party executables to the repository.
- Keep `desktop/src-tauri/Cargo.lock` tracked so the desktop dependency graph used for releases remains reproducible.
- Do not use a release tag to bypass unfinished migration or database changes.

## Current V1 baseline

The repository currently uses version `2.2.1`. The next release should increment the patch/minor/major component according to the scope of the changes being released.
