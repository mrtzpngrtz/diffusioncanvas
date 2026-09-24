import { NodeBase } from './NodeBase.js';

// Local ComfyUI image workflows, registered from GET /api/workflows at boot.
const EXTRA_IMAGE_MODELS = [];
export function registerImageModels(list) {
    for (const t of list || []) if (t.kind === 'image') EXTRA_IMAGE_MODELS.push({ id: t.id, label: t.label });
}
export function imageModelLabel(id) {
    return EXTRA_IMAGE_MODELS.find(m => m.id === id)?.label || null;
}

const LIBRARY_KEY = 'promptLibrary';

function loadLibrary() {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; }
    catch { return []; }
}

function saveLibrary(entries) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
}

export class PromptNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node prompt-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Prompt Input', 'i-chat')}
            <div class="node-content">
                <textarea placeholder="Enter your prompt here..." spellcheck="false"></textarea>
                <div class="prompt-meta">
                    <span class="prompt-char-count">0 chars · 0 words</span>
                    <div class="prompt-library-wrap">
                        <button class="icon-btn prompt-library-btn" title="Prompt Library"><svg class="icon"><use href="#i-menu"/></svg></button>
                        <div class="prompt-library-panel" style="display:none">
                            <div class="prompt-library-save">
                                <input class="prompt-library-name" type="text" placeholder="Name…" maxlength="60">
                                <button class="prompt-library-save-btn">Save</button>
                            </div>
                            <div class="prompt-library-list"></div>
                        </div>
                    </div>
                    <button class="icon-btn node-clone prompt-clone-btn" title="Clone Node"><svg class="icon"><use href="#i-copy"/></svg></button>
                </div>
                <select class="model-select">
                    <option value="gemini-3.1-flash-image">Nano Banana Flash (image edit)</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro (image edit)</option>
                    <option value="gemini-2.5-flash-image">Nano Banana (image edit)</option>
                    <option value="imagen-4.0-ultra-generate-001">Imagen Ultra (text to image)</option>
                    <option value="imagen-4.0-fast-generate-001">Imagen Fast (text to image)</option>
                    <option value="gpt-image-2-2026-04-21">GPT Image 2 (text &amp; edit)</option>
                    <option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst (premium text &amp; edit)</option>
                    <option value="flux-2-pro-preview">FLUX.2 Pro (text &amp; edit)</option>
                    <option value="flux-2-pro">FLUX.2 Pro · fixed (text &amp; edit)</option>
                    <option value="flux-2-flex">FLUX.2 Flex (text &amp; edit)</option>
                    <option value="flux-2-klein-9b-preview">FLUX.2 Klein (text &amp; edit)</option>
                    <option value="flux-2-klein-9b">FLUX.2 Klein · fixed (text &amp; edit)</option>
                    <option value="flux-2-max">FLUX.2 Max (text &amp; edit)</option>
                </select>
                <div class="aspect-ratio-row">
                <select class="aspect-ratio-select">
                    <option value="original" selected>Original — keep source ratio</option>
                    <option value="1:1">1:1 — square</option>
                    <option value="2:3">2:3 — portrait</option>
                    <option value="3:2">3:2 — landscape</option>
                    <option value="3:4">3:4 — portrait</option>
                    <option value="4:3">4:3 — landscape</option>
                    <option value="4:5">4:5 — portrait</option>
                    <option value="5:4">5:4 — landscape</option>
                    <option value="9:16">9:16 — tall</option>
                    <option value="16:9">16:9 — wide</option>
                    <option value="21:9">21:9 — ultrawide</option>
                </select>
                <button class="aspect-restore-btn" title="Restore original ratio" style="display:none"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
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
                <div class="prompt-row-2col flux-flex-row" style="display:none">
                    <label class="flux-param" title="Sampling steps (1–50). Higher = more detail, slower.">
                        <span>Steps</span>
                        <input type="number" class="flux-steps" min="1" max="50" step="1" value="50">
                    </label>
                    <label class="flux-param" title="Guidance (1.5–10). Higher = follows the prompt more closely.">
                        <span>Guid</span>
                        <input type="number" class="flux-guidance" min="1.5" max="10" step="0.5" value="5">
                    </label>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <div class="model-indicator">Nano Banana Flash</div>
                <button class="node-btn generate-btn" disabled>Generate Image</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'prompt',
            element: nodeEl,
            data: { prompt: '', model: 'gemini-3.1-flash-image', aspectRatio: 'original', resolution: 'hd', outputFormat: 'jpg', steps: 50, guidance: 5, connectedImages: [] },
            position: { x, y }
        };

        // Textarea + live char/word counter
        let regenerateTimeout;
        const textarea = nodeEl.querySelector('textarea');
        const charCount = nodeEl.querySelector('.prompt-char-count');

        const updateCounter = (text) => {
            const chars = text.length;
            const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
            charCount.textContent = `${chars} chars · ${words} words`;
        };

        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            updateCounter(e.target.value);
            callbacks.updateGenerateButton(node);

            if (node.data.resultNode && node.data.connectedImage && node.data.prompt.trim()) {
                clearTimeout(regenerateTimeout);
                regenerateTimeout = setTimeout(() => {
                    callbacks.generateImage(node);
                }, 1000);
            }
        });

        // FLUX.2 [flex]-only params (steps / guidance) — shown only for that model
        const fluxFlexRow = nodeEl.querySelector('.flux-flex-row');
        const fluxStepsInput = nodeEl.querySelector('.flux-steps');
        const fluxGuidanceInput = nodeEl.querySelector('.flux-guidance');
        const syncFluxParams = () => {
            fluxFlexRow.style.display = node.data.model === 'flux-2-flex' ? '' : 'none';
        };

        // Model select handling
        const modelSelect = nodeEl.querySelector('.model-select');
        for (const m of EXTRA_IMAGE_MODELS) {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.label} (local)`;
            modelSelect.appendChild(opt);
        }
        modelSelect.addEventListener('change', (e) => {
            node.data.model = e.target.value;
            syncFluxParams();
            callbacks.updateGenerateButton(node);
        });
        syncFluxParams();

        fluxStepsInput.addEventListener('change', (e) => {
            const v = Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 50)));
            node.data.steps = v;
            e.target.value = v;
        });
        fluxGuidanceInput.addEventListener('change', (e) => {
            const v = Math.min(10, Math.max(1.5, Number(e.target.value) || 5));
            node.data.guidance = v;
            e.target.value = v;
        });

        // Aspect ratio select handling
        const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
        const aspectRestoreBtn = nodeEl.querySelector('.aspect-restore-btn');

        // The restore button only appears once the ratio deviates from the source
        const syncAspectRestore = () => {
            aspectRestoreBtn.style.display = node.data.aspectRatio === 'original' ? 'none' : '';
        };

        aspectRatioSelect.addEventListener('change', (e) => {
            node.data.aspectRatio = e.target.value;
            syncAspectRestore();
        });

        aspectRestoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.aspectRatio = 'original';
            aspectRatioSelect.value = 'original';
            syncAspectRestore();
        });
        syncAspectRestore();

        const resolutionSelect = nodeEl.querySelector('.resolution-select');
        resolutionSelect.addEventListener('change', (e) => {
            node.data.resolution = e.target.value;
        });

        const outputFormatSelect = nodeEl.querySelector('.output-format-select');
        outputFormatSelect.addEventListener('change', (e) => {
            node.data.outputFormat = e.target.value;
        });

        // Clone button
        const cloneBtn = nodeEl.querySelector('.prompt-clone-btn');
        cloneBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.cloneNode(node.id);
        });

        // Prompt library
        const libraryBtn = nodeEl.querySelector('.prompt-library-btn');
        const libraryPanel = nodeEl.querySelector('.prompt-library-panel');
        const libraryList = nodeEl.querySelector('.prompt-library-list');
        const libraryNameInput = nodeEl.querySelector('.prompt-library-name');
        const librarySaveBtn = nodeEl.querySelector('.prompt-library-save-btn');

        const renderLibrary = () => {
            const entries = loadLibrary();
            if (!entries.length) {
                libraryList.innerHTML = '<div class="prompt-library-empty">No saved prompts</div>';
                return;
            }
            libraryList.innerHTML = '';
            entries.forEach((entry, idx) => {
                const row = document.createElement('div');
                row.className = 'prompt-library-item';
                row.innerHTML = `<span class="prompt-library-item-name" title="${entry.text}">${entry.name}</span><button class="prompt-library-del" data-idx="${idx}" title="Delete">✕</button>`;
                row.querySelector('.prompt-library-item-name').addEventListener('click', () => {
                    textarea.value = entry.text;
                    node.data.prompt = entry.text;
                    updateCounter(entry.text);
                    callbacks.updateGenerateButton(node);
                    libraryPanel.style.display = 'none';
                });
                row.querySelector('.prompt-library-del').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const lib = loadLibrary();
                    lib.splice(idx, 1);
                    saveLibrary(lib);
                    renderLibrary();
                });
                libraryList.appendChild(row);
            });
        };

        libraryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = libraryPanel.style.display !== 'none';
            libraryPanel.style.display = open ? 'none' : 'block';
            if (!open) { renderLibrary(); libraryNameInput.focus(); }
        });

        librarySaveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = node.data.prompt.trim();
            if (!text) return;
            const name = libraryNameInput.value.trim() || text.slice(0, 40);
            const lib = loadLibrary();
            lib.unshift({ name, text });
            saveLibrary(lib);
            libraryNameInput.value = '';
            renderLibrary();
        });

        libraryNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') librarySaveBtn.click();
            e.stopPropagation();
        });

        // Close panel on outside click
        document.addEventListener('click', (e) => {
            if (!nodeEl.contains(e.target)) libraryPanel.style.display = 'none';
        });

        // Generate button
        const generateBtn = nodeEl.querySelector('.generate-btn');
        generateBtn.addEventListener('click', () => callbacks.generateImage(node));

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Connection points
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });

        // Resize handle (width + height)
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
