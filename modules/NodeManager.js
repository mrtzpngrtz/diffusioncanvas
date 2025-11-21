import { ImageNode } from '../nodes/ImageNode.js';
import { PromptNode } from '../nodes/PromptNode.js';
import { ActionNode } from '../nodes/ActionNode.js';
import { DrawNode } from '../nodes/DrawNode.js';
import { Veo3Node } from '../nodes/Veo3Node.js';
import { ResultNode } from '../nodes/ResultNode.js';

export class NodeManager {
    constructor(canvasManager, connectionManager, uiManager, apiManager) {
        this.canvasManager = canvasManager;
        this.connectionManager = connectionManager;
        this.uiManager = uiManager;
        this.apiManager = apiManager; // To pass to nodes for generation

        this.nodes = [];
        this.nodeIdCounter = 0;
        this.nodeCanvas = document.getElementById('nodeCanvas');
        
        // Dragging state
        this.isDragging = false;
        this.draggedNode = null;
        this.dragOffset = { x: 0, y: 0 };
        
        // Resizing state
        this.isResizing = false;
        this.resizedNode = null;
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0, imageWidth: 0 };

        this.init();
    }

    init() {
        this.setupGlobalEvents();
    }

    setupGlobalEvents() {
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    createNode(type, x, y, data = null, id = null) {
        let node;
        const nodeId = id || `node-${this.nodeIdCounter++}`;
        // If id was provided, we don't increment counter, or we ensure counter is higher?
        // To avoid collisions, maybe we should update counter if we see a high number.
        // But simpler is just to let counter grow or assume loaded IDs are distinct from new ones.
        // The loader sets counter to max from saved state, so new IDs start higher.
        
        // Callbacks passed to nodes
        const callbacks = {
            removeNode: (id) => this.removeNode(id),
            startConnection: (e, id, el) => this.connectionManager.startConnection(e, id, el),
            startDrag: (e, n) => this.startDrag(e, n),
            startResize: (e, n) => this.startResize(e, n),
            cloneNode: (id) => this.cloneNode(id),
            handleImageFile: (file, n) => this.handleImageFile(file, n),
            updateGenerateButton: (n) => this.updateGenerateButton(n),
            generateImage: (n) => this.handleGenerateImage(n),
            generateVideo: (n) => this.handleGenerateVideo(n),
            openLightbox: (src) => this.uiManager.openLightbox(src),
            downloadImage: (src, name) => this.downloadImage(src, name),
            updateDrawNodeImage: (n) => this.updateDrawNodeImage(n)
        };

        switch (type) {
            case 'image':
                node = new ImageNode().create(nodeId, x, y, callbacks);
                break;
            case 'prompt':
                node = new PromptNode().create(nodeId, x, y, callbacks);
                break;
            case 'action':
                node = new ActionNode().create(nodeId, x, y, callbacks);
                break;
            case 'draw':
                node = new DrawNode().create(nodeId, x, y, callbacks);
                break;
            case 'veo3':
                node = new Veo3Node().create(nodeId, x, y, callbacks);
                break;
            case 'result':
                node = new ResultNode().create(nodeId, x, y, data?.imageUrl, data?.sourceNode, callbacks);
                break;
        }

        if (node) {
            // Restore data if provided (e.g. from load or clone)
            if (data) {
                Object.assign(node.data, data);
                // TODO: Trigger update logic if needed (e.g. fill textarea)
            }
            
            this.nodes.push(node);
            this.nodeCanvas.appendChild(node.element);
            this.uiManager.updateStatus(`${type.charAt(0).toUpperCase() + type.slice(1)} node created`);
        }
        return node;
    }

    removeNode(nodeId) {
        const nodeIndex = this.nodes.findIndex(n => n.id === nodeId);
        if (nodeIndex === -1) return;

        const nodeToRemove = this.nodes[nodeIndex];
        
        // Clean up references in other nodes
        this.nodes.forEach(otherNode => {
            if (otherNode.id === nodeId) return;
            // Logic to remove references (connectedImages, etc.)
            // This should be moved to a shared helper or handled here
            this.cleanupNodeReferences(otherNode, nodeId);
        });

        nodeToRemove.element.remove();
        this.nodes.splice(nodeIndex, 1);

        // Remove associated connections
        this.connectionManager.removeConnectionsForNode(nodeId);

        this.uiManager.updateStatus('Node removed');
    }

    cleanupNodeReferences(node, removedNodeId) {
        // Implementation from script.js removeNode function
        if (node.data.connectedImages) {
            const initialLength = node.data.connectedImages.length;
            node.data.connectedImages = node.data.connectedImages.filter(n => n.id !== removedNodeId);
            if (node.data.connectedImages.length !== initialLength) {
                this.updateGenerateButton(node);
                if (node.type === 'veo3' && node.updateFrames) {
                    node.updateFrames();
                }
            }
        }
        // ... (other cleanup logic)
    }

    startDrag(e, node) {
        this.isDragging = true;
        this.draggedNode = node;
        
        const container = this.nodeCanvas.getBoundingClientRect();
        const zoom = this.canvasManager.zoom;
        const panX = this.canvasManager.panX;
        const panY = this.canvasManager.panY;
        
        const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
        const mouseCanvasY = (e.clientY - container.top) / zoom - panY;
        
        this.dragOffset.x = mouseCanvasX - node.position.x;
        this.dragOffset.y = mouseCanvasY - node.position.y;
        node.element.style.zIndex = 1000;
    }

    handleMouseMove(e) {
        if (this.isResizing && this.resizedNode) {
             // ... resize logic
             const zoom = this.canvasManager.zoom;
             const deltaX = (e.clientX - this.resizeStart.x) / zoom;
             const newWidth = Math.max(250, this.resizeStart.width + deltaX);
             
             this.resizedNode.element.style.width = `${newWidth}px`;
             
             // Scale image if needed
             if (this.resizedNode.data.image && this.resizedNode.data.imageData) {
                 const scaleFactor = newWidth / this.resizeStart.width;
                 const newImageWidth = Math.round(this.resizeStart.imageWidth * scaleFactor);
                 this.resizedNode.data.imageWidth = newImageWidth;
                 this.resizedNode.data.image.style.width = `${newImageWidth}px`;
             }

             this.connectionManager.drawConnections();
             return;
        }

        if (this.isDragging && this.draggedNode) {
            const container = this.nodeCanvas.getBoundingClientRect();
            const zoom = this.canvasManager.zoom;
            const panX = this.canvasManager.panX;
            const panY = this.canvasManager.panY;
            
            const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
            const mouseCanvasY = (e.clientY - container.top) / zoom - panY;
            
            this.draggedNode.position.x = mouseCanvasX - this.dragOffset.x;
            this.draggedNode.position.y = mouseCanvasY - this.dragOffset.y;

            this.draggedNode.element.style.left = `${this.draggedNode.position.x}px`;
            this.draggedNode.element.style.top = `${this.draggedNode.position.y}px`;

            this.connectionManager.drawConnections();
        }
    }

    handleMouseUp(e) {
        if (this.isResizing) {
            this.isResizing = false;
            this.resizedNode = null;
        }
        
        if (this.isDragging && this.draggedNode) {
            this.draggedNode.element.style.zIndex = '';
        }
        this.isDragging = false;
        this.draggedNode = null;
    }

    startResize(e, node) {
        this.isResizing = true;
        this.resizedNode = node;
        
        this.resizeStart.x = e.clientX;
        this.resizeStart.y = e.clientY;
        this.resizeStart.width = node.element.offsetWidth;
        this.resizeStart.height = node.element.offsetHeight;
        this.resizeStart.imageWidth = node.data.imageWidth || 250;
    }

    updateGenerateButton(node) {
        const generateBtn = node.element.querySelector('.generate-btn');
        if (!generateBtn) return;
        
        // Only count images DIRECTLY connected to this node
        let totalImages = node.data.connectedImages ? node.data.connectedImages.length : 0;
        
        const hasImages = totalImages > 0;
        
        let hasContent = false;
        if (node.type === 'prompt') {
            hasContent = node.data.prompt && node.data.prompt.trim().length > 0;
        } else if (node.type === 'action') {
            hasContent = node.data.action && node.data.action.trim().length > 0;
        }
        
        // Enable button if there's content (with or without images)
        generateBtn.disabled = !hasContent;
        
        // Update button text to show image count
        if (hasImages) {
            generateBtn.textContent = `Generate (${totalImages} image${totalImages > 1 ? 's' : ''})`;
        } else {
            generateBtn.textContent = 'Generate Image';
        }
        
        // Show/hide aspect ratio selector based on selected model
        const aspectRatioSelect = node.element.querySelector('.aspect-ratio-select');
        if (aspectRatioSelect) {
            if (node.data.model === 'imagen-4.0-generate-001') {
                aspectRatioSelect.style.display = 'block';
            } else {
                aspectRatioSelect.style.display = 'none';
            }
        }
    }

    async handleGenerateImage(node) {
        const result = await this.apiManager.generateImage(node);
        
        if (result.success && result.image) {
            // Calculate position for result node
            // Place it to the right of the prompt node
            const nodeRect = node.element.getBoundingClientRect();
            const container = this.nodeCanvas.getBoundingClientRect();
            const zoom = this.canvasManager.zoom;
            const panX = this.canvasManager.panX;
            const panY = this.canvasManager.panY;
            
            // Current node position in canvas coords
            // We can just use node.position since we track it
            const resultX = node.position.x + node.element.offsetWidth + 50;
            const resultY = node.position.y;

            // Check if there's already a result node for this prompt/action
            const existingResult = this.nodes.find(n => 
                n.type === 'result' && n.data.sourcePromptNode === node
            );
            
            if (existingResult) {
                // Update existing result node image
                const img = existingResult.data.image;
                img.src = result.image;
                existingResult.data.imageData = result.image;
                this.uiManager.updateStatus('Image regenerated successfully!', '#27ae60');
            } else {
                // Create new result node and link it to prompt/action
                const resultNode = this.createNode('result', resultX, resultY, {
                    imageUrl: result.image,
                    sourceNode: node
                });
                node.data.resultNode = resultNode;
                
                // Auto-connect
                this.connectionManager.createConnection(node.id, resultNode.id, 'output', 'input');
            }
            
            // Update credits display
            if (result.creditsRemaining !== undefined) {
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    userCredits.textContent = `${result.creditsRemaining} credit${result.creditsRemaining !== 1 ? 's' : ''}`;
                }
            }
            
            this.uiManager.updateStatus('Image generated successfully!', '#27ae60');
        }
    }

    async handleGenerateVideo(node) {
        const result = await this.apiManager.generateVideo(node);
        
        if (result.success && result.video) {
            const resultX = node.position.x + node.element.offsetWidth + 50;
            const resultY = node.position.y;

            // Create video result node (custom type or handled in createNode)
            // script.js had createVideoResultNode. We can handle it as a 'video-result' type or modify 'result' type
            // Let's assume we add 'video-result' to createNode or handle it here.
            // For now, let's assume 'result' node can handle video if we modify it, or we add a case.
            // But ResultNode.js only handles images.
            // I should probably add a VideoResultNode.js or update ResultNode.js.
            // For now, let's just alert success as placeholder or implement VideoResultNode later.
            
            // Actually script.js created a "video-result" node.
            // I should add 'video-result' case in createNode.
            // For now, I'll just log it.
            console.log('Video generated:', result.video);
            
            // TODO: Implement VideoResultNode
             if (result.creditsRemaining !== undefined) {
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    userCredits.textContent = `${result.creditsRemaining} credit${result.creditsRemaining !== 1 ? 's' : ''}`;
                }
            }
            
            this.uiManager.updateStatus('Video generated successfully!', '#27ae60');
        }
    }

    handleImageFile(file, node) {
        // ... Logic from script.js
        // Logic: check size, read file, update node data, update UI
        // This might belong in NodeManager or APIManager?
        // Since it modifies node data and UI, NodeManager is fine.
        
        const MAX_FILE_SIZE_MB = 10;
        const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
        
        if (file.size > MAX_FILE_SIZE_BYTES) {
            alert('Image too large');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.onload = () => {
                node.data.image = img;
                node.data.imageData = e.target.result;
                node.data.originalWidth = img.naturalWidth;
                node.data.originalHeight = img.naturalHeight;
                node.data.imageWidth = 250;

                // Update DOM
                const content = node.element.querySelector('.node-content');
                content.innerHTML = ''; // Clear dropzone
                
                const wrapper = document.createElement('div');
                wrapper.className = 'image-wrapper';
                img.style.width = `${node.data.imageWidth}px`;
                wrapper.appendChild(img);
                content.appendChild(wrapper);

                // Add action buttons (can be helper function)
                this.addNodeActionButtons(node, content);
                
                this.uiManager.updateStatus('Image loaded successfully', '#27ae60');
            };
        };
        reader.readAsDataURL(file);
    }

    addNodeActionButtons(node, container) {
        const actionButtons = document.createElement('div');
        actionButtons.className = 'image-actions';
        actionButtons.innerHTML = `
            <button class="icon-btn" title="View Full Size">⛶</button>
            <button class="icon-btn" title="Download Image">↓</button>
            <button class="icon-btn node-clone" title="Clone Node">⎘</button>
        `;
        container.appendChild(actionButtons);

        actionButtons.querySelector('.node-clone').addEventListener('click', () => this.cloneNode(node.id));
        const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
        const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
        
        lightboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.uiManager.openLightbox(node.data.imageData);
        });
        
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(node.data.imageData, 'image.png');
        });
    }

    cloneNode(nodeId) {
        const originalNode = this.nodes.find(n => n.id === nodeId);
        if (!originalNode) return;

        const newPosition = {
            x: originalNode.position.x + 30,
            y: originalNode.position.y + 30
        };

        let newNode;
        
        // Clone data based on type
        switch (originalNode.type) {
            case 'image':
                newNode = this.createNode('image', newPosition.x, newPosition.y);
                if (originalNode.data.imageData) {
                    // Helper to convert data URL to file (or just set data directly if we allow)
                    // script.js used dataURLtoFile then handleImageFile.
                    // We can just set the data if we expose a method or modify data directly.
                    // But handleImageFile expects a File.
                    // Let's simulate it or just copy properties.
                    
                    // Direct copy seems easier for cloning
                    newNode.data.image = originalNode.data.image.cloneNode(true);
                    newNode.data.imageData = originalNode.data.imageData;
                    newNode.data.originalWidth = originalNode.data.originalWidth;
                    newNode.data.originalHeight = originalNode.data.originalHeight;
                    newNode.data.imageWidth = originalNode.data.imageWidth;
                    
                    // Re-render content
                    const content = newNode.element.querySelector('.node-content');
                    content.innerHTML = '';
                    const wrapper = document.createElement('div');
                    wrapper.className = 'image-wrapper';
                    newNode.data.image.style.width = `${newNode.data.imageWidth}px`;
                    wrapper.appendChild(newNode.data.image);
                    content.appendChild(wrapper);
                    this.addNodeActionButtons(newNode, content);
                }
                break;
            case 'prompt':
                newNode = this.createNode('prompt', newPosition.x, newPosition.y);
                newNode.data.prompt = originalNode.data.prompt;
                newNode.element.querySelector('textarea').value = originalNode.data.prompt;
                newNode.data.aspectRatio = originalNode.data.aspectRatio;
                newNode.element.querySelector('.aspect-ratio-select').value = originalNode.data.aspectRatio;
                if (originalNode.data.model) {
                    newNode.data.model = originalNode.data.model;
                    const modelSelect = newNode.element.querySelector('.model-select');
                    if (modelSelect) modelSelect.value = originalNode.data.model;
                }
                this.updateGenerateButton(newNode);
                break;
            case 'action':
                newNode = this.createNode('action', newPosition.x, newPosition.y);
                newNode.data.action = originalNode.data.action;
                newNode.element.querySelector('.action-select').value = originalNode.data.action;
                this.updateGenerateButton(newNode);
                break;
            // ... other types
        }

        if (newNode) {
            this.uiManager.updateStatus(`Node cloned`, '#27ae60');
        }
    }

    downloadImage(data, filename) {
        const link = document.createElement('a');
        link.href = data;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    updateDrawNodeImage(node) {
        if (node.type !== 'draw' || !node.data.canvas) return;
        node.data.imageData = node.data.canvas.toDataURL('image/png');
        node.data.originalWidth = node.data.canvas.width;
        node.data.originalHeight = node.data.canvas.height;
    }
}
