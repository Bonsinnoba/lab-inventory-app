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

## Production and Preview installations

Production and Preview are separate installed LabOS applications and must never share the same SQLite database.

- **Production** uses the normal `com.lab-inventory.app` application identity and its production SQLite data.
- **Preview** is built with `desktop/src-tauri/tauri.preview.conf.json`, which gives it the separate `com.lab-inventory.app.preview` identity and the `LabOS Preview` product name.
- Tauri uses the application identity when resolving its app-data directory, so the two installations receive separate local SQLite databases.
- Preview is built from the same repository source as Production, but it is a separate executable/build and can be a newer version under test.
- To test a future release with realistic data, make a backup/copy of the Production SQLite database into the Preview environment. Never point Preview at the live Production database.

The Preview build is intentionally not part of the tagged Production release workflow. It is a testing build used while `main` continues to develop toward the next release.

From `desktop/`, build Preview with:

```powershell
npm run tauri:build:preview
```

The Tauri CLI supports configuration overlays for separate application flavours; the Preview overlay changes only the product name, application identifier, and window title.

## Media runtime

LabOS media downloads are performed by the **backend service**, not by the desktop client. Desktop PCs therefore do not need their own copy of FFmpeg or yt-dlp when they connect to the central LabOS backend.

The production backend Docker image provisions both tools:

- FFmpeg is installed from the Debian Bookworm package repository.
- yt-dlp is downloaded at a pinned release version and verified with its SHA-256 digest during the image build.
- The backend explicitly uses `/usr/local/bin/yt-dlp` and `/usr/bin/ffmpeg` in the production container.

Do not commit these third-party executables to the repository. The backend runtime image is the distribution mechanism for the central deployment.

For a local Windows backend, the existing `YTDLP_PATH` and `FFMPEG_PATH` environment overrides may point to locally installed/downloaded tools.

## Before creating a release

1. Finish and verify the changes intended for the release.
2. Make sure `main` is clean and synchronized with `origin/main`.
3. Update the version in all four files above.
4. Commit the version change to `main`.
5. Push `main`.
6. Confirm the pushed commit is the exact source intended for the release.
7. Rebuild the production backend image and verify the media-tool health check reports both FFmpeg and yt-dlp as available.
8. Build the Preview installer from the release candidate state and test it against a separate Preview SQLite database before upgrading Production.

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

The tagged Production installer uses the normal `tauri.conf.json` identity. The Preview overlay is not used by the Production release workflow.

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
- Install Production without overwriting an existing Preview installation or Preview SQLite data.
- Confirm the desktop can connect to the central backend when the backend is available.
- Start LabOS and verify login, inventory, project/knowledge/resource flows, synchronization and the system tray.
- Verify the installed application reports the intended version.
- Confirm Preview and Production can be launched independently when both are installed.
- Confirm each installation reports and uses its own local SQLite data path.

For an integrity check on Windows:

```powershell
Get-FileHash .\LabOS-<version>.msi -Algorithm SHA256
```

Compare the result with the corresponding line in `LabOS-SHA256SUMS.txt`.

## Important rules

- Do not release from an uncommitted working tree.
- Do not create a release tag before the version files have been updated and pushed.
- Do not manually upload locally built installers as the normal release path; the GitHub Actions workflow is the canonical Production build path.
- Do not commit `backend/yt-dlp.exe`, FFmpeg binaries, or other generated third-party executables to the repository.
- Keep `desktop/src-tauri/Cargo.lock` tracked so the desktop dependency graph used for releases remains reproducible.
- Do not use a release tag to bypass unfinished migration or database changes.
- Never configure Preview to use the Production SQLite database.
- Never test a new release by overwriting the installed Production executable or its application data.

## Current V1 baseline

The repository currently uses version `2.2.1`. The next release should increment the patch/minor/major component according to the scope of the changes being released.
