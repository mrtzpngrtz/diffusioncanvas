import { NodeBase } from './NodeBase.js';

// Capability table — mirrors GET https://openrouter.ai/api/v1/videos/models
// (Seedance) and the Gemini Omni Flash Interactions API (Google direct).
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'];

export const VIDEO_MODELS = {
    'bytedance/seedance-2.0': {
        label: 'Seedance 2.0', provider: 'openrouter',
        resolutions: ['480p', '720p', '1080p', '4K'],
        ratios: SEEDANCE_RATIOS, durations: range(4, 15), audio: true
    },
    'bytedance/seedance-2.0-fast': {
        label: 'Seedance 2.0 Fast', provider: 'openrouter',
        resolutions: ['480p', '720p'],
        ratios: SEEDANCE_RATIOS, durations: range(4, 15), audio: true
    },
    'bytedance/seedance-2.5': {
        label: 'Seedance 2.5', provider: 'openrouter',
        resolutions: ['480p', '720p'],
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durations: range(4, 30), audio: true
    },
    'gemini-omni-1.1-flash': {
        label: 'Gemini Omni Flash', provider: 'google',
        resolutions: ['360p', '720p', '1080p', '4k'],
        ratios: ['16:9', '9:16'], durations: null /* model-inferred (~10 s) */, audio: 'native'
    }
};

export class VideoNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node prompt-node video-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        const modelOptions = Object.entries(VIDEO_MODELS)
            .map(([id, m]) => `<option value="${id}">${m.label}</option>`).join('');

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Video Prompt', 'i-film')}
            <div class="node-content">
                <textarea placeholder="Describe the video…" spellcheck="false"></textarea>
                <div class="prompt-meta">
                    <span class="prompt-char-count">0 chars · 0 words</span>
                    <button class="icon-btn node-clone prompt-clone-btn" title="Clone Node"><svg class="icon"><use href="#i-copy"/></svg></button>
                </div>
                <select class="model-select video-model-select">${modelOptions}</select>
                <select class="resolution-select video-framemode-select" title="How connected images are used">
                    <option value="auto">Frames: auto from inputs</option>
                    <option value="text">Text only — ignore images</option>
                    <option value="first">Image → video (first frame)</option>
                    <option value="both">First + last frame</option>
                </select>
                <div class="video-frames">
                    <div class="video-frame-slot" data-slot="first">
                        <div class="video-frame-thumb"></div>
                        <span class="video-frame-lbl">First frame</span>
                    </div>
                    <button class="icon-btn video-frame-swap" title="Swap first / last"><svg class="icon"><use href="#i-refresh"/></svg></button>
                    <div class="video-frame-slot" data-slot="last">
                        <div class="video-frame-thumb"></div>
                        <span class="video-frame-lbl">Last frame</span>
                    </div>
                </div>
                <div class="video-mode-row">
                    <svg class="icon"><use href="#i-image"/></svg>
                    <span class="video-mode-label">Text → Video</span>
                </div>
                <div class="prompt-row-2col">
                    <select class="resolution-select video-resolution-select"></select>
                    <select class="aspect-ratio-select video-ratio-select"></select>
                </div>
                <div class="prompt-row-2col">
                    <select class="video-duration-select"></select>
                    <label class="video-audio-toggle" title="Generate a soundtrack">
                        <input type="checkbox" class="video-audio-check" checked>
                        <span>Audio</span>
                    </label>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <div class="model-indicator">Seedance 2.0</div>
                <button class="node-btn generate-btn" disabled>Generate Video</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'video',
            element: nodeEl,
            data: {
                prompt: '', model: 'bytedance/seedance-2.0',
                resolution: '720p', aspectRatio: '16:9', duration: 5, audio: true,
                frameMode: 'auto', swapFrames: false,
                connectedImages: []
            },
            position: { x, y }
        };

        const textarea   = nodeEl.querySelector('textarea');
        const charCount  = nodeEl.querySelector('.prompt-char-count');
        const modelSel   = nodeEl.querySelector('.video-model-select');
        const resSel     = nodeEl.querySelector('.video-resolution-select');
        const ratioSel   = nodeEl.querySelector('.video-ratio-select');
        const durSel     = nodeEl.querySelector('.video-duration-select');
        const audioWrap  = nodeEl.querySelector('.video-audio-toggle');
        const audioCheck = nodeEl.querySelector('.video-audio-check');

        const fill = (sel, values, current, fmt = (v) => v) => {
            sel.innerHTML = values.map(v => `<option value="${v}">${fmt(v)}</option>`).join('');
            sel.value = values.includes(current) ? current : values[0];
            return sel.value;
        };

        // Rebuild the settings selects from the model's capability table and
        // clamp the stored values into the supported range.
        const syncCaps = () => {
            const caps = VIDEO_MODELS[node.data.model] || VIDEO_MODELS['bytedance/seedance-2.0'];
            node.data.resolution  = fill(resSel, caps.resolutions, node.data.resolution);
            node.data.aspectRatio = fill(ratioSel, caps.ratios, node.data.aspectRatio);
            if (caps.durations) {
                durSel.disabled = false;
                const d = fill(durSel, caps.durations, Number(node.data.duration), v => `${v} s`);
                node.data.duration = Number(d);
            } else {
                durSel.innerHTML = '<option value="">Auto length</option>';
                durSel.disabled = true;
                node.data.duration = null;
            }
            if (caps.audio === true) {
                audioWrap.classList.remove('native');
                audioCheck.disabled = false;
                audioCheck.checked = node.data.audio !== false;
            } else {
                audioWrap.classList.add('native');
                audioCheck.disabled = true;
                audioCheck.checked = true;
                node.data.audio = true;
            }
        };

        // ── Frames ──────────────────────────────────────────────────────
        const frameModeSel = nodeEl.querySelector('.video-framemode-select');
        const framesEl     = nodeEl.querySelector('.video-frames');
        const thumbFirst   = nodeEl.querySelector('.video-frame-slot[data-slot="first"] .video-frame-thumb');
        const thumbLast    = nodeEl.querySelector('.video-frame-slot[data-slot="last"] .video-frame-thumb');
        const swapBtn      = nodeEl.querySelector('.video-frame-swap');

        // Connected images with pixels, in slot order (optionally swapped)
        const orderedSources = () => {
            const imgs = (node.data.connectedImages || []).filter(n => n.data.imageData);
            if (node.data.swapFrames && imgs.length > 1) [imgs[0], imgs[1]] = [imgs[1], imgs[0]];
            return imgs;
        };

        // Resolve 'auto' against what's connected → 'text' | 'first' | 'both'
        node.effectiveFrameMode = () => {
            const n = orderedSources().length;
            const m = node.data.frameMode || 'auto';
            if (m === 'text') return 'text';
            if (m === 'first') return n >= 1 ? 'first' : 'text';
            if (m === 'both')  return n >= 2 ? 'both' : n === 1 ? 'first' : 'text';
            return n === 0 ? 'text' : n === 1 ? 'first' : 'both';
        };

        // [firstFrameDataUrl | null, lastFrameDataUrl | null] for the API call
        node.getFrames = () => {
            const src = orderedSources();
            const mode = node.effectiveFrameMode();
            return [
                mode === 'text' ? null : (src[0]?.data.imageData || null),
                mode === 'both' ? (src[1]?.data.imageData || null) : null
            ];
        };

        const paintThumb = (el, dataUrl, active) => {
            el.innerHTML = '';
            el.classList.toggle('filled', !!dataUrl);
            el.classList.toggle('inactive', !active);
            if (dataUrl) {
                const img = document.createElement('img');
                img.src = dataUrl;
                img.draggable = false;
                el.appendChild(img);
            }
        };

        node.updateModeLabel = () => {
            const mode = node.effectiveFrameMode();
            const [first, last] = node.getFrames();
            const n = orderedSources().length;
            paintThumb(thumbFirst, first, mode !== 'text');
            paintThumb(thumbLast, last, mode === 'both');
            framesEl.classList.toggle('mode-text', mode === 'text');
            swapBtn.disabled = n < 2;
            const lbl = nodeEl.querySelector('.video-mode-label');
            lbl.textContent = mode === 'text' ? 'Text → Video'
                : mode === 'first' ? 'Image → Video · first frame'
                : 'First + last frame';
            if (n === 0 && (node.data.frameMode === 'first' || node.data.frameMode === 'both')) {
                lbl.textContent += ' · connect image(s)';
            }
        };

        frameModeSel.addEventListener('change', (e) => {
            node.data.frameMode = e.target.value;
            node.updateModeLabel();
            callbacks.updateGenerateButton(node);
        });
        swapBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.swapFrames = !node.data.swapFrames;
            node.updateModeLabel();
        });

        const updateCounter = (text) => {
            const chars = text.length;
            const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
            charCount.textContent = `${chars} chars · ${words} words`;
        };

        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            updateCounter(e.target.value);
            callbacks.updateGenerateButton(node);
        });

        modelSel.addEventListener('change', (e) => {
            node.data.model = e.target.value;
            syncCaps();
            callbacks.updateGenerateButton(node);
        });
        resSel.addEventListener('change',   (e) => { node.data.resolution = e.target.value; });
        ratioSel.addEventListener('change', (e) => { node.data.aspectRatio = e.target.value; });
        durSel.addEventListener('change',   (e) => { node.data.duration = e.target.value ? Number(e.target.value) : null; });
        audioCheck.addEventListener('change', (e) => { node.data.audio = e.target.checked; });
        audioWrap.addEventListener('pointerdown', (e) => e.stopPropagation());

        // Called by NodeManager after Object.assign restores saved settings
        node.syncSettingsUI = () => {
            modelSel.value = VIDEO_MODELS[node.data.model] ? node.data.model : 'bytedance/seedance-2.0';
            node.data.model = modelSel.value;
            syncCaps();
            textarea.value = node.data.prompt || '';
            updateCounter(textarea.value);
            frameModeSel.value = ['auto', 'text', 'first', 'both'].includes(node.data.frameMode) ? node.data.frameMode : 'auto';
            node.updateModeLabel();
        };
        syncCaps();
        node.updateModeLabel();

        nodeEl.querySelector('.prompt-clone-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.cloneNode(node.id);
        });

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
