# Local ComfyUI workflows

Every workflow in this folder shows up as a model in the canvas — video
workflows in the Video node, image workflows in the Prompt node. Nothing else
is needed: no code, no restart of the browser, one restart of the server.

## Adding one

1. In ComfyUI, get the workflow running the way you want it.
2. Export it with **Workflow → Export (API)**. That is the API format: a flat
   object of node ids, each with `inputs` and `class_type`. The normal
   "Save" format (with `nodes` and `links` arrays) will not work.
3. Save it here as `<id>.workflow.json`.
4. Write `<id>.json` next to it — the manifest. Copy `minimax-h3-i2v.json` and
   change the node ids.
5. Restart the server. The boot log lists what it loaded, and warns about
   anything it skipped and why.

## The manifest

```json
{
  "id": "minimax-h3-i2v",
  "label": "MiniMax H3 · local",
  "kind": "video",
  "workflow": "minimax-h3-i2v.workflow.json",
  "cost": 0,
  "inputs": {
    "image":    { "node": "114",     "field": "image", "required": true },
    "prompt":   { "node": "105:104", "field": "prompt" },
    "duration": { "node": "105:111", "field": "value" },
    "aspect":   { "node": "115",     "field": "aspect_ratio",
                  "map": { "16:9": "16:9 (Widescreen)" } },
    "seed":     { "node": "105:15",  "field": "noise_seed" }
  },
  "output": { "node": "92" },
  "caps": { "durations": [3, 4, 5, 6, 7, 8, 9, 10], "audio": "native" }
}
```

`inputs` says where each canvas value is written. Every entry is optional —
map only what your graph actually exposes. Known input names:

| Name | What the canvas sends |
|---|---|
| `image` | the first connected image, uploaded to ComfyUI first; the field receives the uploaded filename |
| `lastImage` | the second connected image (last frame) |
| `prompt` | the prompt text |
| `negative` | reserved for a negative prompt |
| `duration` | seconds, as a number |
| `aspect` | the ratio picked in the node, e.g. `16:9`. Use `map` when the target field wants a different string — the map's keys become the ratios the node offers |
| `seed` | random per run unless the canvas sends one |
| `width`, `height` | pixel dimensions, for graphs that take them directly |

Values are coerced to the type of the value already in the field, so a
`PrimitiveFloat` gets a number and a `PrimitiveBoolean` gets a boolean.

`output.node` is the node whose files come back — a `SaveVideo`, `SaveImage`
or similar. The server reads the first file it reports.

`caps` drives the dropdowns: `durations` (list of seconds or omit for none),
`ratios` (defaults to the aspect map's keys), `resolutions` (defaults to
`auto`), `audio` (`"native"`, `true`, or `false`).

`cost` is the credit price on the hosted deployment. Local generation defaults
to free.

## Where ComfyUI runs

The URL is set in the admin panel under **Local inference**, or with
`COMFYUI_URL`. Default is `http://127.0.0.1:8188`.

The server has to reach it. On the desktop app that is the same machine. On a
hosted deployment without a GPU it means a tunnel to your GPU box — Tailscale
or Cloudflare — and ComfyUI started with `--listen`.

Custom nodes referenced by a workflow must be installed in that ComfyUI. The
server reports ComfyUI's own validation errors verbatim when one is missing.

## User workflows outside the repo

Set `DC_WORKFLOWS_DIR` to a second directory to load from. It is read after
this one, so a manifest with the same `id` there overrides the bundled one.
The desktop app points this at its app-data folder.
