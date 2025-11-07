import { NodeBase } from './NodeBase.js';

export class ResultNode extends NodeBase {
    create(nodeId, x, y, imageUrl, sourcePromptNode, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node result-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        const img = document.createElement('img');
        img.src = imageUrl;
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
                imageWidth: 250,
                sourcePromptNode: sourcePromptNode
            },
            position: { x, y }
        };

        const content = nodeEl.querySelector('.node-content');
        const wrapper = document.createElement('div');
        wrapper.className = 'image-wrapper';
        img.style.width = `${node.data.imageWidth}px`;
        wrapper.appendChild(img);
        
        content.appendChild(wrapper);
        
        // Add scale indicator
        const scaleIndicator = document.createElement('div');
        scaleIndicator.className = 'scale-indicator';
        scaleIndicator.textContent = `Loading...`;
        content.appendChild(scaleIndicator);

        img.onload = () => {
            node.data.originalWidth = img.naturalWidth;
            node.data.originalHeight = img.naturalHeight;
            scaleIndicator.textContent = `${node.data.originalWidth} x ${node.data.originalHeight}px`;
        };
        
        // Add action buttons
        const actionButtons = document.createElement('div');
        actionButtons.className = 'image-actions';
        actionButtons.innerHTML = `
            <button class="icon-btn" title="View Full Size">⛶</button>
            <button class="icon-btn" title="Download Image">↓</button>
            <button class="icon-btn node-clone" title="Clone Node">⎘</button>
        `;
        content.appendChild(actionButtons);
        
        actionButtons.querySelector('.node-clone').addEventListener('click', () => 
            callbacks.cloneNode(node.id)
        );
        
        const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
        const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
        
        lightboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.openLightbox(node.data.imageData);
        });
        
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.downloadImage(node.data.imageData, 'generated-result.png');
        });

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
