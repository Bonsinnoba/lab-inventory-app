# Desktop client — not built yet

This will be the app that runs on each lab PC and talks to the shared
backend over the local network (see `../backend`).

## Recommended approach

**Tauri + React**, because:
- Much smaller installer/binary than Electron (Tauri uses the OS's built-in
  webview instead of bundling Chromium)
- Lower memory use — matters if it's running on older lab machines
- Still lets you write the UI in React, reusing web skills

Electron is the fallback if Tauri setup friction becomes a blocker — it has
more StackOverflow answers and a gentler first-time setup.

## Getting started with Tauri (when you're ready)

```bash
npm create tauri-app@latest
# choose: React, TypeScript (optional but recommended), npm
```

Then point its HTTP calls at the backend, e.g.:

```js
const res = await fetch('http://<lab-server-ip>:4000/api/items');
const items = await res.json();
```

Since every machine is on the same LAN, `<lab-server-ip>` is just the local
IP of whichever machine runs the backend (e.g. `192.168.1.42`). Consider
giving that machine a static local IP or a simple hostname via your
router so it doesn't change.

## Viewing resources (images, video, audio, PDFs, YouTube links)

These render **inside the app**, not handed off to another program —
see `AGENT_BUILD_PLAN.md` Phase 3 for the full detail. The short version:
the backend's `/api/resources/:id/download` endpoint streams bytes with
Range support and an `inline` disposition for viewable types, so it can
be used directly as an `<img>`/`<video>`/`<audio>` source or fed into
`react-pdf`. Only a few genuinely non-renderable file types (Word docs,
CAD files) fall back to saving a copy and opening it externally.

## Suggested screens to build, in order

1. Items list (table + filters by type/status/location)
2. Item detail (history of transactions + notes for that item)
3. Add/edit item form
4. Financial dashboard (charts — once `/api/transactions` exists)
5. Notebook (list + editor — once `/api/notes` exists)
6. Global search bar (once `/api/search` exists)
