# Desktop frontend freshness

LabOS uses the same React source for web and Tauri, but not necessarily the same
running assets. In this repository `desktop/src-tauri/Cargo.toml` enables
`custom-protocol` by default. A normal `cargo build` embeds `desktop/dist` into
the desktop executable, even for a debug build. `devPath: http://localhost:1420`
does not make that executable consume Vite's current source.

## Build the embedded desktop in the correct order

Save all edits and close LabOS before replacing its executable. From `desktop/`:

```powershell
npm run build:desktop:debug
```

This builds the TypeScript/Vite frontend first and only then compiles the native
executable with those assets. Do not run the two stages concurrently. Launch:

```powershell
Start-Process -FilePath '.\src-tauri\target\debug\lab-inventory.exe'
```

The embedded desktop does not require Vite to be running. For a packaged installer,
use `npm run tauri:build`; Tauri's configured `beforeBuildCommand` builds the frontend.
Use the dedicated `npm run dev:tauri` workflow when live development is intended;
do not assume a previously compiled default-feature executable is that dev session.

Native or API protocol changes may also require a coordinated server deployment.
Do not reset databases, clear caches/outboxes, or change accounts to fix stale UI.
Preserve data and confirm saved edits before a restart.

## Verify in Tauri, not just a browser

Record the executable path/build time and frontend asset hashes, then inspect the
actual desktop window. A passing web build or a current `localhost:1420` page does
not prove desktop UI freshness. Check known changed controls and startup errors.
Keep visual freshness separate from local/server data parity and offline acceptance.
