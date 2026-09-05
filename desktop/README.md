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
| Credits | enforced per user | not enforced; usage still recorded |
| Account UI | shown | hidden (`body.desktop-mode`) |

Everything else — nodes, boards, versions, sharing, the admin panel — is
identical. The owner is an admin, so API keys are configured in the same admin
panel the hosted deployment uses (**File → Settings & API Keys**, or `Ctrl/Cmd+,`).

## Architecture

`desktop/main.js` forks `server.js` as a child process with `ELECTRON_RUN_AS_NODE=1`,
waits for it to print `DC_PORT <port>` on stdout, then opens a window on that port.
Running the backend out-of-process means a backend crash shows an error dialog
instead of taking the window down, and `server.js` needs no knowledge of Electron.

`asar` is deliberately off: the server reads and serves plain files from the app
directory, and an archive turns those into a class of path bugs.

## Offline behaviour

Works with no network: boards, save/load, version history, draw, comp, outpaint,
reframe, compare, the 3D viewer, and export.

Needs a network and a provider key: image, video and 3D generation, and the chat
node. Local inference (ComfyUI / Ollama) is not wired up yet — that is what would
make generation genuinely offline.

## Not done yet

- App icons (`desktop/icon.ico`, `icon.icns`) — currently ships the Electron default.
- Code signing / notarization.
- Auto-update (`electron-updater`).
- Local inference provider.
