import { NodeBase } from './NodeBase.js';

// Format Changer — re-frames a connected image to a new aspect ratio using an
// image-edit model. The prompt is composed from the target format plus the
// selected "helper" instructions; it stays editable.

export const FORMATS = [
    { ratio: '1:1',  label: 'Square' },
    { ratio: '4:5',  label: 'Portrait post' },
    { ratio: '5:4',  label: 'Landscape post' },
    { ratio: '3:4',  label: 'Portrait' },
    { ratio: '4:3',  label: 'Landscape' },
    { ratio: '2:3',  label: 'Poster' },
    { ratio: '3:2',  label: 'Photo' },
    { ratio: '9:16', label: 'Story / Reel' },
    { ratio: '16:9', label: 'Widescreen' },
    { ratio: '21:9', label: 'Cinematic' },
];

// Optional instructions that help the model keep the picture intact
export const FORMAT_OPTIONS = [
    { key: 'outpaint',  label: 'Extend scene (outpaint)',   text: 'Extend the scene naturally beyond the original borders instead of cropping: continue backgrounds, surfaces, textures and lighting seamlessly.' },
    { key: 'subject',   label: 'Keep subject uncropped',    text: 'Keep the main subject fully visible and well placed; never cut off faces, bodies, products or key objects.' },
    { key: 'text',      label: 'Preserve text & logos',     text: 'Reproduce any text, logos and graphic elements exactly, with correct spelling and placement.' },
    { key: 'style',     label: 'Match style & lighting',    text: 'Match the original style, color grading, lighting direction, perspective and level of detail.' },
    { key: 'noadd',     label: 'Add nothing new',           text: 'Do not add new objects, people or text that were not in the original image.' },
];

export function buildFormatPrompt(ratio, options) {
    const fmt = FORMATS.find(f => f.ratio === ratio);
    const head = `Change this image's format to ${ratio}${fmt ? ` (${fmt.label.toLowerCase()})` : ''}. Preserve all relevant information: keep the subject, composition, colors, style and details exactly as they are.`;
    const extras = FORMAT_OPTIONS.filter(o => options?.[o.key]).map(o => o.text);
    return [head, ...extras].join(' ');
}

const DEFAULT_OPTIONS = { outpaint: true, subject: true, text: true, style: true, noadd: false };

export class FormatNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node prompt-node format-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Format Changer', 'i-frame')}
            <div class="node-content">
                <select class="aspect-ratio-select format-target-select">
                    ${FORMATS.map(f => `<option value="${f.ratio}">${f.ratio} — ${f.label}</option>`).join('')}
                </select>
                <select class="model-select format-model-select">
                    <option value="gemini-3.1-flash-image">Nano Banana Flash</option>
                    <option value="gemini-3-pro-image">Nano Banana Pro</option>
                    <option value="gemini-2.5-flash-image">Nano Banana</option>
                    <option value="gpt-image-2-2026-04-21">GPT Image 2</option>
                    <option value="flux-2-pro-preview">FLUX.2 Pro</option>
                    <option value="flux-2-flex">FLUX.2 Flex</option>
                    <option value="flux-2-klein-9b-preview">FLUX.2 Klein</option>
                    <option value="flux-2-max">FLUX.2 Max</option>
                </select>
                <div class="format-options">
                    ${FORMAT_OPTIONS.map(o => `
                        <label class="format-option" title="${o.text}">
                            <input type="checkbox" data-key="${o.key}">
                            <span>${o.label}</span>
                        </label>`).join('')}
                </div>
                <div class="prompt-meta">
                    <span class="prompt-char-count">Prompt</span>
                    <button class="icon-btn format-reset-btn" title="Reset prompt to template"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
                <textarea class="format-prompt" spellcheck="false"></textarea>
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
                <button class="node-btn generate-btn" disabled>Change Format</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'format',
            element: nodeEl,
            data: {
                targetFormat: '1:1',
                formatOptions: { ...DEFAULT_OPTIONS },
                prompt: '',
                promptEdited: false,
                model: 'gemini-3.1-flash-image',
                aspectRatio: '1:1',
                resolution: 'hd',
                outputFormat: 'jpg',
                connectedImages: []
            },
            position: { x, y }
        };

        const targetSel = nodeEl.querySelector('.format-target-select');
        const modelSel  = nodeEl.querySelector('.format-model-select');
        const textarea  = nodeEl.querySelector('.format-prompt');
        const checks    = nodeEl.querySelectorAll('.format-option input');
        const resSel    = nodeEl.querySelector('.resolution-select');
        const fmtSel    = nodeEl.querySelector('.output-format-select');

        // Regenerate the prompt from the template unless the user has edited it
        const composePrompt = (force = false) => {
            if (node.data.promptEdited && !force) return;
            node.data.prompt = buildFormatPrompt(node.data.targetFormat, node.data.formatOptions);
            node.data.promptEdited = false;
            textarea.value = node.data.prompt;
            callbacks.updateGenerateButton(node);
        };

        targetSel.addEventListener('change', (e) => {
            node.data.targetFormat = e.target.value;
            node.data.aspectRatio  = e.target.value; // drives the generation ratio server-side
            composePrompt();
        });

        modelSel.addEventListener('change', (e) => {
            node.data.model = e.target.value;
            callbacks.updateGenerateButton(node);
        });

        checks.forEach(cb => {
            cb.addEventListener('change', (e) => {
                node.data.formatOptions[e.target.dataset.key] = e.target.checked;
                composePrompt();
            });
        });
        nodeEl.querySelector('.format-options').addEventListener('pointerdown', (e) => e.stopPropagation());

        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            node.data.promptEdited = true;
            callbacks.updateGenerateButton(node);
        });

        nodeEl.querySelector('.format-reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            composePrompt(true);
        });

        resSel.addEventListener('change', (e) => { node.data.resolution = e.target.value; });
        fmtSel.addEventListener('change', (e) => { node.data.outputFormat = e.target.value; });

        // Called by NodeManager after Object.assign restores saved data
        node.syncSettingsUI = () => {
            node.data.formatOptions = { ...DEFAULT_OPTIONS, ...(node.data.formatOptions || {}) };
            targetSel.value = FORMATS.some(f => f.ratio === node.data.targetFormat) ? node.data.targetFormat : '1:1';
            node.data.targetFormat = targetSel.value;
            node.data.aspectRatio  = targetSel.value;
            if ([...modelSel.options].some(o => o.value === node.data.model)) modelSel.value = node.data.model;
            else node.data.model = modelSel.value;
            checks.forEach(cb => { cb.checked = !!node.data.formatOptions[cb.dataset.key]; });
            resSel.value = node.data.resolution || 'hd';
            fmtSel.value = node.data.outputFormat || 'jpg';
            if (node.data.prompt) textarea.value = node.data.prompt;
            else composePrompt(true);
        };

        checks.forEach(cb => { cb.checked = !!node.data.formatOptions[cb.dataset.key]; });
        composePrompt(true);

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
