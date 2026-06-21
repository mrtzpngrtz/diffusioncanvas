import { NodeBase } from './NodeBase.js';

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
            ${this.createNodeHeader('Prompt Input')}
            <div class="node-content">
                <textarea placeholder="Enter your prompt here..." spellcheck="false"></textarea>
                <div class="prompt-meta">
                    <span class="prompt-char-count">0 chars · 0 words</span>
                    <div class="prompt-library-wrap">
                        <button class="icon-btn prompt-library-btn" title="Prompt Library">☰</button>
                        <div class="prompt-library-panel" style="display:none">
                            <div class="prompt-library-save">
                                <input class="prompt-library-name" type="text" placeholder="Name…" maxlength="60">
                                <button class="prompt-library-save-btn">Save</button>
                            </div>
                            <div class="prompt-library-list"></div>
                        </div>
                    </div>
                    <button class="icon-btn node-clone prompt-clone-btn" title="Clone Node">⎘</button>
                </div>
                <select class="model-select">
                    <option value="gemini-3.1-flash-image">Nano Banana Flash (image edit)</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro (image edit)</option>
                    <option value="gemini-2.5-flash-image">Nano Banana (image edit)</option>
                    <option value="imagen-4.0-ultra-generate-001">Imagen Ultra (text to image)</option>
                    <option value="imagen-4.0-fast-generate-001">Imagen Fast (text to image)</option>
                    <option value="gpt-image-2-2026-04-21">GPT Image 2 (text &amp; edit)</option>
                </select>
                <select class="aspect-ratio-select">
                    <option value="1:1">1:1 — square</option>
                    <option value="2:3">2:3 — portrait</option>
                    <option value="3:2">3:2 — landscape</option>
                    <option value="3:4">3:4 — portrait</option>
                    <option value="4:3">4:3 — landscape</option>
                    <option value="4:5">4:5 — portrait</option>
                    <option value="5:4">5:4 — landscape</option>
                    <option value="9:16">9:16 — tall</option>
                    <option value="16:9" selected>16:9 — wide</option>
                    <option value="21:9">21:9 — ultrawide</option>
                </select>
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
                <div class="model-indicator">Nano Banana Flash</div>
                <button class="node-btn generate-btn" disabled>Generate Image</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'prompt',
            element: nodeEl,
            data: { prompt: '', model: 'gemini-3.1-flash-image', aspectRatio: '16:9', resolution: 'hd', outputFormat: 'jpg', connectedImages: [] },
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

        // Model select handling
        const modelSelect = nodeEl.querySelector('.model-select');
        modelSelect.addEventListener('change', (e) => {
            node.data.model = e.target.value;
            callbacks.updateGenerateButton(node);
        });

        // Aspect ratio select handling
        const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
        aspectRatioSelect.addEventListener('change', (e) => {
            node.data.aspectRatio = e.target.value;
        });

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
