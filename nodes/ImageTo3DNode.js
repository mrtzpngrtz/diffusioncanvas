import { NodeBase } from './NodeBase.js';

// Image → 3D via Replicate. The server resolves each model's input schema at
// runtime and maps these generic settings onto the fields the model exposes.
export const IMAGE_TO_3D_MODELS = {
    'fishwowater/trellis2':     { label: 'TRELLIS 2 (Microsoft)',   note: 'PBR mesh, 1–3 min' },
    'tencent/hunyuan-3d-3.1':   { label: 'Hunyuan 3D 3.1',          note: 'high detail, prompt-aware' },
    'prunaai/hunyuan3d-2':      { label: 'Hunyuan3D-2 Fast (Pruna)', note: 'quick preview' },
    'firtoz/trellis':           { label: 'TRELLIS 1',               note: 'fast, < 1 min' },
    'hyper3d/rodin':            { label: 'Rodin Gen-2',             note: 'sculpt-level detail' },
};

export class ImageTo3DNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node imageto3d-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        const modelOptions = Object.entries(IMAGE_TO_3D_MODELS)
            .map(([id, m]) => `<option value="${id}">${m.label}</option>`).join('');

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Image → 3D', 'i-cube')}
            <div class="node-content">
                <div class="video-mode-row">
                    <svg class="icon"><use href="#i-image"/></svg>
                    <span class="to3d-mode-label">Connect an image</span>
                </div>
                <select class="model-select to3d-model-select">${modelOptions}</select>
                <div class="to3d-note"></div>
                <input class="to3d-prompt" type="text" placeholder="Optional hint (e.g. 'a wooden chair, clean backside')" spellcheck="false">
                <div class="prompt-row-2col">
                    <select class="resolution-select to3d-quality-select" title="Texture size / face count">
                        <option value="standard">Standard quality</option>
                        <option value="high" selected>High quality</option>
                    </select>
                    <label class="video-audio-toggle to3d-seed-wrap" title="Fixed seed for reproducible results">
                        <span>Seed</span>
                        <input class="to3d-seed" type="number" min="0" max="2147483647" placeholder="random">
                    </label>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <div class="model-indicator">TRELLIS 2</div>
                <button class="node-btn generate-btn" disabled>Generate 3D</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'imageto3d',
            element: nodeEl,
            data: {
                model: 'fishwowater/trellis2',
                prompt: '',
                quality: 'high',
                seed: null,
                connectedImages: []
            },
            position: { x, y }
        };

        const modelSel  = nodeEl.querySelector('.to3d-model-select');
        const noteEl    = nodeEl.querySelector('.to3d-note');
        const promptIn  = nodeEl.querySelector('.to3d-prompt');
        const qualSel   = nodeEl.querySelector('.to3d-quality-select');
        const seedIn    = nodeEl.querySelector('.to3d-seed');

        const syncNote = () => {
            noteEl.textContent = IMAGE_TO_3D_MODELS[node.data.model]?.note || '';
        };

        node.updateModeLabel = () => {
            const n = (node.data.connectedImages || []).length;
            const lbl = nodeEl.querySelector('.to3d-mode-label');
            lbl.textContent = n === 0 ? 'Connect an image'
                : n === 1 ? 'Input 1 → 3D model'
                : `Input 1 → 3D model (${n - 1} extra ignored)`;
        };

        modelSel.addEventListener('change', (e) => {
            node.data.model = e.target.value;
            syncNote();
            callbacks.updateGenerateButton(node);
        });
        promptIn.addEventListener('input', (e) => { node.data.prompt = e.target.value; });
        promptIn.addEventListener('keydown', (e) => e.stopPropagation());
        qualSel.addEventListener('change', (e) => { node.data.quality = e.target.value; });
        seedIn.addEventListener('input', (e) => {
            node.data.seed = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0);
        });
        seedIn.addEventListener('keydown', (e) => e.stopPropagation());
        nodeEl.querySelector('.to3d-seed-wrap').addEventListener('pointerdown', (e) => e.stopPropagation());

        node.syncSettingsUI = () => {
            modelSel.value = IMAGE_TO_3D_MODELS[node.data.model] ? node.data.model : 'fishwowater/trellis2';
            node.data.model = modelSel.value;
            promptIn.value = node.data.prompt || '';
            qualSel.value = node.data.quality || 'high';
            seedIn.value = node.data.seed ?? '';
            syncNote();
            node.updateModeLabel();
        };
        syncNote();
        node.updateModeLabel();

        nodeEl.querySelector('.generate-btn').addEventListener('click', () => callbacks.generateImage(node));
        nodeEl.querySelector('.node-close').addEventListener('click', () => callbacks.removeNode(nodeId));
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });
        // Resize handle — every node type is freely resizable
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
