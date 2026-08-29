import { NodeBase } from './NodeBase.js';

export class ImageNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node image-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Image Input', 'i-image')}
            <button class="clear-button" style="display: none;">Clear</button>
            <div class="node-content">
                <div class="drop-zone">
                    <p>Drop image here or click to upload</p>
                    <input type="file" accept="image/*" style="display: none;">
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, false, true)}
        `;

        const node = {
            id: nodeId,
            type: 'image',
            element: nodeEl,
            data: { image: null, imageData: null },
            position: { x, y }
        };

        // Handle file upload — shared wiring for the initial dropzone and any
        // rebuilt one (after Clear)
        const wireDropZone = (dropZone) => {
            const fileInput = dropZone.querySelector('input[type="file"]');

            dropZone.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file && file.type.startsWith('image/')) {
                    callbacks.handleImageFile(file, node);
                }
            });

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    callbacks.handleImageFile(file, node);
                }
            });
        };

        wireDropZone(nodeEl.querySelector('.drop-zone'));

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Clear button — rebuilds the dropzone (the original was removed when
        // the image loaded and node-content was cleared)
        const clearButton = nodeEl.querySelector('.clear-button');
        clearButton.addEventListener('click', () => {
            node.data.image = null;
            node.data.imageData = null;
            const content = nodeEl.querySelector('.node-content');
            content.innerHTML = `
                <div class="drop-zone">
                    <p>Drop image here or click to upload</p>
                    <input type="file" accept="image/*" style="display: none;">
                </div>
            `;
            wireDropZone(content.querySelector('.drop-zone'));
            clearButton.style.display = 'none';
        });

        // Connection point
        this.setupConnectionPoint(
            nodeEl.querySelector('.connection-point'), 
            nodeId, 
            callbacks.startConnection
        );

        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
