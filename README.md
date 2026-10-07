# Diffusion Canvas

A node-based visual canvas for AI image, video and 3D generation. Self-hosted:
runs on your own server or as a desktop app, stores every board and image on
your own disk, and talks to whichever model providers you give it keys for.

Vanilla ES6 modules and an Express backend. No build step, no framework.

## Branches

| Branch | What it is |
|---|---|
| `main` / `coolify` | The hosted deployment. Multi-user, OAuth, deploys to Coolify. `main` and `coolify` are kept identical. |
| `desktop` | The packaged Windows / macOS app. Same code, single local owner, no login. See [desktop/README.md](https://github.com/mrtzpngrtz/diffusioncanvas/blob/desktop/desktop/README.md). |

One codebase: desktop is `DC_DESKTOP=1`, not a fork.

## Nodes

Place twelve node types on the canvas and wire them together:

- **Sources** — Image (upload / drag-drop), Draw (brush, shapes, text, eraser), 3D (GLTF, FBX, OBJ, STL)
- **Instruction** — Prompt, Action (preset transforms), Chat (a conversational model in the graph)
- **Transforms** — Format (reframe to a new aspect), Outpaint (extend past the edges), Comp (merge layers)
- **Generators** — Video, Image → 3D
- **Review** — Compare (A/B slider)

Results arrive as their own nodes and can be fed straight back in.

## Models

Keys are optional and per provider — leave one out and its models simply don't
appear.

| Kind | Providers |
|---|---|
| Image | Google (Gemini Image, Imagen), OpenAI (GPT Image), Black Forest Labs (FLUX.2) |
| Video | Seedance via OpenRouter, Gemini Omni Flash |
| 3D | Trellis, Hunyuan3D via Replicate |
| Chat | via OpenRouter |

## Canvas

Pan, zoom, marquee and multi-select, clone, copy/paste, undo. **Work areas** are
labelled regions that move a whole branch of the graph at once. Boards save with
version history, export to JSON, and can be shared on a link — optionally
password-protected, with guests getting a strictly read-only view.

## Self-hosting

```bash
npm install
cp .env.example .env     # add at least SESSION_SECRET and one provider key
npm start                # http://localhost:3000
```

Or with Docker — see the [Dockerfile](Dockerfile). Data lives in `./data`
(boards, versions, images, users, usage). Redis is optional: set `REDIS_URL` to
use it instead of files.

Remaining configuration — API keys, model selection, per-model costs, users and
credits — happens in the admin panel at `/admin`, not in env vars.

### Environment

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | Required for the hosted build. |
| `FRONTEND_URL` | Required when `NODE_ENV=production`. |
| `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `BFL_API_KEY`, `OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN` | Per provider, all optional. Also settable in the admin panel. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | OAuth. Facebook and LinkedIn equivalents optional. Local accounts work without any of them. |
| `REDIS_URL` | Optional; falls back to file storage. |
| `COMFYUI_URL` | Local ComfyUI; also settable in the admin panel. Default `http://127.0.0.1:8188`. |
| `DC_WORKFLOWS_DIR` | Extra directory of ComfyUI workflow manifests, read after `workflows/`. |
| `DC_DESKTOP`, `DC_DATA_DIR` | Desktop build only. |

## Temporary API mode

Before logging in, click **Open canvas in API mode — no login**. No keys are
required to enter. Inside the board, use **API settings** in the top bar to enter,
change or remove keys for Google, OpenAI, Black Forest Labs, OpenRouter or Replicate.
Applying keys never clears the canvas or replaces the session; blank fields remove keys.
The existing image, video, 3D and assistant nodes use those keys. Missing keys
never fall back to the host's credentials. Provider charges apply to your own
account; app credits are not used. Local ComfyUI workflows are not available.

Keys and the session token live only in browser/server memory, not cookies,
local/session storage, files, Redis, accounts or the shared provider-client cache.
Boards, media, prompt-library entries, preferences and usage records are not
persisted in this mode. Saving, sharing and the feedback agent are disabled.
**Download Board** explicitly exports the current canvas to your machine without
including credentials. Requests still pass through this server and the selected
provider, whose own retention policies apply. Use HTTPS for hosted deployments.

Reloading, navigating away or closing the tab ends the browser session. Use
**End API session** for immediate server-side cleanup. If the browser cannot
deliver its close request, the server expires the session after two hours of
inactivity, with a hard limit of 24 hours. A server restart also clears sessions.
Already submitted provider jobs may finish and incur charges after you leave.

### Tests

Run `npm test` on Node.js 24 or newer. Session and integration tests use the
built-in Node test runner, isolated temporary app directories and mocked provider
responses, so they never spend API credits. A real headless Chromium smoke test
runs when Chrome/Edge is installed; set `DC_TEST_BROWSER` to its executable on
other systems. Otherwise that browser test is skipped.

## Desktop app

On the `desktop` branch:

```bash
npm run desktop      # run it
npm run dist:win     # build an installer
npm run dist:mac
```

An Electron shell around the same server, bound to loopback on a free port, with
a single local owner and no login. Data goes to the OS app-data directory.
Details and caveats in [desktop/README.md](https://github.com/mrtzpngrtz/diffusioncanvas/blob/desktop/desktop/README.md).

## Self-updating

Report a bug or request a node from inside the canvas. The request goes to a
coding agent running against this repository, which implements the change,
commits it to its own branch and pushes. With `AGENT_AUTO_MERGE=true` it merges
and deploys itself. Requires `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`.

New node types are one self-contained file each — see [nodes/README.md](nodes/README.md).

## Local inference (ComfyUI)

Any ComfyUI workflow can be a model in the canvas. Export it in API format,
drop it into [workflows/](workflows/) with a small manifest that says which
node holds the prompt, the image, the duration and the output, and it appears
in the Video or Prompt node's dropdown next to the cloud models. The bundled
example is a MiniMax H3 image-to-video graph. See [workflows/README.md](workflows/README.md).

Point the server at ComfyUI under **Local inference** in the admin panel
(default `http://127.0.0.1:8188`). On the desktop app that is the same
machine; a hosted deployment needs a tunnel to your GPU box.

## Offline

Boards, save/load, version history, draw, comp, outpaint, reframe, compare, the
3D viewer and export all work with no network. Cloud models need a key and a
connection. With ComfyUI on the same machine, generation runs air-gapped too.

## Utilities

```bash
node extract_images.js path/to/board.json   # pull every image out of a saved board
```

## License

MIT — see [LICENSE](LICENSE).
