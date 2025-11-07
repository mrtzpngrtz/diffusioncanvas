import { NodeBase } from './NodeBase.js';

export class Veo3Node extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node veo3-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Veo 3.1 Video')}
            <div class="node-content">
                <textarea placeholder="Describe the video you want to generate..."></textarea>
                
                <div class="veo-settings">
                    <label class="veo-label">Video Duration:</label>
                    <select class="duration-select">
                        <option value="5">5 seconds</option>
                        <option value="8" selected>8 seconds</option>
                        <option value="10">10 seconds</option>
                    </select>
                    
                    <label class="veo-label">Aspect Ratio:</label>
                    <select class="aspect-ratio-select">
                        <option value="16:9" selected>16:9 (Landscape)</option>
                        <option value="9:16">9:16 (Portrait)</option>
                        <option value="1:1">1:1 (Square)</option>
                    </select>
                </div>
                
                <div class="reference-frames">
                    <div class="frame-info">
                        <span class="info-icon">ℹ</span>
                        <span class="info-text">Connect 1-3 images for frame guidance</span>
                    </div>
                    <div class="frame-indicators">
                        <div class="frame-slot" data-frame="first">
                            <span class="frame-label">First Frame</span>
                            <span class="frame-status">○</span>
                        </div>
                        <div class="frame-slot" data-frame="middle">
                            <span class="frame-label">Middle Frame</span>
                            <span class="frame-status">○</span>
                        </div>
                        <div class="frame-slot" data-frame="last">
                            <span class="frame-label">Last Frame</span>
                            <span class="frame-status">○</span>
                        </div>
                    </div>
                </div>
                
                <div class="prompt-actions">
                    <button class="icon-btn node-clone" title="Clone Node">⎘</button>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
            <div class="node-actions">
                <div class="model-indicator">Veo 3.1</div>
                <button class="node-btn generate-btn" disabled>Generate Video</button>
            </div>
        `;

        const node = {
            id: nodeId,
            type: 'veo3',
            element: nodeEl,
            data: { 
                prompt: '', 
                duration: 8,
                aspectRatio: '16:9',
                connectedImages: [],
                frameAssignments: {
                    first: null,
                    middle: null,
                    last: null
                }
            },
            position: { x, y }
        };

        // Textarea handling
        const textarea = nodeEl.querySelector('textarea');
        textarea.addEventListener('input', (e) => {
            node.data.prompt = e.target.value;
            callbacks.updateGenerateButton(node);
        });

        // Duration select
        const durationSelect = nodeEl.querySelector('.duration-select');
        durationSelect.addEventListener('change', (e) => {
            node.data.duration = parseInt(e.target.value);
        });

        // Aspect ratio select
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
        generateBtn.addEventListener('click', () => callbacks.generateVideo(node));

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

    // Update frame indicators based on connected images
    updateFrameIndicators(node) {
        const frameSlots = node.element.querySelectorAll('.frame-slot');
        
        frameSlots.forEach(slot => {
            const frameType = slot.dataset.frame;
            const status = slot.querySelector('.frame-status');
            
            if (node.data.frameAssignments[frameType]) {
                status.textContent = '●';
                status.style.color = '#27ae60';
                slot.classList.add('connected');
            } else {
                status.textContent = '○';
                status.style.color = '#888';
                slot.classList.remove('connected');
            }
        });
    }

    // Assign images to frame slots based on connection order
    assignFrames(node) {
        const images = node.data.connectedImages;
        
        // Reset assignments
        node.data.frameAssignments = {
            first: null,
            middle: null,
            last: null
        };
        
        // Assign based on number of connected images
        if (images.length === 1) {
            node.data.frameAssignments.first = images[0];
        } else if (images.length === 2) {
            node.data.frameAssignments.first = images[0];
            node.data.frameAssignments.last = images[1];
        } else if (images.length >= 3) {
            node.data.frameAssignments.first = images[0];
            node.data.frameAssignments.middle = images[1];
            node.data.frameAssignments.last = images[2];
        }
        
        this.updateFrameIndicators(node);
    }
}
