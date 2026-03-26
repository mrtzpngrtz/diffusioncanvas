import { NodeBase } from './NodeBase.js';

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
                    <button class="icon-btn node-clone prompt-clone-btn" title="Clone Node">⎘</button>
                </div>
                <select class="model-select">
                    <option value="gemini-3.1-flash-image-preview">Nano Banana Flash</option>
                    <option value="gemini-3-pro-image-preview">Nano Banana Pro</option>
                    <option value="imagen-4.0-ultra-generate-001">Imagen Ultra</option>
                    <option value="imagen-4.0-fast-generate-001">Imagen Fast</option>
                </select>
                <select class="aspect-ratio-select">
                    <option value="1:1">1:1 — 1024×1024</option>
                    <option value="2:3">2:3 — 832×1248</option>
                    <option value="3:2">3:2 — 1248×832</option>
                    <option value="3:4">3:4 — 864×1184</option>
                    <option value="4:3">4:3 — 1184×864</option>
                    <option value="4:5">4:5 — 896×1152</option>
                    <option value="5:4">5:4 — 1152×896</option>
                    <option value="9:16">9:16 — 768×1344</option>
                    <option value="16:9" selected>16:9 — 1344×768</option>
                    <option value="21:9">21:9 — 1536×672</option>
                </select>
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
            data: { prompt: '', model: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9', connectedImages: [] },
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

        // Clone button
        const cloneBtn = nodeEl.querySelector('.prompt-clone-btn');
        cloneBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.cloneNode(node.id);
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
