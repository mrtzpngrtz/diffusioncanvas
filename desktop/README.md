# Desktop build

Diffusion Canvas as a packaged Windows / macOS app. Same codebase as the hosted
Coolify deployment — the difference is one environment variable.

## Running it

```bash
npm install          # includes electron + electron-builder
npm run desktop      # launch the app
```

## Building installers

```bash
npm run dist:win     # -> dist/Diffusion Canvas Setup <version>.exe
npm run dist:mac     # -> dist/Diffusion Canvas-<version>.dmg
```

Build on the target OS. macOS builds are unsigned until an Apple Developer ID
is configured, so Gatekeeper will warn on first launch.

## How desktop mode differs

`DC_DESKTOP=1` puts the same server into single-owner mode:

| | Hosted (coolify) | Desktop |
|---|---|---|
| Auth | OAuth + local accounts, JWT | none — one implicit local owner |
| Bind | `0.0.0.0`, port 3000 | `127.0.0.1`, OS-assigned free port |
| `SESSION_SECRET` | required | ephemeral, generated at boot |
| Data | `./data` | OS app-data dir (`DC_DATA_DIR`) |
| Credits | enforced per user | not enforced; session-key generation is not logged |
| Account UI | shown | hidden (`body.desktop-mode`) |

The canvas opens without login or an API-key screen. Set keys from **API settings**
in the board's top bar, or **File → API Settings (this session)** (`Ctrl/Cmd+,`).
Changes apply without clearing the board. Blank fields remove individual keys;
**Remove all keys** clears every provider credential for the current session.

Keys live only in browser/backend memory and are never written to boards, exports,
app settings, cookies or local/session storage. Reloading or restarting clears
them. Persisted admin/environment provider keys are never a fallback for these
sessions. Boards, media and versions still save locally as before; the temporary
keys are separate from the board data. **File → App Settings** retains access to
workflow and other app configuration, not the session-key dialog.

## Architecture

`desktop/main.js` forks `server.js` as a child process with `ELECTRON_RUN_AS_NODE=1`,
waits for it to print `DC_PORT <port>` on stdout, then opens a window on that port.
Running the backend out-of-process means a backend crash shows an error dialog
instead of taking the window down, and `server.js` needs no knowledge of Electron.

`asar` is deliberately off: the server reads and serves plain files from the app
directory, and an archive turns those into a class of path bugs.

## Local ComfyUI

Run ComfyUI on the same machine and the bundled workflows appear in the model
dropdowns with no configuration: the default URL is `http://127.0.0.1:8188`.
Your own workflows go in the app-data folder under `workflows/`
(**File → Open Workflows Folder**), two files each — see the repo's
[workflows/README.md](../workflows/README.md). Restart the app after adding one.

## Offline behaviour

Works with no network: boards, save/load, version history, draw, comp, outpaint,
reframe, compare, the 3D viewer, and export.

Needs a network and a provider key: cloud image, video and 3D generation, and
the chat node. With ComfyUI on the same machine, generation through a local
workflow runs with no network at all.

## Not done yet

- App icons (`desktop/assets/icon.ico`, `icon.icns`) — currently ships the Electron default.
- Code signing / notarization.
- Auto-update (`electron-updater`).
