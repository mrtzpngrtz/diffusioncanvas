import { NodeBase } from './NodeBase.js';

export class ResultNode extends NodeBase {
    create(nodeId, x, y, imageUrl, sourcePromptNode, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node result-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '400px';

        const img = document.createElement('img');
        if (imageUrl) img.src = imageUrl;
        img.addEventListener('dragstart', (e) => e.preventDefault());

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Generated Result', 'i-sparkle')}
            <div class="node-content"></div>
            ${this.createConnectionPoints(nodeId, true, true)}
        `;

        const node = {
            id: nodeId,
            type: 'result',
            element: nodeEl,
            data: {
                image: img,
                imageData: imageUrl,
                imageWidth: null, // CSS controls width: 100%
                sourcePromptNode: sourcePromptNode
            },
            position: { x, y }
        };

        const content = nodeEl.querySelector('.node-content');
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper';
        wrapper.appendChild(img);

        // Scale indicator as hover overlay inside wrapper
        const scaleIndicator = document.createElement('div');
        scaleIndicator.className = 'scale-indicator';
        scaleIndicator.textContent = '…';
        wrapper.appendChild(scaleIndicator);

        const metaEl = document.createElement('div');
        metaEl.className = 'result-meta';
        metaEl.innerHTML = `
            <div class="result-meta-prompt"></div>
            <div class="result-meta-model"></div>
            <button class="result-meta-copy" title="Copy prompt">copy</button>
        `;
        wrapper.appendChild(metaEl);
        content.appendChild(wrapper);

        metaEl.querySelector('.result-meta-copy').addEventListener('click', (e) => {
            e.stopPropagation();
            const text = node.data.prompt || '';
            if (!text) return;
            // capture before the async boundary — currentTarget is null after dispatch
            const btn = e.currentTarget;
            navigator.clipboard.writeText(text).then(() => {
                btn.textContent = 'copied';
                setTimeout(() => { btn.textContent = 'copy'; }, 1500);
            });
        });

        node.updateMeta = () => {
            const p = node.data.prompt || '';
            const m = node.data.model || '';
            metaEl.querySelector('.result-meta-prompt').textContent = p;
            metaEl.querySelector('.result-meta-model').textContent = m;
            metaEl.classList.toggle('result-meta-has-data', !!(p || m));
        };

        // A node drag ends in a click on the wrapper — only treat it as a tap when
        // the pointer stayed put, otherwise moving the node flips the prompt overlay on.
        let tapX = 0, tapY = 0;
        wrapper.addEventListener('pointerdown', (e) => { tapX = e.clientX; tapY = e.clientY; });

        wrapper.addEventListener('click', (e) => {
            if (e.target.closest('button, canvas')) return;
            if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > 4) return;
            if (!metaEl.classList.contains('result-meta-has-data')) return;
            metaEl.classList.toggle('result-meta-visible');
        });

        img.onload = () => {
            node.data.originalWidth = img.naturalWidth;
            node.data.originalHeight = img.naturalHeight;
            scaleIndicator.textContent = `${node.data.originalWidth}×${node.data.originalHeight}`;
        };

        // Action buttons as hover overlay at bottom of image
        const actionButtons = document.createElement('div');
        actionButtons.className = 'image-actions';
        actionButtons.innerHTML = `
            <button class="icon-btn star-btn" title="Star"><svg class="icon"><use href="#i-star"/></svg></button>
            <button class="icon-btn lightbox-btn" title="View Full Size"><svg class="icon"><use href="#i-maximize"/></svg></button>
            <button class="icon-btn download-btn" title="Download"><svg class="icon"><use href="#i-download"/></svg></button>
            <button class="icon-btn icon-btn-std" title="Toggle size: standard / large"><svg class="icon"><use href="#i-fit"/></svg></button>
            <button class="icon-btn draw-toggle-btn" title="Draw / Annotate"><svg class="icon"><use href="#i-pencil"/></svg></button>
            <button class="icon-btn node-clone" title="Clone Node"><svg class="icon"><use href="#i-copy"/></svg></button>
        `;
        wrapper.appendChild(actionButtons);

        actionButtons.querySelector('.node-clone').addEventListener('click', () =>
            callbacks.cloneNode(node.id)
        );

        const starBtn    = actionButtons.querySelector('.star-btn');
        const lightboxBtn = actionButtons.querySelector('.lightbox-btn');
        const downloadBtn = actionButtons.querySelector('.download-btn');
        const stdBtn = actionButtons.querySelector('.icon-btn-std');
        const drawBtn = actionButtons.querySelector('.draw-toggle-btn');

        starBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.starred = !node.data.starred;
            starBtn.classList.toggle('starred', node.data.starred);
            node.element.classList.toggle('starred', node.data.starred);
        });

        lightboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.openLightbox(node.data.imageData);
        });

        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.downloadImage(node.data.imageData, 'generated-result.png', {
                prompt: node.data.prompt,
                model: node.data.model
            });
        });

        stdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const w = nodeEl.offsetWidth;
            nodeEl.style.width = Math.abs(w - 400) < 4 ? '640px' : '400px';
        });

        drawBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const on = drawBtn.classList.toggle('active');
            if (node._drawToggle) node._drawToggle(on);
        });

        // Set up draw overlay once image dimensions are known.
        // Always defer (even if img is already complete) so createNode's Object.assign
        // can restore node.data (e.g. maskData) before _setupDrawOverlay reads it.
        const initDraw = () => callbacks.setupDraw?.(node, wrapper);
        if (img.complete && img.naturalWidth > 0) {
            setTimeout(initDraw, 0);
        } else {
            img.addEventListener('load', initDraw, { once: true });
        }

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Connection points
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });

        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
