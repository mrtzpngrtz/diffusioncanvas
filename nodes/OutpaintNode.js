import { NodeBase } from './NodeBase.js';

// Outpainting node — drag the frame larger than the connected image; the
// padded canvas (image + blank borders) is sent to an image-edit model with
// an outpainting prompt. The padded canvas' aspect ratio drives the output.

const MAX_EXPORT = 2048;
const MAX_PAD = 1.5;          // each side can grow up to 150 % of the image size
const HANDLE = 14;            // handle hit size in CSS px
const FILL = '#ffffff';       // blank-canvas colour the prompt refers to

export function buildOutpaintPrompt() {
    return 'Outpaint this image. The plain white areas around the picture are empty canvas: fill them by naturally continuing the scene — extend backgrounds, surfaces, textures, perspective and lighting seamlessly. Keep the original picture content exactly as it is, do not crop or move it, and add nothing that contradicts it. Output the complete canvas as one coherent image.';
}

export class OutpaintNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node prompt-node outpaint-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '400px';

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Outpaint', 'i-expand')}
            <div class="node-content">
                <div class="outpaint-stage">
                    <canvas class="outpaint-canvas"></canvas>
                    <div class="outpaint-empty">Connect an image, then drag the frame edges</div>
                </div>
                <div class="outpaint-bar">
                    <span class="outpaint-info">—</span>
                    <div class="outpaint-presets">
                        <button class="outpaint-preset" data-ratio="1:1">1:1</button>
                        <button class="outpaint-preset" data-ratio="4:5">4:5</button>
                        <button class="outpaint-preset" data-ratio="3:2">3:2</button>
                        <button class="outpaint-preset" data-ratio="16:9">16:9</button>
                        <button class="outpaint-preset" data-ratio="21:9">21:9</button>
                        <button class="outpaint-preset" data-ratio="reset" title="Reset frame">↺</button>
                    </div>
                </div>
                <div class="prompt-meta">
                    <span class="prompt-char-count">Prompt</span>
                    <button class="icon-btn outpaint-reset-btn" title="Reset prompt to template"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
                <textarea class="format-prompt outpaint-prompt" spellcheck="false"></textarea>
                <div class="prompt-row-2col">
                    <select class="resolution-select">
                        <option value="standard">Standard</option>
                        <option value="hd" selected>HD</option>
                        <option value="4k">4K</option>
                    </select>
                    <select class="output-format-select">
                        <option value="jpg" selected>JPG</option>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                    </select>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <select class="model-select outpaint-model-select model-indicator-select" title="Model">
                    <option value="gemini-3.1-flash-image">Nano Banana Flash</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro</option>
                    <option value="gemini-2.5-flash-image">Nano Banana</option>
                    <option value="gpt-image-2-2026-04-21">GPT Image 2</option>
                    <option value="flux-2-pro-preview">FLUX.2 Pro</option>
                    <option value="flux-2-flex">FLUX.2 Flex</option>
                    <option value="flux-2-max">FLUX.2 Max</option>
                </select>
                <button class="node-btn generate-btn" disabled>Outpaint</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'outpaint',
            element: nodeEl,
            data: {
                pad: { top: 0, right: 0.25, bottom: 0, left: 0.25 }, // fractions of image width/height
                prompt: buildOutpaintPrompt(),
                promptEdited: false,
                model: 'gemini-3.1-flash-image',
                aspectRatio: 'original',
                resolution: 'hd',
                outputFormat: 'jpg',
                imageData: null,
                originalWidth: null,
                originalHeight: null,
                connectedImages: []
            },
            position: { x, y }
        };

        const canvas   = nodeEl.querySelector('.outpaint-canvas');
        const ctx      = canvas.getContext('2d');
        const emptyEl  = nodeEl.querySelector('.outpaint-empty');
        const infoEl   = nodeEl.querySelector('.outpaint-info');
        const textarea = nodeEl.querySelector('.outpaint-prompt');
        const modelSel = nodeEl.querySelector('.outpaint-model-select');
        const resSel   = nodeEl.querySelector('.resolution-select');
        const fmtSel   = nodeEl.querySelector('.output-format-select');

        let srcImg = null, srcKey = null;
        const source = () => (node.data.connectedImages || []).find(n => n.data.imageData) || null;

        const loadSource = () => new Promise((resolve) => {
            const s = source();
            const key = s?.data.imageData || null;
            if (key === srcKey) return resolve(srcImg);
            srcKey = key;
            if (!key) { srcImg = null; return resolve(null); }
            const img = new Image();
            img.onload = () => { srcImg = img; resolve(img); };
            img.onerror = () => { srcImg = null; resolve(null); };
            img.src = key;
        });

        // Geometry of the padded canvas in image pixels
        const geom = (img) => {
            const p = node.data.pad;
            const iw = img.naturalWidth, ih = img.naturalHeight;
            const W = Math.round(iw * (1 + p.left + p.right));
            const H = Math.round(ih * (1 + p.top + p.bottom));
            return { iw, ih, W, H, ox: Math.round(iw * p.left), oy: Math.round(ih * p.top) };
        };

        const ratioLabel = (W, H) => {
            const target = W / H;
            const known = [[1,1],[4,5],[5,4],[3,4],[4,3],[2,3],[3,2],[9,16],[16,9],[21,9],[9,21]];
            let best = null, bd = Infinity;
            for (const [a, b] of known) { const d = Math.abs(Math.log((a / b) / target)); if (d < bd) { bd = d; best = `${a}:${b}`; } }
            return bd < 0.06 ? best : `≈ ${best}`;
        };

        // ── Render preview + export ───────────────────────────────────
        const render = async (exportNow = true) => {
            const img = await loadSource();
            if (!img) {
                canvas.width = 640; canvas.height = 360;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                emptyEl.style.display = '';
                infoEl.textContent = '—';
                node.data.imageData = null;
                return;
            }
            emptyEl.style.display = 'none';
            const g = geom(img);

            // Preview canvas: fit the padded frame into ~800px wide
            const k = Math.min(1, 800 / g.W);
            canvas.width = Math.round(g.W * k);
            canvas.height = Math.round(g.H * k);
            node._k = k; node._g = g;

            ctx.fillStyle = FILL;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Subtle hatch on the blank area so it reads as "to be painted"
            ctx.save();
            ctx.strokeStyle = 'rgba(0,0,0,0.08)';
            ctx.lineWidth = 1;
            for (let d = -canvas.height; d < canvas.width; d += 12) {
                ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + canvas.height, canvas.height); ctx.stroke();
            }
            ctx.restore();
            ctx.drawImage(img, g.ox * k, g.oy * k, g.iw * k, g.ih * k);

            // Frame + handles
            ctx.save();
            ctx.strokeStyle = 'rgba(255,69,0,0.95)';
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
            ctx.fillStyle = 'rgba(255,69,0,0.95)';
            const hs = HANDLE * (canvas.width / canvas.getBoundingClientRect().width || 1);
            const mids = [
                [canvas.width / 2, 0], [canvas.width, canvas.height / 2],
                [canvas.width / 2, canvas.height], [0, canvas.height / 2]
            ];
            mids.forEach(([hx, hy]) => ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs));
            ctx.restore();

            infoEl.textContent = `${g.W} × ${g.H} · ${ratioLabel(g.W, g.H)}`;

            // Export synchronously so refresh() before generation sees the final canvas
            if (exportNow) exportPadded(img, g);
        };

        const exportPadded = (img, g) => {
            const k = Math.min(1, MAX_EXPORT / Math.max(g.W, g.H));
            const oc = document.createElement('canvas');
            oc.width = Math.round(g.W * k); oc.height = Math.round(g.H * k);
            const octx = oc.getContext('2d');
            octx.fillStyle = FILL;
            octx.fillRect(0, 0, oc.width, oc.height);
            octx.drawImage(img, g.ox * k, g.oy * k, g.iw * k, g.ih * k);
            node.data.imageData = oc.toDataURL('image/jpeg', 0.95);
            node.data.originalWidth = oc.width;
            node.data.originalHeight = oc.height;
            callbacks.updateGenerateButton(node);
        };

        // ── Frame dragging ────────────────────────────────────────────
        let drag = null;
        const cssPos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
        const sideAt = (p) => {
            const nearX = (v) => Math.abs(p.x - v) <= HANDLE, nearY = (v) => Math.abs(p.y - v) <= HANDLE;
            if (nearY(0)) return 'top';
            if (nearY(p.h)) return 'bottom';
            if (nearX(0)) return 'left';
            if (nearX(p.w)) return 'right';
            return null;
        };
        canvas.addEventListener('pointermove', (e) => {
            if (drag) return;
            const s = sideAt(cssPos(e));
            canvas.style.cursor = s ? (s === 'top' || s === 'bottom' ? 'ns-resize' : 'ew-resize') : 'default';
        });
        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (!node._g) return;
            const p = cssPos(e);
            const side = sideAt(p);
            if (!side) return;
            drag = { side, start: { ...p }, pad: { ...node.data.pad }, g: node._g };
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const p = cssPos(e);
            const { side, start, pad, g } = drag;
            // CSS px → image px: canvas.width / p.w preview px per css px, then / k → image px
            const cssToImg = (canvas.width / p.w) / node._k;
            const dx = (p.x - start.x) * cssToImg, dy = (p.y - start.y) * cssToImg;
            const clamp = (v) => Math.min(MAX_PAD, Math.max(0, v));
            const np = { ...pad };
            if (side === 'left')   np.left   = clamp(pad.left   - dx / g.iw);
            if (side === 'right')  np.right  = clamp(pad.right  + dx / g.iw);
            if (side === 'top')    np.top    = clamp(pad.top    - dy / g.ih);
            if (side === 'bottom') np.bottom = clamp(pad.bottom + dy / g.ih);
            node.data.pad = np;
            render(false);
        });
        const endDrag = () => { if (drag) { drag = null; render(true); } };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);

        // Ratio presets: grow symmetrically to reach the target ratio
        nodeEl.querySelectorAll('.outpaint-preset').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const img = await loadSource(); if (!img) return;
                const r = btn.dataset.ratio;
                if (r === 'reset') { node.data.pad = { top: 0, right: 0, bottom: 0, left: 0 }; return render(); }
                const [a, b] = r.split(':').map(Number);
                const target = a / b, cur = img.naturalWidth / img.naturalHeight;
                if (target > cur) {
                    const extra = (target * img.naturalHeight - img.naturalWidth) / img.naturalWidth / 2;
                    node.data.pad = { top: 0, bottom: 0, left: Math.min(MAX_PAD, extra), right: Math.min(MAX_PAD, extra) };
                } else {
                    const extra = (img.naturalWidth / target - img.naturalHeight) / img.naturalHeight / 2;
                    node.data.pad = { left: 0, right: 0, top: Math.min(MAX_PAD, extra), bottom: Math.min(MAX_PAD, extra) };
                }
                render();
            });
        });
        nodeEl.querySelector('.outpaint-presets').addEventListener('pointerdown', (e) => e.stopPropagation());

        // ── Prompt / settings ─────────────────────────────────────────
        textarea.value = node.data.prompt;
        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            node.data.promptEdited = true;
            callbacks.updateGenerateButton(node);
        });
        nodeEl.querySelector('.outpaint-reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.prompt = buildOutpaintPrompt();
            node.data.promptEdited = false;
            textarea.value = node.data.prompt;
        });
        modelSel.addEventListener('change', (e) => { node.data.model = e.target.value; callbacks.updateGenerateButton(node); });
        resSel.addEventListener('change', (e) => { node.data.resolution = e.target.value; });
        fmtSel.addEventListener('change', (e) => { node.data.outputFormat = e.target.value; });

        // Connection changes (ConnectionManager hook) → re-render from the new source
        node.updateModeLabel = () => { render(); };
        node.refresh = () => render(true);

        node.syncSettingsUI = () => {
            node.data.pad = { top: 0, right: 0, bottom: 0, left: 0, ...(node.data.pad || {}) };
            node.data.aspectRatio = 'original';
            if ([...modelSel.options].some(o => o.value === node.data.model)) modelSel.value = node.data.model;
            else node.data.model = modelSel.value;
            resSel.value = node.data.resolution || 'hd';
            fmtSel.value = node.data.outputFormat || 'jpg';
            textarea.value = node.data.prompt || buildOutpaintPrompt();
            render();
        };
        render();

        nodeEl.querySelector('.generate-btn').addEventListener('click', () => callbacks.generateImage(node));
        nodeEl.querySelector('.node-close').addEventListener('click', () => callbacks.removeNode(nodeId));
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
