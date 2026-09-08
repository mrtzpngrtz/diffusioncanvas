// Local inference through a ComfyUI instance.
//
// One provider turns any ComfyUI workflow into a model the canvas can select.
// A workflow is the API-format JSON ComfyUI exports ("Save (API Format)"),
// stored untouched next to a small manifest that says which node/field is the
// prompt, the source image, the duration and so on, and which node produces
// the output. Adding a workflow means adding those two files — no code.
//
// This file is server-only. It lives outside modules/ on purpose: that
// directory is served to browsers as ES modules, this one must not be.

import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const COMFY_MODEL_PREFIX = 'comfy/';

const INPUT_NAMES = ['image', 'lastImage', 'prompt', 'negative', 'duration', 'aspect', 'seed', 'width', 'height'];

// ── Templates ───────────────────────────────────────────────────────────────

// Reads every *.json manifest in the given directories. A manifest's
// `workflow` names the API-format export sitting next to it. Later
// directories win on id collisions, so a user directory can override a
// bundled template of the same name.
export function loadComfyTemplates(dirs) {
    const templates = new Map();
    for (const dir of dirs.filter(Boolean)) {
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.json') || file.endsWith('.workflow.json')) continue;
            const manifestPath = path.join(dir, file);
            try {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
                const workflowPath = path.join(dir, manifest.workflow || file.replace(/\.json$/, '.workflow.json'));
                const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'));
                const template = validateTemplate(manifest, workflow, manifestPath);
                templates.set(COMFY_MODEL_PREFIX + template.id, template);
            } catch (err) {
                // One broken manifest must not take the others down with it
                console.warn(`[comfyui] skipping ${manifestPath}: ${err.message}`);
            }
        }
    }
    return templates;
}

function validateTemplate(m, workflow, where) {
    if (!m.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) throw new Error('manifest needs an id (letters, digits, . _ -)');
    if (!['video', 'image'].includes(m.kind)) throw new Error('kind must be "video" or "image"');
    if (!m.output?.node) throw new Error('manifest needs output.node');
    if (!workflow[m.output.node]) throw new Error(`output node "${m.output.node}" is not in the workflow`);

    const inputs = {};
    for (const [name, spec] of Object.entries(m.inputs || {})) {
        if (!INPUT_NAMES.includes(name)) throw new Error(`unknown input "${name}" (known: ${INPUT_NAMES.join(', ')})`);
        if (!spec.node || !spec.field) throw new Error(`input "${name}" needs node and field`);
        const node = workflow[spec.node];
        if (!node) throw new Error(`input "${name}" points at node "${spec.node}", which is not in the workflow`);
        if (!(spec.field in (node.inputs || {}))) throw new Error(`input "${name}": node "${spec.node}" has no field "${spec.field}"`);
        inputs[name] = { ...spec, original: node.inputs[spec.field] };
    }

    const caps = m.caps || {};
    return {
        id: m.id,
        label: m.label || m.id,
        kind: m.kind,
        description: m.description || '',
        cost: Number.isFinite(m.cost) ? m.cost : 0,
        timeoutMs: m.timeoutMs || 30 * 60 * 1000,
        inputs,
        output: m.output,
        caps: {
            ratios: caps.ratios || (inputs.aspect?.map ? Object.keys(inputs.aspect.map) : ['16:9']),
            durations: caps.durations || (inputs.duration ? [3, 4, 5, 6, 7, 8, 9, 10] : null),
            resolutions: caps.resolutions || ['auto'],
            audio: caps.audio ?? 'native',
            needsImage: !!inputs.image?.required
        },
        workflow,
        source: where
    };
}

// What the client needs to build its dropdowns. No workflow internals.
export function describeTemplate(id, t) {
    return { id, label: t.label, kind: t.kind, description: t.description, cost: t.cost, caps: t.caps };
}

// ── Running one ─────────────────────────────────────────────────────────────

const EXT_MIME = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', gif: 'image/gif',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp'
};

export async function runComfyWorkflow({ baseUrl, template, inputs = {}, log = () => {} }) {
    const base = normalizeUrl(baseUrl);
    const clientId = randomUUID();
    const wf = structuredClone(template.workflow);

    // Images go up first so the workflow can reference them by the name
    // ComfyUI assigns, then every mapped value is written into its node.
    for (const name of ['image', 'lastImage']) {
        const spec = template.inputs[name];
        if (!spec) continue;
        if (!inputs[name]) {
            if (spec.required) throw new Error(`This workflow needs a connected image (${name}).`);
            continue;
        }
        const uploaded = await uploadImage(base, inputs[name], name);
        wf[spec.node].inputs[spec.field] = uploaded;
        log(`uploaded ${name} -> ${uploaded}`);
    }

    for (const [name, spec] of Object.entries(template.inputs)) {
        if (name === 'image' || name === 'lastImage') continue;
        let value = inputs[name];
        if (name === 'seed' && (value === undefined || value === null || value === '')) {
            value = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        }
        if (value === undefined || value === null || value === '') continue;
        if (spec.map) {
            if (!(value in spec.map)) throw new Error(`"${value}" is not an option this workflow supports for ${name}.`);
            value = spec.map[value];
        }
        if (typeof spec.original === 'number') value = Number(value);
        if (typeof spec.original === 'boolean') value = value === true || value === 'true';
        wf[spec.node].inputs[spec.field] = value;
    }

    const promptId = await queue(base, wf, clientId);
    log(`queued ${promptId}`);

    const entry = await waitForHistory(base, promptId, template.timeoutMs, log);
    const file = pickOutput(entry, template.output.node);
    log(`output ${file.subfolder ? file.subfolder + '/' : ''}${file.filename}`);

    return fetchOutput(base, file);
}

// GET /system_stats is the cheapest thing ComfyUI answers; used by the admin
// panel's "test connection" and to give a clear error before a long wait.
export async function checkComfy(baseUrl) {
    const base = normalizeUrl(baseUrl);
    const res = await comfyFetch(base, '/system_stats', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`ComfyUI answered HTTP ${res.status}`);
    const stats = await res.json();
    return {
        version: stats?.system?.comfyui_version || null,
        python: stats?.system?.python_version?.split(' ')[0] || null,
        devices: (stats?.devices || []).map(d => ({ name: d.name, vramTotal: d.vram_total, vramFree: d.vram_free }))
    };
}

// Every call to ComfyUI goes through here so a dead socket reads as "cannot
// reach ComfyUI at <url>" wherever it happens — upload, queue, poll or fetch.
async function comfyFetch(base, pathAndQuery, init) {
    try {
        return await fetch(`${base}${pathAndQuery}`, init);
    } catch (err) {
        const why = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.message);
        throw new Error(`Cannot reach ComfyUI at ${base} (${why}). Is it running, and started with --listen if it is on another machine?`);
    }
}

function normalizeUrl(url) {
    const u = (url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(u)) throw new Error(`ComfyUI URL must start with http:// or https:// (got "${u || 'nothing'}")`);
    return u;
}

async function uploadImage(base, dataUrl, name) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw new Error(`${name} is not a data URL`);
    const mime = m[1];
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const filename = `dc-${randomUUID().slice(0, 8)}.${ext}`;

    const form = new FormData();
    form.append('image', new Blob([Buffer.from(m[2], 'base64')], { type: mime }), filename);
    form.append('overwrite', 'true');
    form.append('type', 'input');

    const res = await comfyFetch(base, '/upload/image', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`ComfyUI image upload failed: HTTP ${res.status} ${await safeText(res)}`);
    const info = await res.json();
    return info.subfolder ? `${info.subfolder}/${info.name}` : info.name;
}

async function queue(base, workflow, clientId) {
    const res = await comfyFetch(base, '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body.node_errors && Object.keys(body.node_errors).length)) {
        throw new Error(`ComfyUI rejected the workflow: ${describeNodeErrors(body)}`);
    }
    if (!body.prompt_id) throw new Error('ComfyUI queued nothing (no prompt_id in the reply).');
    return body.prompt_id;
}

// ComfyUI validates the whole graph before queueing and reports per node.
// Flatten that into one line a person can act on.
function describeNodeErrors(body) {
    const parts = [];
    if (body.error) parts.push(typeof body.error === 'string' ? body.error : (body.error.message || JSON.stringify(body.error)));
    for (const [nodeId, info] of Object.entries(body.node_errors || {})) {
        const title = info.class_type || nodeId;
        for (const e of info.errors || []) {
            const details = e.details ? ` (${e.details})` : '';
            parts.push(`${title}: ${e.message}${details}`);
        }
    }
    return parts.join('; ') || 'no details given';
}

async function waitForHistory(base, promptId, timeoutMs, log) {
    const started = Date.now();
    let lastNote = 0;
    while (true) {
        const res = await comfyFetch(base, `/history/${promptId}`).catch(() => null);
        const hist = res && res.ok ? await res.json().catch(() => ({})) : {};
        const entry = hist[promptId];
        if (entry) {
            const st = entry.status || {};
            if (st.status_str === 'error') throw new Error(`ComfyUI failed: ${describeExecutionError(st)}`);
            if (st.completed || entry.outputs) return entry;
        }
        const elapsed = Date.now() - started;
        if (elapsed > timeoutMs) throw new Error(`ComfyUI did not finish within ${Math.round(timeoutMs / 60000)} min.`);
        if (elapsed - lastNote > 30000) { log(`still running (${Math.round(elapsed / 1000)}s)`); lastNote = elapsed; }
        await new Promise(r => setTimeout(r, 2000));
    }
}

function describeExecutionError(status) {
    for (const [type, data] of status.messages || []) {
        if (type === 'execution_error') {
            return `${data.node_type || data.node_id}: ${data.exception_message || 'unknown error'}`;
        }
    }
    return 'unknown error';
}

// Output nodes report their files under various keys (SaveImage -> images,
// SaveVideo -> images or videos, VHS -> gifs). Take whatever carries a filename.
function pickOutput(entry, nodeId) {
    const out = entry.outputs?.[nodeId];
    if (!out) throw new Error(`Workflow finished but output node ${nodeId} produced nothing.`);
    const files = [];
    for (const value of Object.values(out)) {
        if (!Array.isArray(value)) continue;
        for (const f of value) if (f && typeof f === 'object' && f.filename) files.push(f);
    }
    if (!files.length) throw new Error(`Output node ${nodeId} produced no files.`);
    return files.find(f => f.type === 'output') || files[0];
}

async function fetchOutput(base, file) {
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
    const res = await comfyFetch(base, `/view?${params}`);
    if (!res.ok) throw new Error(`Could not download the result from ComfyUI: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(file.filename).slice(1).toLowerCase();
    const headerMime = res.headers.get('content-type')?.split(';')[0];
    const mime = EXT_MIME[ext] || (headerMime && headerMime !== 'application/octet-stream' ? headerMime : 'application/octet-stream');
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mimeType: mime, filename: file.filename, bytes: buf.length };
}

async function safeText(res) {
    try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
