import { NodeBase } from './NodeBase.js';

// Composite node — overlays layers (transparent PNG logos, other images) on a
// base image with drag placement, scale, rotation and opacity. The rendered
// composite is exposed as node.data.imageData so prompts, video, format and
// 3D nodes can consume it like any image.
//
// Base  = first connected image. Further connected images become layers
// automatically; PNG/JPG files can be added directly as extra layers.

const MAX_EXPORT = 2048;   // longest edge of the exported composite
const PRESET_MARGIN = 0.04; // relative margin for placement presets

let layerSeq = 0;
const newLayer = (partial) => ({
    id: `L${Date.now().toString(36)}${(layerSeq++).toString(36)}`,
    kind: 'file', sourceId: null, src: null, name: 'Layer',
    x: 0.5, y: 0.5, scale: 0.25, opacity: 1, rotation: 0, visible: true,
    ...partial
});

export class CompNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node comp-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '400px';

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Composite', 'i-layers')}
            <div class="node-content">
                <div class="comp-stage">
                    <canvas class="comp-canvas"></canvas>
                    <div class="comp-empty">Connect a base image (input 1)</div>
                </div>
                <div class="comp-toolbar">
                    <button class="comp-add-btn" title="Add overlay image (PNG with transparency, JPG…)">
                        <svg class="icon"><use href="#i-plus"/></svg>Add overlay
                    </button>
                    <input type="file" accept="image/*" multiple style="display:none">
                    <span class="comp-hint">drag to place · wheel to scale</span>
                    <button class="icon-btn comp-refresh-btn" title="Re-render from sources"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
                <div class="comp-layers"></div>
                <div class="comp-controls">
                    <div class="comp-ctrl-row">
                        <span class="comp-ctrl-lbl">Scale</span>
                        <input class="comp-slider comp-scale" type="range" min="2" max="150" value="25">
                        <span class="comp-ctrl-val comp-scale-val">25%</span>
                    </div>
                    <div class="comp-ctrl-row">
                        <span class="comp-ctrl-lbl">Opacity</span>
                        <input class="comp-slider comp-opacity" type="range" min="0" max="100" value="100">
                        <span class="comp-ctrl-val comp-opacity-val">100%</span>
                    </div>
                    <div class="comp-ctrl-row">
                        <span class="comp-ctrl-lbl">Rotate</span>
                        <input class="comp-slider comp-rotation" type="range" min="-180" max="180" value="0">
                        <span class="comp-ctrl-val comp-rotation-val">0°</span>
                    </div>
                    <div class="comp-ctrl-row comp-presets">
                        <span class="comp-ctrl-lbl">Place</span>
                        <div class="comp-preset-grid">
                            ${['tl','t','tr','l','c','r','bl','b','br'].map(p => `<button class="comp-preset" data-pos="${p}" title="${p.toUpperCase()}"></button>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
        `;

        const node = {
            id: nodeId,
            type: 'comp',
            element: nodeEl,
            data: {
                connectedImages: [],
                layers: [],
                selectedLayer: null,
                imageData: null,
                originalWidth: null,
                originalHeight: null
            },
            position: { x, y }
        };

        const canvas    = nodeEl.querySelector('.comp-canvas');
        const ctx       = canvas.getContext('2d');
        const emptyEl   = nodeEl.querySelector('.comp-empty');
        const fileInput = nodeEl.querySelector('input[type="file"]');
        const layersEl  = nodeEl.querySelector('.comp-layers');
        const controls  = nodeEl.querySelector('.comp-controls');
        const scaleIn   = nodeEl.querySelector('.comp-scale');
        const opacityIn = nodeEl.querySelector('.comp-opacity');
        const rotIn     = nodeEl.querySelector('.comp-rotation');

        // ── Image cache ────────────────────────────────────────────────
        const imgCache = new Map(); // src → HTMLImageElement (loaded)
        const loadImg = (src) => new Promise((resolve) => {
            if (!src) return resolve(null);
            const cached = imgCache.get(src);
            if (cached) return resolve(cached.complete ? cached : null);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
            imgCache.set(src, img);
        });

        const baseNode  = () => (node.data.connectedImages || []).find(n => n.data.imageData) || null;
        const layerSrc  = (l) => l.kind === 'node'
            ? ((node.data.connectedImages || []).find(n => n.id === l.sourceId)?.data.imageData || null)
            : l.src;
        const selected  = () => node.data.layers.find(l => l.id === node.data.selectedLayer) || null;

        // ── Rendering ─────────────────────────────────────────────────
        let renderQueued = false;
        let lastExport = '';
        const render = async (exportNow = true) => {
            if (renderQueued) return;
            renderQueued = true;
            await Promise.resolve();
            renderQueued = false;

            const base = baseNode();
            const baseImg = base ? await loadImg(base.data.imageData) : null;
            if (!baseImg) {
                canvas.width = 640; canvas.height = 360;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                emptyEl.style.display = '';
                node.data.imageData = null;
                return;
            }
            emptyEl.style.display = 'none';

            const k = Math.min(1, MAX_EXPORT / Math.max(baseImg.naturalWidth, baseImg.naturalHeight));
            const W = Math.round(baseImg.naturalWidth * k), H = Math.round(baseImg.naturalHeight * k);
            if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

            ctx.clearRect(0, 0, W, H);
            ctx.drawImage(baseImg, 0, 0, W, H);

            const boxes = [];
            for (const l of node.data.layers) {
                if (l.visible === false) continue;
                const img = await loadImg(layerSrc(l));
                if (!img) continue;
                const w = l.scale * W, h = w * (img.naturalHeight / img.naturalWidth);
                const cx = l.x * W, cy = l.y * H;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((l.rotation || 0) * Math.PI / 180);
                ctx.globalAlpha = l.opacity ?? 1;
                ctx.drawImage(img, -w / 2, -h / 2, w, h);
                ctx.restore();
                boxes.push({ id: l.id, cx, cy, w, h });
            }
            node._layerBoxes = boxes;

            if (exportNow) {
                const out = canvas.toDataURL('image/jpeg', 0.92);
                if (out !== lastExport) {
                    lastExport = out;
                    node.data.imageData = out;
                    node.data.originalWidth = W;
                    node.data.originalHeight = H;
                }
            }

            // Selection outline (drawn after export so it never ends up in the image)
            const sel = boxes.find(b => b.id === node.data.selectedLayer);
            if (sel) {
                const l = selected();
                ctx.save();
                ctx.translate(sel.cx, sel.cy);
                ctx.rotate((l?.rotation || 0) * Math.PI / 180);
                ctx.setLineDash([Math.max(4, W / 160), Math.max(4, W / 160)]);
                ctx.lineWidth = Math.max(1.5, W / 500);
                ctx.strokeStyle = 'rgba(255,69,0,0.95)';
                ctx.strokeRect(-sel.w / 2, -sel.h / 2, sel.w, sel.h);
                ctx.restore();
            }
        };

        // ── Layer list / controls ─────────────────────────────────────
        const fmtVal = () => {
            const l = selected();
            controls.classList.toggle('disabled', !l);
            if (!l) return;
            scaleIn.value = Math.round(l.scale * 100);
            opacityIn.value = Math.round((l.opacity ?? 1) * 100);
            rotIn.value = Math.round(l.rotation || 0);
            nodeEl.querySelector('.comp-scale-val').textContent = `${Math.round(l.scale * 100)}%`;
            nodeEl.querySelector('.comp-opacity-val').textContent = `${Math.round((l.opacity ?? 1) * 100)}%`;
            nodeEl.querySelector('.comp-rotation-val').textContent = `${Math.round(l.rotation || 0)}°`;
        };

        const renderList = () => {
            layersEl.innerHTML = '';
            if (!node.data.layers.length) {
                layersEl.innerHTML = '<div class="comp-layers-empty">No overlays — connect more images or add a PNG</div>';
                fmtVal();
                return;
            }
            // top-most layer first in the list
            [...node.data.layers].reverse().forEach(l => {
                const row = document.createElement('div');
                row.className = 'comp-layer' + (l.id === node.data.selectedLayer ? ' selected' : '') + (l.visible === false ? ' hidden' : '');
                row.innerHTML = `
                    <button class="icon-btn comp-layer-vis" title="Show / hide"><svg class="icon"><use href="#${l.visible === false ? 'i-x' : 'i-image'}"/></svg></button>
                    <span class="comp-layer-name">${l.name}</span>
                    <span class="comp-layer-kind">${l.kind === 'node' ? 'input' : 'file'}</span>
                    <button class="icon-btn comp-layer-up" title="Bring forward"><svg class="icon"><use href="#i-chevron-down"/></svg></button>
                    <button class="icon-btn comp-layer-del" title="Remove layer"><svg class="icon"><use href="#i-trash"/></svg></button>
                `;
                row.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    node.data.selectedLayer = l.id;
                    renderList(); render();
                });
                row.querySelector('.comp-layer-vis').addEventListener('click', (e) => {
                    e.stopPropagation(); l.visible = l.visible === false; renderList(); render();
                });
                row.querySelector('.comp-layer-up').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const i = node.data.layers.indexOf(l);
                    if (i < node.data.layers.length - 1) {
                        node.data.layers.splice(i, 1); node.data.layers.splice(i + 1, 0, l);
                        renderList(); render();
                    }
                });
                row.querySelector('.comp-layer-del').addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.data.layers = node.data.layers.filter(x => x.id !== l.id);
                    if (node.data.selectedLayer === l.id) node.data.selectedLayer = node.data.layers.at(-1)?.id || null;
                    renderList(); render();
                });
                layersEl.appendChild(row);
            });
            fmtVal();
        };

        const onSlider = (input, apply) => {
            input.addEventListener('pointerdown', (e) => e.stopPropagation());
            input.addEventListener('input', (e) => {
                const l = selected(); if (!l) return;
                apply(l, +e.target.value);
                fmtVal(); render(false);
            });
            input.addEventListener('change', () => render(true));
        };
        onSlider(scaleIn,   (l, v) => { l.scale = v / 100; });
        onSlider(opacityIn, (l, v) => { l.opacity = v / 100; });
        onSlider(rotIn,     (l, v) => { l.rotation = v; });

        // Placement presets — edge presets keep a small margin from the border
        nodeEl.querySelectorAll('.comp-preset').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const l = selected(); if (!l) return;
                const img = await loadImg(layerSrc(l));
                const W = canvas.width || 1, H = canvas.height || 1;
                const w = l.scale;                                        // relative to W
                const h = img ? (l.scale * W * (img.naturalHeight / img.naturalWidth)) / H : w; // relative to H
                const pos = btn.dataset.pos;
                const xs = { l: PRESET_MARGIN + w / 2, c: 0.5, r: 1 - PRESET_MARGIN - w / 2 };
                const ys = { t: PRESET_MARGIN + h / 2, c: 0.5, b: 1 - PRESET_MARGIN - h / 2 };
                const hx = pos.includes('l') ? 'l' : pos.includes('r') ? 'r' : 'c';
                const vy = pos.startsWith('t') ? 't' : pos.startsWith('b') ? 'b' : 'c';
                l.x = xs[hx]; l.y = ys[vy];
                render();
            });
        });

        // ── Direct manipulation on the canvas ─────────────────────────
        let drag = null;
        const hit = (px, py) => {
            const boxes = node._layerBoxes || [];
            for (let i = boxes.length - 1; i >= 0; i--) {
                const b = boxes[i];
                if (Math.abs(px - b.cx) <= b.w / 2 && Math.abs(py - b.cy) <= b.h / 2) return b.id;
            }
            return null;
        };
        const canvasPos = (e) => {
            const r = canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
        };
        canvas.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const p = canvasPos(e);
            const id = hit(p.x, p.y);
            if (id) node.data.selectedLayer = id;
            renderList();
            const l = selected();
            if (id && l) {
                drag = { id, dx: l.x * canvas.width - p.x, dy: l.y * canvas.height - p.y };
                canvas.setPointerCapture(e.pointerId);
                canvas.style.cursor = 'grabbing';
            }
            render(false);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const l = selected(); if (!l) return;
            const p = canvasPos(e);
            l.x = Math.min(1.2, Math.max(-0.2, (p.x + drag.dx) / canvas.width));
            l.y = Math.min(1.2, Math.max(-0.2, (p.y + drag.dy) / canvas.height));
            render(false);
        });
        const endDrag = () => { if (drag) { drag = null; canvas.style.cursor = ''; render(true); } };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', (e) => {
            const l = selected(); if (!l) return;
            e.preventDefault(); e.stopPropagation();
            l.scale = Math.min(1.5, Math.max(0.02, l.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
            fmtVal(); render(true);
        }, { passive: false });

        // ── Adding file layers ────────────────────────────────────────
        const addFiles = (files) => {
            [...files].filter(f => f.type.startsWith('image/')).forEach(file => {
                if (file.size > 4 * 1024 * 1024) { alert(`${file.name} is larger than 4 MB`); return; }
                const r = new FileReader();
                r.onload = (ev) => {
                    const l = newLayer({ kind: 'file', src: ev.target.result, name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) });
                    node.data.layers.push(l);
                    node.data.selectedLayer = l.id;
                    renderList(); render();
                };
                r.readAsDataURL(file);
            });
        };
        nodeEl.querySelector('.comp-add-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
        fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
        const stage = nodeEl.querySelector('.comp-stage');
        stage.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); stage.classList.add('drag-over'); });
        stage.addEventListener('dragleave', () => stage.classList.remove('drag-over'));
        stage.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); stage.classList.remove('drag-over');
            addFiles(e.dataTransfer.files);
        });
        nodeEl.querySelector('.comp-refresh-btn').addEventListener('click', (e) => { e.stopPropagation(); node.refresh(true); });

        // ── Sync with connections ─────────────────────────────────────
        // Called by ConnectionManager on connect/disconnect (and on load).
        // Inputs 2..n become 'node' layers; layers whose source vanished are dropped.
        node.updateModeLabel = () => {
            const imgs = (node.data.connectedImages || []);
            const overlaySources = imgs.slice(1);
            const ids = new Set(overlaySources.map(n => n.id));
            node.data.layers = node.data.layers.filter(l => l.kind !== 'node' || ids.has(l.sourceId));
            overlaySources.forEach((src, i) => {
                if (!node.data.layers.some(l => l.kind === 'node' && l.sourceId === src.id)) {
                    const l = newLayer({ kind: 'node', sourceId: src.id, name: `Input ${i + 2}`, scale: 0.3 });
                    node.data.layers.push(l);
                    node.data.selectedLayer = l.id;
                }
            });
            if (!selected()) node.data.selectedLayer = node.data.layers.at(-1)?.id || null;
            renderList();
            render();
        };

        // Re-render if any source image changed since the last export
        node.refresh = (force = false) => {
            const sig = [baseNode()?.data.imageData?.length, ...node.data.layers.map(l => layerSrc(l)?.length)].join('|');
            if (force || sig !== node._sig) { node._sig = sig; return render(true); }
        };

        node.syncSettingsUI = () => {
            node.data.layers = (node.data.layers || []).map(l => newLayer(l));
            renderList(); render();
        };

        renderList(); render();

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
