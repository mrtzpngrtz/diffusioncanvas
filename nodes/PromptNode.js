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
                <textarea placeholder="Enter your prompt here..."></textarea>
                <select class="aspect-ratio-select">
                    <option value="1:1">1:1 (1024x1024)</option>
                    <option value="2:3">2:3 (832x1248)</option>
                    <option value="3:2">3:2 (1248x832)</option>
                    <option value="3:4">3:4 (864x1184)</option>
                    <option value="4:3">4:3 (1184x864)</option>
                    <option value="4:5">4:5 (896x1152)</option>
                    <option value="5:4">5:4 (1152x896)</option>
                    <option value="9:16">9:16 (768x1344)</option>
                    <option value="16:9" selected>16:9 (1344x768)</option>
                    <option value="21:9">21:9 (1536x672)</option>
                </select>
                <div class="prompt-actions">
                    <button class="icon-btn node-clone" title="Clone Node">⎘</button>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <div class="model-indicator">Imagen 4.0</div>
                <button class="node-btn generate-btn" disabled>Generate Image</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'prompt',
            element: nodeEl,
            data: { prompt: '', aspectRatio: '16:9', connectedImages: [] },
            position: { x, y }
        };

        // Textarea handling with debounced auto-regeneration
        let regenerateTimeout;
        const textarea = nodeEl.querySelector('textarea');
        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            callbacks.updateGenerateButton(node);
            
            // Auto-regenerate if there's already a result node
            if (node.data.resultNode && node.data.connectedImage && node.data.prompt.trim()) {
                clearTimeout(regenerateTimeout);
                regenerateTimeout = setTimeout(() => {
                    callbacks.generateImage(node);
                }, 1000);
            }
        });

        // Aspect ratio select handling
        const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
        aspectRatioSelect.addEventListener('change', (e) => {
            node.data.aspectRatio = e.target.value;
        });

        // Clone button
        const cloneBtn = nodeEl.querySelector('.node-clone');
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

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
