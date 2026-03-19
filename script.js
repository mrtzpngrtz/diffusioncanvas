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

        this.currentBoardId = null;
        this.currentBoardName = null;

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
        
        document.getElementById('clearCanvas').addEventListener('click', () => this.clearCanvas());
        document.getElementById('saveCanvas').addEventListener('click', () => this.saveCanvas());
        document.getElementById('loadCanvas').addEventListener('click', () => this.loadCanvas());

        document.getElementById('saveBoardBtn').addEventListener('click', () => this.saveBoard());
        document.getElementById('openBoardsBtn').addEventListener('click', () => this.toggleBoardsPanel());
        document.getElementById('newBoardBtn').addEventListener('click', () => this.saveBoardAsNew());
        document.getElementById('boardsModalClose').addEventListener('click', () => this.closeBoardsModal());
        document.getElementById('boardsModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeBoardsModal();
        });
    }

    addNode(type) {
        const center = this.canvasManager.getViewportCenter();
        // Offset based on node size approximation
        let offsetX = -125; 
        let offsetY = -75;
        this.nodeManager.createNode(type, center.x + offsetX, center.y + offsetY);
    }

    clearCanvas() {
        if (confirm('Are you sure you want to clear all nodes?')) {
            this._clearCanvasImmediate();
        }
    }

    _clearCanvasImmediate() {
        while (this.nodeManager.nodes.length > 0) {
            this.nodeManager.removeNode(this.nodeManager.nodes[0].id);
        }
        this.connectionManager.connections = [];
        this.connectionManager.drawConnections();
        this.uiManager.updateStatus('Canvas cleared');
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
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            document.body.removeChild(fileInput);
            if (!file) return;

            try {
                const text = await file.text();
                const canvasState = JSON.parse(text);

                if (this.nodeManager.nodes.length > 0) {
                    if (!confirm('Loading will replace the current canvas. Continue?')) return;
                }

                this._clearCanvasImmediate();
                await this.deserializeCanvas(canvasState);
                this.uiManager.updateStatus('Canvas imported', '#27ae60');
            } catch (error) {
                console.error('Load error:', error);
                this.uiManager.updateStatus('Failed to import canvas', '#e74c3c');
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

            // Visual indicator — blueprint style
            const existing = document.getElementById('autosave-indicator');
            if (existing) existing.remove();

            const indicator = document.createElement('div');
            indicator.id = 'autosave-indicator';
            indicator.style.cssText = `
                position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%);
                background: #111; color: #fff;
                padding: 5px 18px; font-size: 8px;
                font-family: 'Roboto Mono', monospace; letter-spacing: 0.14em;
                text-transform: uppercase; z-index: 10000;
                border: 1px solid #111; white-space: nowrap;
                animation: fadeInOut 2s ease-in-out forwards;
            `;
            indicator.textContent = 'AUTOSAVED';
            document.body.appendChild(indicator);
            setTimeout(() => indicator.remove(), 2000);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                // Canvas too large for localStorage — silently skip, server boards still work
                console.warn('Auto-save skipped: canvas too large for localStorage');
            } else {
                console.error('Auto-save error:', error);
            }
        }
    }

    async restoreAutoSavedCanvas() {
        // Try to restore last server board first
        const lastBoardId = localStorage.getItem('diffusionCanvas_lastBoardId');
        if (lastBoardId) {
            try {
                const res = await fetch(`/api/boards/${lastBoardId}`, { credentials: 'include' });
                if (res.ok) {
                    const state = await res.json();
                    const listRes = await fetch('/api/boards', { credentials: 'include' });
                    if (listRes.ok) {
                        const boards = await listRes.json();
                        const meta = boards.find(b => b.id === lastBoardId);
                        if (meta) {
                            this.currentBoardId = lastBoardId;
                            this.currentBoardName = meta.name;
                            this._updateBoardUI();
                        }
                    }
                    await this.deserializeCanvas(state);
                    this.uiManager.updateStatus(`"${this.currentBoardName || 'Board'}" restored`, '#667eea');
                    return;
                }
            } catch (e) {
                console.warn('Could not restore server board, falling back to local save', e);
            }
        }

        // Fall back to localStorage autosave
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

// ── BOARDS ───────────────────────────────────────────────────────────────────

Object.assign(App.prototype, {

    toggleBoardsPanel() {
        const modal = document.getElementById('boardsModal');
        if (!modal) return;
        if (modal.classList.contains('active')) {
            this.closeBoardsModal();
        } else {
            modal.classList.add('active');
            document.getElementById('openBoardsBtn').classList.add('active');
            this._loadBoardsList();
        }
    },

    closeBoardsModal() {
        const modal = document.getElementById('boardsModal');
        if (modal) modal.classList.remove('active');
        document.getElementById('openBoardsBtn').classList.remove('active');
    },

    async _loadBoardsList() {
        const listEl = document.getElementById('boardsModalBody');
        if (!listEl) return;
        listEl.innerHTML = '<div class="boards-empty">Loading...</div>';

        try {
            const res = await fetch('/api/boards', { credentials: 'include' });
            if (!res.ok) {
                listEl.innerHTML = '<div class="boards-empty">Sign in to use boards</div>';
                return;
            }
            const boards = await res.json();

            if (boards.length === 0) {
                listEl.innerHTML = '<div class="boards-empty">No boards yet</div>';
                return;
            }

            listEl.innerHTML = `<div class="boards-grid">${boards.map(b => `
                <div class="board-card${b.id === this.currentBoardId ? ' active' : ''}" data-id="${b.id}">
                    <div class="board-card-preview">
                        ${b.preview
                            ? `<img src="${b.preview}" alt="preview" class="board-card-img">`
                            : `<div class="board-card-no-preview">no preview</div>`}
                        ${b.id === this.currentBoardId ? '<div class="board-card-badge">active</div>' : ''}
                    </div>
                    <div class="board-card-meta">
                        <div class="board-card-name">${this._escHtml(b.name)}</div>
                        <div class="board-card-dates">
                            <span>Created ${this._fmtDate(b.createdAt)}</span>
                            <span>Updated ${this._fmtDate(b.updatedAt)}</span>
                        </div>
                        <div class="board-card-actions">
                            <button class="board-btn board-load-btn" data-id="${b.id}">↑ Load</button>
                            <button class="board-btn board-delete-btn" data-id="${b.id}">✕ Delete</button>
                        </div>
                    </div>
                </div>
            `).join('')}</div>`;

            listEl.querySelectorAll('.board-load-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._loadBoardFromServer(btn.dataset.id); });
            });
            listEl.querySelectorAll('.board-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._deleteBoardFromServer(btn.dataset.id); });
            });
        } catch (err) {
            listEl.innerHTML = '<div class="boards-empty">Failed to load</div>';
        }
    },

    async saveBoard() {
        let name = this.currentBoardName;
        if (!name) {
            name = prompt('Board name:', 'Untitled Board');
            if (!name || !name.trim()) return;
            name = name.trim();
        }
        await this._saveBoardToServer(name, this.currentBoardId);
    },

    async saveBoardAsNew() {
        const suggested = this.currentBoardName ? `${this.currentBoardName} copy` : 'Untitled Board';
        const name = prompt('Board name:', suggested);
        if (!name || !name.trim()) return;
        await this._saveBoardToServer(name.trim(), null);
    },

    async _saveBoardToServer(name, id) {
        this.uiManager.updateStatus('Saving board...');
        try {
            const state = this.serializeCanvas();
            const preview = this._generatePreview();
            const body = { name, state, preview };
            if (id) body.id = id;

            const res = await fetch('/api/boards', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
                throw new Error(errMsg);
            }

            const saved = await res.json();
            this.currentBoardId = saved.id;
            this.currentBoardName = saved.name;
            this._updateBoardUI();
            this.uiManager.updateStatus(`"${saved.name}" saved`, '#27ae60');

            const modal = document.getElementById('boardsModal');
            if (modal && modal.classList.contains('active')) this._loadBoardsList();
        } catch (err) {
            console.error('Save board error:', err);
            this.uiManager.updateStatus(`Save failed: ${err.message}`, '#e74c3c');
        }
    },

    async _loadBoardFromServer(boardId) {
        if (this.nodeManager.nodes.length > 0) {
            if (!confirm('Loading will replace the current canvas. Continue?')) return;
        }
        this.uiManager.updateStatus('Loading board...');
        try {
            const [stateRes, listRes] = await Promise.all([
                fetch(`/api/boards/${boardId}`, { credentials: 'include' }),
                fetch('/api/boards', { credentials: 'include' })
            ]);
            if (!stateRes.ok) throw new Error('Board not found');
            const state = await stateRes.json();
            const boards = await listRes.json();
            const meta = boards.find(b => b.id === boardId);

            this._clearCanvasImmediate();
            await this.deserializeCanvas(state);

            this.currentBoardId = boardId;
            this.currentBoardName = meta ? meta.name : 'Board';
            this._updateBoardUI();
            this.uiManager.updateStatus(`"${this.currentBoardName}" loaded`, '#27ae60');
            this._loadBoardsList();
        } catch (err) {
            console.error('Load board error:', err);
            this.uiManager.updateStatus('Failed to load board', '#e74c3c');
        }
    },

    async _deleteBoardFromServer(boardId) {
        if (!confirm('Delete this board? This cannot be undone.')) return;
        try {
            const res = await fetch(`/api/boards/${boardId}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error('Delete failed');
            if (this.currentBoardId === boardId) {
                this.currentBoardId = null;
                this.currentBoardName = null;
                this._updateBoardUI();
            }
            this._loadBoardsList();
            this.uiManager.updateStatus('Board deleted');
        } catch (err) {
            console.error('Delete board error:', err);
            this.uiManager.updateStatus('Failed to delete board', '#e74c3c');
        }
    },

    _updateBoardUI() {
        const nameEl = document.getElementById('currentBoardName');
        if (nameEl) nameEl.textContent = this.currentBoardName || '';
        if (this.currentBoardId) {
            localStorage.setItem('diffusionCanvas_lastBoardId', this.currentBoardId);
        } else {
            localStorage.removeItem('diffusionCanvas_lastBoardId');
        }
    },

    _generatePreview() {
        const nodes = this.nodeManager.nodes;
        if (!nodes.length) return null;

        const W = 320, H = 180;
        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');

        // Background
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, W, H);

        // Dot grid
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        for (let gx = 0; gx < W; gx += 20) {
            for (let gy = 0; gy < H; gy += 20) {
                ctx.beginPath();
                ctx.arc(gx, gy, 0.9, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Node bounds
        const xs = nodes.map(n => n.position.x);
        const ys = nodes.map(n => n.position.y);
        const xe = nodes.map(n => n.position.x + (n.element ? n.element.offsetWidth : 220));
        const ye = nodes.map(n => n.position.y + (n.element ? n.element.offsetHeight : 120));

        const pad = 20;
        const minX = Math.min(...xs) - pad;
        const maxX = Math.max(...xe) + pad;
        const minY = Math.min(...ys) - pad;
        const maxY = Math.max(...ye) + pad;

        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;

        const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
        const offX = pad + ((W - pad * 2) - rangeX * scale) / 2;
        const offY = pad + ((H - pad * 2) - rangeY * scale) / 2;

        const colors = { image: '#667eea', prompt: '#48bb78', action: '#ed8936', result: '#9f7aea', draw: '#e53e3e' };

        nodes.forEach(n => {
            const x = offX + (n.position.x - minX) * scale;
            const y = offY + (n.position.y - minY) * scale;
            const w = Math.max((n.element ? n.element.offsetWidth : 220) * scale, 16);
            const h = Math.max((n.element ? n.element.offsetHeight : 120) * scale, 10);
            const c = colors[n.type] || '#888888';
            ctx.fillStyle = c + '33';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = c;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, w, h);
        });

        return cvs.toDataURL('image/jpeg', 0.6);
    },

    _escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    _fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
            + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
});
