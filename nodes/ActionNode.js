import { NodeBase } from './NodeBase.js';

export class ActionNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node action-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Action Preset', 'i-zap')}
            <div class="node-content">
                <select class="action-select">
                    <option value="">Select an action...</option>
                    <option value="colorize this image">Colorize this image</option>
                    <option value="make it a night scene">Make it a night scene</option>
                    <option value="make it a day scene">Make it a day scene</option>
                    <option value="add vintage filter">Add vintage filter</option>
                    <option value="make it black and white">Make it black and white</option>
                    <option value="add warm tones">Add warm tones</option>
                    <option value="add cool tones">Add cool tones</option>
                    <option value="increase contrast">Increase contrast</option>
                    <option value="add dramatic lighting">Add dramatic lighting</option>
                    <option value="make it look like a painting">Make it look like a painting</option>
                    <option value="add snow">Add snow</option>
                    <option value="add rain">Add rain</option>
                    <option value="make it autumn">Make it autumn</option>
                    <option value="make it spring">Make it spring</option>
                </select>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <button class="node-btn generate-btn" disabled>Generate Image</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'action',
            element: nodeEl,
            data: { action: '', connectedImages: [] },
            position: { x, y }
        };

        // Select handling
        const select = nodeEl.querySelector('.action-select');
        select.addEventListener('change', (e) => {
            node.data.action = e.target.value;
            callbacks.updateGenerateButton(node);
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
