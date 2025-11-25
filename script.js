import { AuthManager } from './modules/AuthManager.js';
import { UIManager } from './modules/UIManager.js';
import { CanvasManager } from './modules/CanvasManager.js';
import { NodeManager } from './modules/NodeManager.js';
import { ConnectionManager } from './modules/ConnectionManager.js';
import { APIManager } from './modules/APIManager.js';

class App {
    constructor() {
        this.authManager = new AuthManager();
        this.uiManager = new UIManager();
        this.apiManager = new APIManager(this.uiManager);
        
        // Create managers with dependencies
        // CanvasManager needs node/connection managers (passed later via setters or initialized together)
        // We can instantiate them and then link them.
        
        // Circular dependencies handling:
        // NodeManager needs CanvasManager (coords), ConnectionManager (update connections), UIManager, APIManager
        // ConnectionManager needs NodeManager (nodes), CanvasManager (ctx), UIManager
        // CanvasManager needs NodeManager (minimap), ConnectionManager (drawing)
        
        // Let's create them first
        this.connectionManager = new ConnectionManager(null, null, this.uiManager);
        this.canvasManager = new CanvasManager(null, this.connectionManager);
        this.nodeManager = new NodeManager(this.canvasManager, this.connectionManager, this.uiManager, this.apiManager);
        
        // Now link the dependencies
        this.connectionManager.nodeManager = this.nodeManager;
        this.connectionManager.canvasManager = this.canvasManager;
        
        this.canvasManager.nodeManager = this.nodeManager;
        
        // Initialize managers
        this.connectionManager.init();
        this.canvasManager.init();
        this.nodeManager.init();

        this.init();
    }

    init() {
        this.setupToolbar();
        this.setupStorage();
        this.setupContextMenu();
        
        // Start auto-save
        this.startAutoSave();
        
        // Restore auto-save
        this.restoreAutoSavedCanvas();
    }

    setupToolbar() {
        document.getElementById('addImageNode').addEventListener('click', () => this.addNode('image'));
        document.getElementById('addPromptNode').addEventListener('click', () => this.addNode('prompt'));
        document.getElementById('addActionNode').addEventListener('click', () => this.addNode('action'));
        document.getElementById('addDrawNode').addEventListener('click', () => this.addNode('draw'));
        document.getElementById('addVeo3Node').addEventListener('click', () => this.addNode('veo3'));
        
        document.getElementById('clearCanvas').addEventListener('click', () => this.clearCanvas());
        document.getElementById('saveCanvas').addEventListener('click', () => this.saveCanvas());
        document.getElementById('loadCanvas').addEventListener('click', () => this.loadCanvas());
    }

    addNode(type) {
        const center = this.canvasManager.getViewportCenter();
        // Offset based on node size approximation
        let offsetX = -125; 
        let offsetY = -75;
        if (type === 'veo3') {
             offsetX = -160;
             offsetY = -100;
        }
        
        this.nodeManager.createNode(type, center.x + offsetX, center.y + offsetY);
    }

    clearCanvas() {
        if (confirm('Are you sure you want to clear all nodes?')) {
            // Remove all nodes (which removes connections)
            while (this.nodeManager.nodes.length > 0) {
                this.nodeManager.removeNode(this.nodeManager.nodes[0].id);
            }
            // Clear connections just in case
            this.connectionManager.connections = [];
            this.connectionManager.drawConnections();
            this.uiManager.updateStatus('Canvas cleared');
        }
    }

    setupContextMenu() {
        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu) return;

        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const rect = this.canvasManager.container.getBoundingClientRect();
                const zoom = this.canvasManager.zoom;
                const panX = this.canvasManager.panX;
                const panY = this.canvasManager.panY;
                
                // Context menu position is in screen coords
                const screenX = parseInt(contextMenu.style.left || '0');
                const screenY = parseInt(contextMenu.style.top || '0');
                
                const canvasX = (screenX - rect.left) / zoom - panX;
                const canvasY = (screenY - rect.top) / zoom - panY;
                
                let newNode;
                switch(action) {
                    case 'addImage': newNode = this.nodeManager.createNode('image', canvasX, canvasY); break;
                    case 'addPrompt': newNode = this.nodeManager.createNode('prompt', canvasX, canvasY); break;
                    case 'addAction': newNode = this.nodeManager.createNode('action', canvasX, canvasY); break;
                    case 'addDraw': newNode = this.nodeManager.createNode('draw', canvasX, canvasY); break;
                    case 'addVeo3': newNode = this.nodeManager.createNode('veo3', canvasX, canvasY); break;
                }
                
                // Handle connection creation from context menu
                if (contextMenu.dataset.isConnectionMenu === 'true' && newNode && this.connectionManager.connectionStart) {
                     const fromNodeId = this.connectionManager.connectionStart.nodeId;
                     const toNodeId = newNode.id;
                     const fromType = this.connectionManager.connectionStart.type;
                     const toType = fromType === 'output' ? 'input' : 'output';
                     
                     this.connectionManager.createConnection(fromNodeId, toNodeId, fromType, toType);
                     // Reset connection start is handled in ConnectionManager but safe to do here if needed
                     this.connectionManager.connectionStart = null;
                     this.connectionManager.isConnecting = false;
                     this.connectionManager.drawConnections();
                }

                contextMenu.classList.remove('active');
            });
        });
    }

    // Storage methods
    saveCanvas() {
        try {
            const canvasState = this.serializeCanvas();
            const json = JSON.stringify(canvasState, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `diffusion-canvas-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.uiManager.updateStatus('Canvas saved successfully!', '#27ae60');
        } catch (error) {
            console.error('Save error:', error);
            this.uiManager.updateStatus('Failed to save canvas', '#e74c3c');
            alert('Failed to save canvas: ' + error.message);
        }
    }

    loadCanvas() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const canvasState = JSON.parse(text);

                if (this.nodeManager.nodes.length > 0) {
                    if (!confirm('Loading will replace the current canvas. Continue?')) {
                        return;
                    }
                }

                this.clearCanvas();
                await this.deserializeCanvas(canvasState);
                
            } catch (error) {
                console.error('Load error:', error);
                this.uiManager.updateStatus('Failed to load canvas', '#e74c3c');
                alert('Failed to load canvas: ' + error.message);
            }
        });

        fileInput.click();
    }

    setupStorage() {
        // Nothing specific needed here, methods are available
    }

    startAutoSave() {
        setInterval(() => {
            if (this.nodeManager.nodes.length > 0) {
                this.autoSaveCanvas();
            }
        }, 5000);
    }

    autoSaveCanvas() {
        try {
            const canvasState = this.serializeCanvas();
            localStorage.setItem('diffusionCanvas_autoSave', JSON.stringify(canvasState));
            
            // Visual indicator
            const indicator = document.createElement('div');
            indicator.style.cssText = `
                position: fixed; bottom: 20px; right: 20px; background: rgba(39, 174, 96, 0.9);
                color: white; padding: 8px 16px; border-radius: 4px; font-size: 12px;
                z-index: 10000; animation: fadeInOut 2s ease-in-out;
            `;
            indicator.textContent = '✓ Auto-saved';
            document.body.appendChild(indicator);
            setTimeout(() => indicator.remove(), 2000);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.warn('Auto-save disabled: Canvas too large');
            }
        }
    }

    restoreAutoSavedCanvas() {
        try {
            const savedState = localStorage.getItem('diffusionCanvas_autoSave');
            if (!savedState) {
                this.uiManager.updateStatus('Ready - Add nodes to get started');
                return;
            }

            const canvasState = JSON.parse(savedState);
            this.deserializeCanvas(canvasState);
            this.uiManager.updateStatus('Canvas restored from auto-save', '#667eea');
        } catch (error) {
            console.error('Auto-restore error:', error);
        }
    }

    serializeCanvas() {
        return {
            version: '1.0',
            timestamp: new Date().toISOString(),
            zoom: this.canvasManager.zoom,
            panX: this.canvasManager.panX,
            panY: this.canvasManager.panY,
            nodeIdCounter: this.nodeManager.nodeIdCounter,
            nodes: this.nodeManager.nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: {
                    imageData: node.data.imageData,
                    imageWidth: node.data.imageWidth,
                    prompt: node.data.prompt,
                    aspectRatio: node.data.aspectRatio,
                    model: node.data.model,
                    action: node.data.action,
                    connectedImageIds: node.data.connectedImages ? node.data.connectedImages.map(n => n.id) : [],
                    connectedPromptIds: node.data.connectedPrompts ? node.data.connectedPrompts.map(n => n.id) : [],
                    resultNodeId: node.data.resultNode ? node.data.resultNode.id : null,
                    sourcePromptNodeId: node.data.sourcePromptNode ? node.data.sourcePromptNode.id : null
                }
            })),
            connections: this.connectionManager.connections
        };
    }

    async deserializeCanvas(state) {
        if (!state.version || !state.nodes) throw new Error('Invalid format');
        
        this.canvasManager.zoom = state.zoom || 1;
        this.canvasManager.panX = state.panX || 0;
        this.canvasManager.panY = state.panY || 0;
        this.nodeManager.nodeIdCounter = state.nodeIdCounter || 0;
        this.canvasManager.applyZoom();

        // Recreate nodes
        // First pass: Create nodes
        // Second pass: Restore connections/references
        
        const nodeMap = new Map();
        const promises = [];

        for (const nodeData of state.nodes) {
            // Create node using NodeManager but we need to override ID
            // NodeManager increments ID automatically. We should reset counter or manually set ID.
            // createNode returns the node. We can then modify its ID and replace in DOM/Array?
            // Or simpler: just let createNode do it, but pass ID?
            // createNode currently generates ID.
            
            // I'll modify createNode to accept ID? No, it's auto-increment.
            // But I can force the ID.
            
            // Actually, in script.js implementation of load, it recreated nodes and then fixed up IDs.
            // "Remove the node that was auto-created and replace with our data"
            
            // Pass the saved ID to createNode so callbacks are bound correctly
            const tempNode = this.nodeManager.createNode(nodeData.type, nodeData.position.x, nodeData.position.y, nodeData.data, nodeData.id);
            nodeMap.set(nodeData.id, tempNode);
            
            // Handle image loading
            if (nodeData.type === 'image' && nodeData.data.imageData) {
                // Load image async
                const p = new Promise(resolve => {
                    const img = document.createElement('img');
                    img.src = nodeData.data.imageData;
                    img.onload = () => {
                         tempNode.data.image = img;
                         // Update DOM
                         const content = tempNode.element.querySelector('.node-content');
                         content.innerHTML = '';
                         const wrapper = document.createElement('div');
                         wrapper.className = 'image-wrapper';
                         img.style.width = `${tempNode.data.imageWidth}px`;
                         wrapper.appendChild(img);
                         content.appendChild(wrapper);
                         this.nodeManager.addNodeActionButtons(tempNode, content);
                         resolve();
                    };
                    img.onerror = resolve;
                });
                promises.push(p);
            }
             // Result node image loading
             if (nodeData.type === 'result' && nodeData.data.imageData) {
                  // ... similar logic or handled by createNode passing data
                  // createNode for result takes imageUrl.
                  // But createNode uses existing NodeManager logic which expects imageUrl
                  // But we passed data object.
             }
        }

        // Restore links
        for (const nodeData of state.nodes) {
            const node = nodeMap.get(nodeData.id);
            if (!node) continue;
            
            if (nodeData.data.connectedImageIds) {
                node.data.connectedImages = nodeData.data.connectedImageIds.map(id => nodeMap.get(id)).filter(n => n);
            }
            if (nodeData.data.connectedPromptIds) {
                node.data.connectedPrompts = nodeData.data.connectedPromptIds.map(id => nodeMap.get(id)).filter(n => n);
            }
            if (nodeData.data.resultNodeId) {
                node.data.resultNode = nodeMap.get(nodeData.data.resultNodeId);
            }
            if (nodeData.data.sourcePromptNodeId) {
                node.data.sourcePromptNode = nodeMap.get(nodeData.data.sourcePromptNodeId);
            }
            this.nodeManager.updateGenerateButton(node);
        }

        // Restore connections
        this.connectionManager.connections = state.connections || [];
        this.connectionManager.drawConnections();
        
        await Promise.all(promises);
        this.canvasManager.updateMinimap();
    }
}

// Initialize App
window.addEventListener('load', () => {
    new App();
});
