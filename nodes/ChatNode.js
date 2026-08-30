import { NodeBase } from './NodeBase.js';

// LLM chat node (text only). Connected images are attached to the message.
// Any assistant reply can be turned into a Prompt node — with the same
// images wired in — so the result can be generated straight away.

export const CHAT_MODELS = {
    'anthropic/claude-sonnet-5': { label: 'Claude Sonnet 5' },
    'anthropic/claude-opus-5':   { label: 'Claude Opus 5' },
    'google/gemini-3.7-flash':   { label: 'Gemini 3.7 Flash' },
};

export const CHAT_SYSTEM_BASE =
    'You are an assistant inside Diffusion Canvas, a node-based image, video and 3D generation tool. ' +
    'The user may attach images (the node\'s inputs). Be concise and practical.';

export const CHAT_SYSTEM_PROMPT_MODE =
    ' When the user asks for a prompt, reply with ONLY the final prompt text for an image-editing model: ' +
    'no title, no quotes, no explanation, no markdown. Describe the desired result concretely — subject, ' +
    'the changes to make, style, lighting, composition, what must stay unchanged. Refer to an attached image as "this image".';

export class ChatNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node prompt-node chat-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '360px';

        const modelOptions = Object.entries(CHAT_MODELS)
            .map(([id, m]) => `<option value="${id}">${m.label}</option>`).join('');

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Assistant', 'i-chat')}
            <div class="node-content">
                <div class="chat-log"></div>
                <div class="chat-attach">
                    <svg class="icon"><use href="#i-image"/></svg>
                    <span class="chat-attach-label">No image attached — connect one</span>
                </div>
                <label class="chat-mode">
                    <input type="checkbox" class="chat-mode-check" checked>
                    <span>Prompt mode — answer with the prompt text only</span>
                </label>
                <textarea class="chat-input" placeholder="e.g. write a prompt that turns this image into a watercolor poster…" spellcheck="false"></textarea>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <select class="model-select chat-model-select model-indicator-select" title="Model">${modelOptions}</select>
                <button class="node-btn generate-btn" disabled>Send</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'chat',
            element: nodeEl,
            data: {
                prompt: '',                 // current input
                history: [],                // [{ role: 'user'|'assistant', text, images: n }]
                model: 'anthropic/claude-sonnet-5',
                promptMode: true,
                connectedImages: [],
                connectedPrompts: []
            },
            position: { x, y }
        };

        const log      = nodeEl.querySelector('.chat-log');
        const input    = nodeEl.querySelector('.chat-input');
        const modeChk  = nodeEl.querySelector('.chat-mode-check');
        const modelSel = nodeEl.querySelector('.chat-model-select');
        const attachEl = nodeEl.querySelector('.chat-attach-label');

        const renderLog = () => {
            log.innerHTML = '';
            if (!node.data.history.length) {
                log.innerHTML = '<div class="chat-empty">Ask for a prompt, a description, ideas — replies can become Prompt nodes.</div>';
                return;
            }
            node.data.history.forEach((m, i) => {
                const el = document.createElement('div');
                el.className = `chat-msg chat-${m.role}`;
                const text = document.createElement('div');
                text.className = 'chat-msg-text';
                text.textContent = m.text;
                el.appendChild(text);
                if (m.role === 'user' && m.images) {
                    const tag = document.createElement('div');
                    tag.className = 'chat-msg-tag';
                    tag.textContent = `${m.images} image${m.images > 1 ? 's' : ''} attached`;
                    el.appendChild(tag);
                }
                if (m.role === 'assistant') {
                    const bar = document.createElement('div');
                    bar.className = 'chat-msg-actions';
                    bar.innerHTML = `
                        <button class="chat-to-prompt" title="Create a Prompt node with this text and the attached images"><svg class="icon"><use href="#i-chat"/></svg>→ Prompt Node</button>
                        <button class="icon-btn chat-copy" title="Copy"><svg class="icon"><use href="#i-copy"/></svg></button>
                        <button class="icon-btn chat-del" title="Remove from history"><svg class="icon"><use href="#i-x"/></svg></button>
                    `;
                    bar.querySelector('.chat-to-prompt').addEventListener('click', (e) => {
                        e.stopPropagation();
                        callbacks.promptFromChat?.(node, m.text);
                    });
                    bar.querySelector('.chat-copy').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const btn = e.currentTarget;
                        navigator.clipboard.writeText(m.text).then(() => {
                            btn.classList.add('done');
                            setTimeout(() => btn.classList.remove('done'), 1200);
                        });
                    });
                    bar.querySelector('.chat-del').addEventListener('click', (e) => {
                        e.stopPropagation();
                        // remove this reply and the user turn before it
                        const start = node.data.history[i - 1]?.role === 'user' ? i - 1 : i;
                        node.data.history.splice(start, i - start + 1);
                        renderLog();
                    });
                    el.appendChild(bar);
                }
                log.appendChild(el);
            });
            log.scrollTop = log.scrollHeight;
        };

        node.updateModeLabel = () => {
            const n = (node.data.connectedImages || []).filter(x => x.data.imageData).length;
            attachEl.textContent = n === 0 ? 'No image attached — connect one'
                : `${n} image${n > 1 ? 's' : ''} attached from inputs`;
            nodeEl.querySelector('.chat-attach').classList.toggle('has', n > 0);
        };

        node.appendMessage = (role, text, images = 0) => {
            node.data.history.push({ role, text, images });
            renderLog();
        };

        node.systemPrompt = () => CHAT_SYSTEM_BASE + (node.data.promptMode ? CHAT_SYSTEM_PROMPT_MODE : '');

        node.clearInput = () => { input.value = ''; node.data.prompt = ''; callbacks.updateGenerateButton(node); };

        input.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            callbacks.updateGenerateButton(node);
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (node.data.prompt.trim()) callbacks.generateImage(node);
            }
        });
        modeChk.addEventListener('change', (e) => { node.data.promptMode = e.target.checked; });
        nodeEl.querySelector('.chat-mode').addEventListener('pointerdown', (e) => e.stopPropagation());
        modelSel.addEventListener('change', (e) => { node.data.model = e.target.value; callbacks.updateGenerateButton(node); });
        log.addEventListener('pointerdown', (e) => { if (e.target.closest('.chat-msg-text')) e.stopPropagation(); });
        log.addEventListener('wheel', (e) => e.stopPropagation());

        node.syncSettingsUI = () => {
            modelSel.value = CHAT_MODELS[node.data.model] ? node.data.model : 'anthropic/claude-sonnet-5';
            node.data.model = modelSel.value;
            modeChk.checked = node.data.promptMode !== false;
            input.value = node.data.prompt || '';
            node.data.history = Array.isArray(node.data.history) ? node.data.history : [];
            renderLog();
            node.updateModeLabel();
        };
        renderLog();
        node.updateModeLabel();

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
