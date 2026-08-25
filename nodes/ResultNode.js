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
            ${this.createNodeHeader('Generated Result')}
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
            navigator.clipboard.writeText(text).then(() => {
                const btn = e.currentTarget;
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

        wrapper.addEventListener('click', (e) => {
            if (e.target.closest('button, canvas')) return;
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
            <button class="icon-btn" title="View Full Size">⛶</button>
            <button class="icon-btn" title="Download">↓</button>
            <button class="icon-btn icon-btn-std" title="Reset to standard size">⊡</button>
            <button class="icon-btn draw-toggle-btn" title="Draw / Annotate">✏</button>
            <button class="icon-btn node-clone" title="Clone Node">⎘</button>
        `;
        wrapper.appendChild(actionButtons);

        actionButtons.querySelector('.node-clone').addEventListener('click', () =>
            callbacks.cloneNode(node.id)
        );

        const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
        const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
        const stdBtn = actionButtons.querySelector('.icon-btn-std');
        const drawBtn = actionButtons.querySelector('.draw-toggle-btn');

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
            nodeEl.style.width = '400px';
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
