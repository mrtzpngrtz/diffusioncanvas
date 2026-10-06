import { AuthManager } from './modules/AuthManager.js';
import { UIManager } from './modules/UIManager.js';
import { CanvasManager } from './modules/CanvasManager.js';
import { NodeManager } from './modules/NodeManager.js';
import { ConnectionManager } from './modules/ConnectionManager.js';
import { APIManager } from './modules/APIManager.js';
import { AreaManager } from './modules/AreaManager.js';
import { FeedbackManager } from './modules/FeedbackManager.js';
import { registerVideoModels } from './nodes/VideoNode.js';
import { registerImageModels } from './nodes/PromptNode.js';
import { apiFetch as fetch, isApiMode } from './modules/ApiSession.js';

// Local ComfyUI workflows join the model dropdowns before any node exists, so
// a restored board never meets a model it cannot name. Offline, or with no
// workflows configured, the built-in lists are simply all there is.
async function loadWorkflowModels() {
    try {
        const res = await fetch('/api/workflows', { credentials: 'include' });
        if (!res.ok) return;
        const list = await res.json();
        registerVideoModels(list);
        registerImageModels(list);
    } catch { /* not reachable — carry on with the built-ins */ }
}

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

        this.areaManager = new AreaManager(this.canvasManager, this.nodeManager, this.uiManager);
        // the marquee handler asks the area manager first whether a drag is its own
        this.nodeManager.areaManager = this.areaManager;

        // Initialize managers
        this.connectionManager.init();
        this.canvasManager.init();
        this.nodeManager.init();
        this.areaManager.init();

        // Canvas-drawn UI (connections, minimap) reads the theme at draw time —
        // repaint both immediately when the theme flips.
        this.uiManager.onThemeChange = () => {
            this.connectionManager.drawConnections();
            this.canvasManager.updateMinimap();
        };

        this.currentBoardId = null;
        this.currentBoardName = null;
        // updatedAt of the server version this tab is working from, and the flag
        // that parks autosave once another tab has saved over it
        this.currentBoardUpdatedAt = null;
        this.saveConflict = false;

        // History stack — in-memory snapshots, max 30 entries
        this.historyStack = [];      // [{state, timestamp, label, nodeCount}]
        this.historyCurrentIdx = -1; // index of the currently displayed state (-1 = live)

        this.feedbackManager = new FeedbackManager({
            uiManager: this.uiManager,
            nodeManager: this.nodeManager,
            getBoardInfo: () => ({
                id: this.currentBoardId,
                name: this.currentBoardName
            })
        });

        this.init();
    }

    init() {
        this.setupToolbar();
        this.setupStorage();
        this.setupContextMenu();
        this.setupCanvasDrop();
        this.feedbackManager.init();

        window.addEventListener('api-mode-started', () => {
            this._clearCanvasImmediate();
            this.historyStack = [];
            this.currentBoardId = null;
            this.currentBoardName = null;
            this.currentBoardUpdatedAt = null;
            this.saveConflict = false;
            this.closeBoardsModal();
            document.getElementById('shareBoardModal')?.classList.remove('active');
            this._updateBoardUI();
            const badge = document.getElementById('autosaveBadge');
            badge.className = 'autosave-badge visible';
            badge.textContent = 'API mode · not saved';
            this.uiManager.updateStatus('Temporary API session — own keys, no autosave');
        });

        // Start auto-save
        this.startAutoSave();

        // Restore auto-save
        this.restoreAutoSavedCanvas();

        // Check for shared board link
        this.checkSharedBoardLink();

    }

    setupCanvasDrop() {
        const container = document.querySelector('.canvas-container');
        const nodeCanvas = document.getElementById('nodeCanvas');

        // Anything inside a node (images, canvases, video) must never start a
        // native HTML5 drag: Chrome exposes a dragged <img> as a File, so moving
        // a node with the pointer could end as a "file drop" that inserts a copy.
        let internalDrag = false;
        document.addEventListener('dragstart', (e) => {
            if (e.target.closest && e.target.closest('.node')) {
                e.preventDefault();
                internalDrag = true;
            }
        }, true);
        document.addEventListener('dragend', () => { internalDrag = false; });

        container.addEventListener('dragover', (e) => {
            if (internalDrag) { e.preventDefault(); return; }
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                nodeCanvas.classList.add('drop-active');
            }
        });

        container.addEventListener('dragleave', (e) => {
            if (!container.contains(e.relatedTarget)) {
                nodeCanvas.classList.remove('drop-active');
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            nodeCanvas.classList.remove('drop-active');
            if (internalDrag) { internalDrag = false; return; }

            const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
            if (!files.length) return;

            const rect = container.getBoundingClientRect();
            const zoom = this.canvasManager.zoom;
            const panX = this.canvasManager.panX;
            const panY = this.canvasManager.panY;

            files.forEach((file, i) => {
                const canvasX = (e.clientX - rect.left) / zoom - panX + i * 30;
                const canvasY = (e.clientY - rect.top) / zoom - panY + i * 30;
                const node = this.nodeManager.createNode('image', canvasX, canvasY);
                if (node) this.nodeManager.handleImageFile(file, node);
            });
        });
    }

    setupToolbar() {
        const canEdit = () => !this.isSharedGuestView;

        document.getElementById('addImageNode').addEventListener('click', () => { if (canEdit()) this.addNode('image'); });
        document.getElementById('addPromptNode').addEventListener('click', () => { if (canEdit()) this.addNode('prompt'); });
        document.getElementById('addActionNode').addEventListener('click', () => { if (canEdit()) this.addNode('action'); });
        document.getElementById('addDrawNode').addEventListener('click', () => { if (canEdit()) this.addNode('draw'); });
        document.getElementById('addThreeDNode').addEventListener('click', () => { if (canEdit()) this.addNode('threed'); });
        document.getElementById('addVideoNode').addEventListener('click', () => { if (canEdit()) this.addNode('video'); });
        document.getElementById('addFormatNode').addEventListener('click', () => { if (canEdit()) this.addNode('format'); });
        document.getElementById('addImageTo3DNode').addEventListener('click', () => { if (canEdit()) this.addNode('imageto3d'); });
        document.getElementById('addCompNode').addEventListener('click', () => { if (canEdit()) this.addNode('comp'); });
        document.getElementById('addOutpaintNode').addEventListener('click', () => { if (canEdit()) this.addNode('outpaint'); });
        document.getElementById('addChatNode').addEventListener('click', () => { if (canEdit()) this.addNode('chat'); });
        document.getElementById('addCompareNode').addEventListener('click', () => { if (canEdit()) this.addNode('compare'); });
        
        document.getElementById('resetAllSizes').addEventListener('click', () => this.resetAllImageSizes());
        document.getElementById('clearCanvas').addEventListener('click', () => { if (canEdit()) this.clearCanvas(); });

        document.getElementById('saveBoardBtn').addEventListener('click', () => { if (canEdit()) this.saveBoard(); });
        document.getElementById('openBoardsBtn').addEventListener('click', () => { if (canEdit()) this.toggleBoardsPanel(); });
        document.getElementById('newBoardBtn').addEventListener('click', () => { if (canEdit()) this.saveBoardAsNew(); });
        document.getElementById('downloadBoardBtn').addEventListener('click', () => {
            if (isApiMode()) this._downloadTemporaryCanvas();
            else if (this.currentBoardId) this._downloadBoard(this.currentBoardId);
        });
        document.getElementById('boardsModalClose').addEventListener('click', () => this.closeBoardsModal());
        document.getElementById('boardsModalNew').addEventListener('click', () => this.newEmptyBoard());
        document.getElementById('boardsModalImport').addEventListener('click', () => this._importBoardFromFile());
        document.getElementById('boardsModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeBoardsModal();
        });

        // Ctrl+Z / Ctrl+C / Ctrl+V — undo, copy, paste nodes
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const inInput = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                if (inInput) return;
                if (this.uiManager._lightboxDrawing) return; // the lightbox undoes its own strokes
                e.preventDefault();
                if (this.historyStack.length > 0) this._restoreHistory(0);
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.isSharedGuestView) return; // Cannot delete nodes in guest view

                if (inInput || active?.isContentEditable) return;
                if (!this.nodeManager.selectedNodes.size) return;
                e.preventDefault(); // Backspace would navigate back
                this._pushHistory('Before delete');
                this.nodeManager.deleteSelectedNodes();
                this.connectionManager.drawConnections();
                this.canvasManager.updateMinimap();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                if (inInput) return;
                e.preventDefault();
                this.nodeManager.copySelectedNodes();
            }
            // Ctrl+V is deliberately not handled here: a keydown carries no
            // clipboard, and calling preventDefault on it stops the browser from
            // ever firing the paste event. The paste listener below decides.

        });

        // Paste: an image from the system clipboard becomes an image node,
        // anything else falls back to the nodes copied with Ctrl+C.
        document.addEventListener('paste', (e) => {
            const active = document.activeElement;
            const inInput = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
            if (inInput) return;
            if (this.isSharedGuestView) return; // No paste in guest view


            const items = e.clipboardData?.items ? [...e.clipboardData.items] : [];
            const imageItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));

            if (imageItem) {
                const blob = imageItem.getAsFile();
                if (blob) {
                    e.preventDefault();
                    const ext = (blob.type || 'image/png').split('/')[1] || 'png';
                    const file = new File([blob], `pasted-image.${ext}`, { type: blob.type || 'image/png' });
                    const center = this.canvasManager.getViewportCenter();
                    const node = this.nodeManager.createNode('image', center.x, center.y);
                    if (node) this.nodeManager.handleImageFile(file, node);
                    return;
                }
            }

            e.preventDefault();
            this.nodeManager.pasteNodes();
        });
    }

    addNode(type) {
        const center = this.canvasManager.getViewportCenter();
        // Offset based on node size approximation
        let offsetX = -125; 
        let offsetY = -75;
        this.nodeManager.createNode(type, center.x + offsetX, center.y + offsetY);
    }

    resetAllImageSizes() {
        const count = this.nodeManager.nodes.filter(n => n.type === 'image' || n.type === 'result' || n.type === 'videoresult').length;
        if (!count) return;
        this.nodeManager.nodes.forEach(n => {
            if (n.type === 'image' || n.type === 'result' || n.type === 'videoresult') {
                n.element.style.width = '400px';
            }
        });
        this.uiManager.updateStatus(`Reset ${count} image${count !== 1 ? 's' : ''} to standard size`);
    }

    async clearCanvas() {
        if (await this._confirm('Clear all nodes? This cannot be undone.')) {
            this._pushHistory('Before clear');
            this._clearCanvasImmediate();
        }
    }

    _clearCanvasImmediate() {
        this.areaManager?.clear();
        this.nodeManager.clearSelection();
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
            if (this.isSharedGuestView) return; // Read-only for guest

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
                    case 'addThreeD': newNode = this.nodeManager.createNode('threed', canvasX, canvasY); break;
                    case 'addVideo': newNode = this.nodeManager.createNode('video', canvasX, canvasY); break;
                    case 'addFormat': newNode = this.nodeManager.createNode('format', canvasX, canvasY); break;
                    case 'addImageTo3D': newNode = this.nodeManager.createNode('imageto3d', canvasX, canvasY); break;
                    case 'addComp': newNode = this.nodeManager.createNode('comp', canvasX, canvasY); break;
                    case 'addOutpaint': newNode = this.nodeManager.createNode('outpaint', canvasX, canvasY); break;
                    case 'addChat': newNode = this.nodeManager.createNode('chat', canvasX, canvasY); break;
                    case 'addCompare': newNode = this.nodeManager.createNode('compare', canvasX, canvasY); break;
                    case 'addArea':
                        // Draw one right here rather than making the user find alt-drag
                        this.areaManager.createArea({ x: canvasX, y: canvasY });
                        this.uiManager.updateStatus('Work area added — drag its header to move it with the nodes inside', '#667eea');
                        break;
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
                    if (!await this._confirm('Loading will replace the current canvas. Continue?')) return;
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

    // ThreeDNode keeps binary formats as base64 and text formats as plain text
    _modelDataUrl(node) {
        const type = node.data.modelType || 'glb';
        const binary = ['glb', 'fbx', 'stl'].includes(type);
        if (binary) return `data:model/${type};base64,${node.data.modelData}`;
        return `data:text/${type};base64,${btoa(unescape(encodeURIComponent(node.data.modelData)))}`;
    }

    async _uploadPendingImages(show) {
        if (isApiMode()) return;
        // Images and videos share the blob store (/api/images is mime-agnostic)
        const pending = [];
        for (const n of this.nodeManager.nodes) {
            // (composites re-render from their sources on load — no need to store the output)
            if (n.type !== 'comp' && n.type !== 'outpaint' && n.data.imageData && !n.data.imageRef) pending.push({ node: n, dataKey: 'imageData', refKey: 'imageRef' });
            if (n.data.videoData && !n.data.videoRef) pending.push({ node: n, dataKey: 'videoData', refKey: 'videoRef' });
            if (n.type === 'threed' && n.data.modelData && !n.data.modelRef) pending.push({ node: n, dataKey: 'modelData', refKey: 'modelRef' });
        }
        if (!pending.length) return;
        show('saving', `● uploading ${pending.length} media file${pending.length > 1 ? 's' : ''}…`);
        await Promise.all(pending.map(async ({ node, dataKey, refKey }) => {
            try {
                const res = await fetch('/api/images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    // 3D models are stored as raw base64 (binary) or text — wrap them as a data URL
                    body: JSON.stringify({ data: dataKey === 'modelData' ? this._modelDataUrl(node) : node.data[dataKey] })
                });
                if (res.ok) {
                    const { id } = await res.json();
                    node.data[refKey] = id;
                }
            } catch (e) {
                console.warn('[upload] media upload failed:', e);
            }
        }));
    }

    startAutoSave() {
        // Server autosave every 30s
        setInterval(() => {
            if (this.currentBoardId && !this.saveConflict) {
                this._autoSaveToServer();
            }
        }, 30000);
    }

    async _autoSaveToServer() {
        if (isApiMode()) return;
        const badge = document.getElementById('autosaveBadge');
        const show = (cls, text) => {
            if (!badge) return;
            badge.className = `autosave-badge visible ${cls}`;
            badge.textContent = text;
        };
        show('saving', '● saving…');
        if (this.isSharedGuestView) return; // Never auto-save or overwrite shared board from guest

        try {
            // Upload any images that don't have a server ref yet (one-time per image)
            await this._uploadPendingImages(show);

            const state = this.serializeCanvas();
            const preview = this._generatePreview();
            const body = JSON.stringify({
                id: this.currentBoardId,
                name: this.currentBoardName,
                state,
                preview,
                baseUpdatedAt: this.currentBoardUpdatedAt
            });
            const sizeMB = (new TextEncoder().encode(body).length / 1048576).toFixed(1);
            show('saving', `● saving… ${sizeMB} MB`);
            const res = await fetch('/api/boards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body
            });
            if (res.status === 409) {
                // Another tab saved this board — park autosave rather than
                // overwrite whatever they did.
                this.saveConflict = true;
                show('error', '✕ changed elsewhere');
                this.uiManager.updateStatus(
                    'This board was saved in another tab — autosave stopped. Use "Save as new" to keep this version.',
                    '#e74c3c'
                );
                return;
            }
            if (!res.ok) throw new Error(res.statusText);
            const savedMeta = await res.json().catch(() => null);
            if (savedMeta?.updatedAt) this.currentBoardUpdatedAt = savedMeta.updatedAt;
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            show('saved', `✓ ${hh}:${mm}:${ss} · ${sizeMB} MB`);
            // Fade out after 4s
            setTimeout(() => { if (badge) badge.classList.remove('visible'); }, 4000);
        } catch (e) {
            console.error('Autosave failed:', e);
            show('error', '✕ save failed');
            setTimeout(() => { if (badge) badge.classList.remove('visible'); }, 5000);
        }
    }

    // ── SHARED BOARD LINK (GUEST VISITOR) ──────────────────────────────────
    async checkSharedBoardLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const shareBoardId = urlParams.get('share');
        if (!shareBoardId) return;

        // Close boards panel and login modal
        this.closeBoardsModal();
        const loginModal = document.getElementById('loginModal');
        if (loginModal) loginModal.classList.add('hidden');

        try {
            // 1. Get info on whether a password is required
            const infoRes = await fetch(`/api/share/info/${shareBoardId}`);
            if (!infoRes.ok) {
                const err = await infoRes.json().catch(() => ({}));
                this.uiManager.updateStatus(err.error || 'Shared board not found', '#e74c3c');
                return;
            }

            const info = await infoRes.json();
            const headingEl = document.getElementById('guestBoardHeading');
            if (headingEl) headingEl.textContent = info.name || 'Shared Board';

            // 2. If no password needed, attempt immediate access
            if (!info.hasPassword) {
                await this._requestSharedBoardAccess(shareBoardId, '');
                return;
            }

            // 3. Password required -> show Guest Access Modal
            const guestModal = document.getElementById('guestAccessModal');
            const guestForm = document.getElementById('guestAccessForm');
            const guestPwInput = document.getElementById('guestPassword');
            const guestError = document.getElementById('guestAccessError');
            const guestSubmit = document.getElementById('guestAccessSubmitBtn');

            if (guestModal) guestModal.classList.remove('hidden');
            if (guestPwInput) {
                guestPwInput.value = '';
                guestPwInput.focus();
            }
            if (guestError) guestError.textContent = '';

            guestForm.onsubmit = async (e) => {
                e.preventDefault();
                guestSubmit.disabled = true;
                guestError.textContent = '';
                const pw = guestPwInput.value;
                const ok = await this._requestSharedBoardAccess(shareBoardId, pw);
                guestSubmit.disabled = false;
                if (ok && guestModal) {
                    guestModal.classList.add('hidden');
                }
            };

        } catch (err) {
            console.error('Shared board initialization error:', err);
        }
    }

    async _requestSharedBoardAccess(boardId, password) {
        const guestError = document.getElementById('guestAccessError');
        this._showLoading('Loading shared board...');
        try {
            const res = await fetch(`/api/share/access/${boardId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ password })
            });

            const data = await res.json().catch(() => ({}));
            this._hideLoading();

            if (!res.ok) {
                if (guestError) guestError.textContent = data.error || 'Incorrect password.';
                return false;
            }

            // Successfully authenticated as guest: deserialize board state
            this.currentBoardId = data.board.id;
            this.currentBoardName = data.board.name;
            this.isSharedGuestView = true;

            await this.deserializeCanvas(data.state);

            // Display banner / board title
            this._updateBoardUI();
            const topBarEl = document.getElementById('topBarBoardName');
            if (topBarEl) topBarEl.textContent = `${data.board.name} (Shared View)`;
            this.uiManager.updateStatus(`Viewing shared board: "${data.board.name}"`, '#27ae60');

            // Add guest mode class to body to hide edit controls, save, delete, toolbar creation
            document.body.classList.add('guest-mode');


            // Hide normal boards / save buttons for read-only guests
            const openBoardsBtn = document.getElementById('openBoardsBtn');
            if (openBoardsBtn) openBoardsBtn.style.display = 'none';

            return true;
        } catch (e) {
            this._hideLoading();
            if (guestError) guestError.textContent = e.message || 'Failed to load board.';
            return false;
        }
    }



    async restoreAutoSavedCanvas() {
        await this.authManager.ready;
        if (isApiMode()) return;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('share')) return; // handled by checkSharedBoardLink


        // If refreshed within the same tab session, restore the last board silently
        const sessionBoardId = sessionStorage.getItem('diffusionCanvas_sessionBoardId');
        if (sessionBoardId && this.authManager.userInfo.style.display !== 'none') {
            try {
                const res = await fetch(`/api/boards/${sessionBoardId}`, { credentials: 'include' });
                if (isApiMode()) return;
                if (res.ok) {
                    const state = await res.json();
                    if (isApiMode()) return;
                    const listRes = await fetch('/api/boards', { credentials: 'include' });
                    if (isApiMode()) return;
                    if (listRes.ok) {
                        const boards = await listRes.json();
                        if (isApiMode()) return;
                        const meta = boards.find(b => b.id === sessionBoardId);
                        if (meta) {
                            this.currentBoardId = sessionBoardId;
                            this.currentBoardName = meta.name;
                            this.currentBoardUpdatedAt = meta.updatedAt || null;
                            this.saveConflict = false;
                            this._updateBoardUI();
                        }
                    }
                    await this.deserializeCanvas(state);
                    this.uiManager.updateStatus(`"${this.currentBoardName || 'Board'}" restored`, '#667eea');
                    return;
                }
            } catch (e) {
                console.warn('Could not restore session board', e);
            }
        }

        // New session — show the board manager
        this.uiManager.updateStatus('Ready');
        if (!isApiMode() && this.authManager.userInfo.style.display !== 'none') this.toggleBoardsPanel();
    }

    serializeCanvas() {
        return {
            version: '1.0',
            timestamp: new Date().toISOString(),
            zoom: this.canvasManager.zoom,
            panX: this.canvasManager.panX,
            panY: this.canvasManager.panY,
            nodeIdCounter: this.nodeManager.nodeIdCounter,
            areas: this.areaManager.serialize(),
            nodes: this.nodeManager.nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: {
                    imageRef: node.data.imageRef || null,  // server ID — never store raw imageData
                    videoRef: node.data.videoRef || null,  // server ID — never store raw videoData
                    duration: node.data.duration ?? null,
                    audio: node.data.audio ?? null,
                    frameMode: node.data.frameMode || null,
                    swapFrames: node.data.swapFrames || false,
                    targetFormat: node.data.targetFormat || null,
                    formatOptions: node.data.formatOptions || null,
                    promptEdited: node.data.promptEdited || false,
                    quality: node.data.quality || null,
                    seed: node.data.seed ?? null,
                    modelRef: node.data.modelRef || null,  // server blob ID for large 3D models
                    pad: node.type === 'outpaint' ? node.data.pad : null,
                    presetMode: node.type === 'outpaint' ? node.data.presetMode : null,
                    history: node.type === 'chat' ? (node.data.history || []).slice(-40) : null,
                    promptMode: node.type === 'chat' ? node.data.promptMode !== false : null,
                    fromChatId: node.data.fromChatId || null,
                    split: node.type === 'compare' ? node.data.split : null,
                    swap: node.type === 'compare' ? !!node.data.swap : null,
                    // Composite layers: file layers keep their PNG inline, input layers only the source id
                    layers: node.type === 'comp' && node.data.layers
                        ? node.data.layers.map(l => ({ ...l, src: l.kind === 'file' ? l.src : null }))
                        : null,
                    overlayText: node.data.overlayText || null,
                    maskData: node.data.maskData || null,
                    starred: node.data.starred || false,
                    modelType: node.data.modelType || null,
                    modelName: node.data.modelName || null,
                    // 3D model: stored in the blob store once uploaded (modelRef); inline only as a
                    // fallback for small files that haven't been uploaded yet (cap 20 MB)
                    modelData: (node.type === 'threed' && !node.data.modelRef && node.data.modelData && node.data.modelData.length < 20 * 1024 * 1024)
                        ? node.data.modelData : null,
                    ambientIntensity: node.data.ambientIntensity ?? null,
                    sunIntensity: node.data.sunIntensity ?? null,
                    exposure: node.data.exposure ?? null,
                    bgColor: node.data.bgColor || null,
                    fov: node.data.fov || null,
                    imageWidth: node.data.imageWidth,
                    nodeWidth: node.element ? node.element.offsetWidth : null,
                    // only a height the user drew — otherwise the node keeps sizing to its content
                    freeHeight: !!node.element?.classList.contains('node-free-height'),
                    nodeHeight: node.element ? node.element.offsetHeight : null,
                    prompt: node.data.prompt,
                    aspectRatio: node.data.aspectRatio,
                    resolution: node.data.resolution,
                    outputFormat: node.data.outputFormat,
                    model: node.data.model,
                    steps: node.data.steps,
                    guidance: node.data.guidance,
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
        this.areaManager.restore(state.areas);

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

            // Restore resized dimensions
            if (nodeData.data.nodeWidth && tempNode.element) {
                tempNode.element.style.width = nodeData.data.nodeWidth + 'px';
            }
            const keepsHeight = nodeData.data.freeHeight || nodeData.type === 'prompt';
            if (nodeData.data.nodeHeight && keepsHeight && tempNode.element) {
                tempNode.element.classList.add('node-free-height');
                tempNode.element.style.height = nodeData.data.nodeHeight + 'px';
            }
            
            // Handle image loading — imageRef (server) or imageData (legacy/local)
            const hasImage = nodeData.data.imageRef || nodeData.data.imageData;
            if ((nodeData.type === 'image' || nodeData.type === 'result') && hasImage) {
                const p = (async () => {
                    let src = nodeData.data.imageData || null;

                    if (nodeData.data.imageRef) {
                        try {
                            const res = await fetch(`/api/images/${nodeData.data.imageRef}`, { credentials: 'include' });
                            if (res.ok) {
                                const blob = await res.blob();
                                src = await new Promise(r => {
                                    const fr = new FileReader();
                                    fr.onload = () => r(fr.result);
                                    fr.readAsDataURL(blob);
                                });
                                tempNode.data.imageRef = nodeData.data.imageRef;
                            }
                        } catch (e) {
                            console.warn('[deserialize] image fetch failed:', e);
                        }
                    }

                    if (!src) return;
                    tempNode.data.imageData = src;

                    if (nodeData.type === 'image') {
                        if (nodeData.data.overlayText) tempNode.data.overlayText = nodeData.data.overlayText;
                        if (nodeData.data.maskData) tempNode.data.maskData = nodeData.data.maskData;
                        await new Promise(resolve => {
                            const img = document.createElement('img');
                            img.src = src;
                            img.onload = () => {
                                tempNode.data.image = img;
                                // "keep source ratio" reads these — without them a
                                // restored board generates at the 1:1 fallback
                                tempNode.data.originalWidth = img.naturalWidth;
                                tempNode.data.originalHeight = img.naturalHeight;
                                const content = tempNode.element.querySelector('.node-content');
                                content.innerHTML = '';
                                const wrapper = document.createElement('div');
                                wrapper.className = 'image-wrapper';
                                wrapper.appendChild(img);
                                content.appendChild(wrapper);
                                this.nodeManager._setupDrawOverlay(tempNode, wrapper);
                                this.nodeManager._setupImageTextInput(tempNode, content, tempNode.data.overlayText);
                                this.nodeManager.addNodeActionButtons(tempNode, content);
                                const clearBtn = tempNode.element.querySelector('.clear-button');
                                if (clearBtn) clearBtn.style.display = '';
                                resolve();
                            };
                            img.onerror = resolve;
                        });
                    } else {
                        // result node — img already in DOM, update src if fetched from server
                        if (nodeData.data.maskData) tempNode.data.maskData = nodeData.data.maskData;
                        const img = tempNode.element.querySelector('img');
                        if (img) {
                            if (nodeData.data.imageRef) img.src = src;
                            if (!img.complete) {
                                await new Promise(resolve => {
                                    img.addEventListener('load', resolve, { once: true });
                                    img.addEventListener('error', resolve, { once: true });
                                });
                            }
                            tempNode.data.image = img;
                        }
                    }
                })();
                promises.push(p);
            }

            // 3D models stored in the blob store — fetch, decode and start the viewer
            if (nodeData.type === 'threed' && nodeData.data.modelRef && !nodeData.data.modelData) {
                const p = (async () => {
                    try {
                        const res = await fetch(`/api/images/${nodeData.data.modelRef}`, { credentials: 'include' });
                        if (!res.ok) return;
                        const buf = await res.arrayBuffer();
                        const type = nodeData.data.modelType || 'glb';
                        if (['glb', 'fbx', 'stl'].includes(type)) {
                            const bytes = new Uint8Array(buf);
                            let bin = ''; const CH = 8192;
                            for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
                            tempNode.data.modelData = btoa(bin);
                        } else {
                            tempNode.data.modelData = new TextDecoder().decode(buf);
                        }
                        tempNode.data.modelType = type;
                        tempNode.data.modelRef = nodeData.data.modelRef;
                        if (tempNode.restoreViewer) await tempNode.restoreViewer();
                    } catch (e) {
                        console.warn('[load] 3D model fetch failed:', e);
                    }
                })();
                promises.push(p);
            }

            // Video results — fetch the stored blob and load it into the player
            if (nodeData.type === 'videoresult' && (nodeData.data.videoRef || nodeData.data.videoData)) {
                const p = (async () => {
                    let src = nodeData.data.videoData || null;
                    if (nodeData.data.videoRef) {
                        try {
                            const res = await fetch(`/api/images/${nodeData.data.videoRef}`, { credentials: 'include' });
                            if (res.ok) {
                                const blob = await res.blob();
                                src = await new Promise(resolve => {
                                    const r = new FileReader();
                                    r.onload = () => resolve(r.result);
                                    r.onerror = () => resolve(null);
                                    r.readAsDataURL(blob);
                                });
                                tempNode.data.videoRef = nodeData.data.videoRef;
                            }
                        } catch (e) {
                            console.warn('[load] video fetch failed:', e);
                        }
                    }
                    if (src && tempNode.setVideoSrc) tempNode.setVideoSrc(src);
                })();
                promises.push(p);
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

        // Update result node metadata now that source links are resolved
        for (const node of nodeMap.values()) {
            if (node.type !== 'result' || !node.updateMeta) continue;
            if (!node.data.prompt && node.data.sourcePromptNode) {
                node.data.prompt = node.data.sourcePromptNode.data.prompt;
                node.data.model  = node.data.sourcePromptNode.data.model;
            }
            node.updateMeta();
        }

        // Restore connections
        this.connectionManager.connections = state.connections || [];
        // Re-run wiring for every connection so connectedImages/connectedPrompts
        // are always complete — covers old boards saved before a new node type
        // was added, and browsers that cached JS before the connection type-check fix.
        for (const conn of this.connectionManager.connections) {
            const fromNode = this.nodeManager.nodes.find(n => n.id === conn.from);
            const toNode   = this.nodeManager.nodes.find(n => n.id === conn.to);
            if (fromNode && toNode) this.connectionManager.updateNodeConnections(fromNode, toNode);
        }
        this.connectionManager.drawConnections();
        
        await Promise.all(promises);
        this.canvasManager.updateMinimap();
    }
}

// Initialize App
window.addEventListener('load', () => {
    loadWorkflowModels().then(() => new App());
});

// ── BOARDS ───────────────────────────────────────────────────────────────────

Object.assign(App.prototype, {

    toggleBoardsPanel() {
        if (isApiMode()) return;
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
                this._updateBoardsFooter(0, 0);
                return;
            }

            const totalSize = boards.reduce((s, b) => s + (b.size || 0), 0);
            this._updateBoardsFooter(boards.length, totalSize);

            listEl.innerHTML = `<div class="boards-grid">${boards.map(b => `
                <div class="board-card${b.id === this.currentBoardId ? ' active' : ''}" data-id="${b.id}">
                    <div class="board-card-preview">
                        ${b.preview
                            ? `<img src="${b.preview}" alt="preview" class="board-card-img">`
                            : `<div class="board-card-no-preview">no preview</div>`}
                        ${b.id === this.currentBoardId ? '<div class="board-card-badge">active</div>' : ''}
                    </div>
                    <div class="board-card-meta">
                        <div class="board-card-name-row">
                            <span class="board-card-name">${this._escHtml(b.name)}</span>
                            <button class="board-icon-btn board-rename-btn" data-id="${b.id}" data-name="${this._escHtml(b.name)}" title="Rename"><svg class="icon"><use href="#i-pencil"/></svg></button>
                        </div>
                        <div class="board-card-info">
                            <div class="board-card-dates">
                                <span>Created ${this._fmtDate(b.createdAt)}</span>
                                <span>Updated ${this._fmtDate(b.updatedAt)}</span>
                            </div>
                            <div class="board-card-size">
                                <div>${b.nodeCount || 0} nodes</div>
                                <div>${this._fmtBytes(b.size || 0)}</div>
                            </div>
                        </div>
                        <div class="board-card-actions">
                            <button class="board-btn board-load-btn" data-id="${b.id}"><svg class="icon"><use href="#i-upload"/></svg>Load</button>
                            <button class="board-btn board-share-btn${b.share?.enabled ? ' shared-active' : ''}" data-id="${b.id}" data-name="${this._escHtml(b.name)}" title="Share board with link and password"><svg class="icon"><use href="#i-share"/></svg>${b.share?.enabled ? 'Shared' : 'Share'}</button>
                            <button class="board-btn board-download-btn" data-id="${b.id}"><svg class="icon"><use href="#i-download"/></svg>Download</button>
                            <button class="board-btn board-versions-btn" data-id="${b.id}" data-name="${this._escHtml(b.name)}"><svg class="icon"><use href="#i-refresh"/></svg>Versions</button>
                            <button class="board-btn board-delete-btn" data-id="${b.id}" title="Delete"><svg class="icon"><use href="#i-trash"/></svg></button>
                        </div>
                        <div class="board-versions-panel" id="vp-${b.id}" style="display:none;"></div>
                    </div>
                </div>
            `).join('')}</div>`;

            listEl.querySelectorAll('.board-load-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._loadBoardFromServer(btn.dataset.id); });
            });
            listEl.querySelectorAll('.board-download-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._downloadBoard(btn.dataset.id); });
            listEl.querySelectorAll('.board-share-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._openShareModal(btn.dataset.id, btn.dataset.name); });
            });

            });
            listEl.querySelectorAll('.board-rename-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._renameBoard(btn.dataset.id, btn.dataset.name); });
            });
            listEl.querySelectorAll('.board-delete-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._deleteBoardFromServer(btn.dataset.id); });
            });
            listEl.querySelectorAll('.board-versions-btn').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleBoardVersions(btn.dataset.id, btn.dataset.name); });
            });
        } catch (err) {
            listEl.innerHTML = '<div class="boards-empty">Failed to load</div>';
        }
    },

    async _toggleBoardVersions(boardId, boardName) {
        const panel = document.getElementById(`vp-${boardId}`);
        if (!panel) return;
        if (panel.style.display !== 'none') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'block';
        panel.innerHTML = '<div class="board-versions-loading">Loading versions...</div>';

        try {
            const res = await fetch(`/api/boards/${boardId}/versions`, { credentials: 'include' });
            if (!res.ok) throw new Error('Failed');
            const versions = await res.json();

            if (versions.length === 0) {
                panel.innerHTML = '<div class="board-versions-empty">No versions saved yet — versions are created each time a board is saved.</div>';
                return;
            }

            panel.innerHTML = `<div class="board-versions-list">
                ${versions.map((v, i) => `
                    <div class="board-version-row">
                        <span class="board-version-date">${this._fmtDateFull(v.savedAt)}</span>
                        <button class="board-btn board-version-restore-btn" data-id="${boardId}" data-idx="${i}" data-name="${this._escHtml(boardName)}" data-date="${this._escHtml(v.savedAt)}"><svg class="icon"><use href="#i-refresh"/></svg>Restore</button>
                    </div>
                `).join('')}
            </div>`;

            panel.querySelectorAll('.board-version-restore-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._restoreBoardVersion(btn.dataset.id, parseInt(btn.dataset.idx), btn.dataset.name, btn.dataset.date);
                });
            });
        } catch (err) {
            panel.innerHTML = '<div class="board-versions-empty">Failed to load versions.</div>';
        }
    },

    async _restoreBoardVersion(boardId, versionIdx, boardName, savedAt) {
        const dateStr = this._fmtDateFull(savedAt);
        if (!await this._confirm(`Restore "${boardName}" to the version saved at ${dateStr}?\n\nThis will load that version onto the canvas. The current canvas will not be overwritten until you save.`)) return;

        this.closeBoardsModal();
        this._showLoading('Restoring version...');
        try {
            const res = await fetch(`/api/boards/${boardId}/versions/${versionIdx}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Version not found');
            const state = await res.json();

            this._clearCanvasImmediate();
            await this.deserializeCanvas(state);

            this.currentBoardName = boardName;
            this._updateBoardUI();
            this.uiManager.updateStatus(`Restored to ${dateStr} — save to keep this version`, '#e67e22');
        } catch (err) {
            console.error('Restore version error:', err);
            this.uiManager.updateStatus('Failed to restore version', '#e74c3c');
        } finally {
            this._hideLoading();
        }
    },

    _fmtDateFull(iso) { return this._fmtDate(iso); },

    async saveBoard() {
        let name = this.currentBoardName;
        if (!name) {
            name = await this._prompt('Board name:', 'Untitled Board');
            if (!name || !name.trim()) return;
            name = name.trim();
        }
        await this._saveBoardToServer(name, this.currentBoardId);
    },

    async saveBoardAsNew() {
        const suggested = this.currentBoardName ? `${this.currentBoardName} copy` : 'Untitled Board';
        const name = await this._prompt('Board name:', suggested);
        if (!name || !name.trim()) return;
        await this._saveBoardToServer(name.trim(), null);
    },

    async newEmptyBoard() {
        const name = await this._prompt('Board name:', 'Untitled Board');
        if (!name || !name.trim()) return;
        this._clearCanvasImmediate();
        this.currentBoardId = null;
        this.currentBoardName = null;
        await this._saveBoardToServer(name.trim(), null);
    },

    async _saveBoardToServer(name, id, force = false) {
        if (isApiMode()) {
            this.uiManager.updateStatus('API mode does not save boards. Use Download Board for an explicit export.');
            return;
        }
        this.uiManager.updateStatus('Saving board...');
        try {
            const state = this.serializeCanvas();
            const preview = this._generatePreview();
            const body = { name, state, preview };
            if (id) {
                body.id = id;
                body.baseUpdatedAt = this.currentBoardUpdatedAt;
                if (force) body.force = true;
            }

            const res = await fetch('/api/boards', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (res.status === 409) {
                const info = await res.json().catch(() => ({}));
                const when = info.updatedAt ? new Date(info.updatedAt).toLocaleTimeString() : 'just now';
                const overwrite = await this._confirm(
                    `"${name}" was saved somewhere else at ${when} — probably another tab.\n\n` +
                    'OK overwrites that version with this canvas.\n' +
                    'Cancel keeps it and saves this canvas as a new board.'
                );
                if (overwrite) return this._saveBoardToServer(name, id, true);
                return this._saveBoardToServer(`${name} (${when})`, null);
            }

            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
                throw new Error(errMsg);
            }

            const saved = await res.json();
            this.currentBoardId = saved.id;
            this.currentBoardName = saved.name;
            this.currentBoardUpdatedAt = saved.updatedAt || null;
            this.saveConflict = false;
            this._updateBoardUI();
            this._pushHistory(`Saved: ${saved.name}`);
            this.uiManager.updateStatus(`"${saved.name}" saved`, '#27ae60');
            this.closeBoardsModal();
        } catch (err) {
            console.error('Save board error:', err);
            this.uiManager.updateStatus(`Save failed: ${err.message}`, '#e74c3c');
        }
    },

    _showLoading(msg = 'Loading...') {
        const el = document.getElementById('loadingOverlay');
        const label = document.getElementById('loadingLabel');
        if (el) { el.classList.add('active'); }
        if (label) label.textContent = msg;
    },

    _hideLoading() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.classList.remove('active');
    },

    async _loadBoardFromServer(boardId) {
        if (this.nodeManager.nodes.length > 0) {
            if (!await this._confirm('Loading will replace the current canvas. Continue?')) return;
            this._pushHistory(`Before loading board`);
        }
        this.closeBoardsModal();
        this._showLoading('Loading board...');
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
            this.currentBoardUpdatedAt = meta ? meta.updatedAt : null;
            this.saveConflict = false;
            this._updateBoardUI();
            this.uiManager.updateStatus(`"${this.currentBoardName}" loaded`, '#27ae60');
        } catch (err) {
            console.error('Load board error:', err);
            this.uiManager.updateStatus('Failed to load board', '#e74c3c');
        } finally {
            this._hideLoading();
        }
    },

    _importBoardFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.dc.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                // Support both raw canvas state and exported board format
                const state = data.state || data;
                if (!state.nodes) throw new Error('Invalid board file');
                const defaultName = data.name || file.name.replace(/\.(dc\.)?json$/i, '');
                const name = await this._prompt('Board name:', defaultName);
                if (!name || !name.trim()) return;
                this._showLoading('Importing board...');
                const preview = null; // no preview for imported boards
                const res = await fetch('/api/boards', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim(), state, preview })
                });
                if (!res.ok) throw new Error('Upload failed');
                this._hideLoading();
                this._loadBoardsList();
            } catch (err) {
                this._hideLoading();
                this.uiManager.updateStatus(`Import failed: ${err.message}`, '#e74c3c');
            }
        };
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    },

    async _renameBoard(boardId, currentName) {
        const name = await this._prompt('Rename board:', currentName);
        if (!name || !name.trim() || name.trim() === currentName) return;
        try {
            const res = await fetch(`/api/boards/${boardId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            if (!res.ok) throw new Error('Rename failed');
            if (boardId === this.currentBoardId) {
                this.currentBoardName = name.trim();
                this._updateBoardUI();
            }
            this._loadBoardsList();
        } catch (err) {
            this.uiManager.updateStatus('Rename failed', '#e74c3c');
        }
    },

    async _downloadBoard(boardId) {
        window.location.href = `/api/boards/${boardId}/export`;
    },

    async _deleteBoardFromServer(boardId) {
        if (!await this._confirm('Delete this board? This cannot be undone.')) return;
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
    // ── SHARE BOARD MODAL ───────────────────────────────────────────────────
    _openShareModal(boardId, boardName) {
        if (isApiMode()) return;
        const modal = document.getElementById('shareBoardModal');
        if (!modal) return;
        const titleEl = document.getElementById('shareModalBoardTitle');
        const toggle = document.getElementById('shareEnableToggle');
        const detailsBox = document.getElementById('shareDetailsBox');
        const linkInput = document.getElementById('shareLinkInput');
        const pwInput = document.getElementById('sharePasswordInput');
        const pwHint = document.getElementById('sharePwStatusHint');
        const statusMsg = document.getElementById('shareStatusMsg');

        titleEl.textContent = `Share "${boardName || 'Board'}"`;
        pwInput.value = '';
        statusMsg.style.display = 'none';
        statusMsg.textContent = '';

        const origin = window.location.origin;
        const shareUrl = `${origin}/?share=${boardId}`;
        linkInput.value = shareUrl;

        // Fetch current share status
        fetch('/api/boards', { credentials: 'include' })
            .then(res => res.json())
            .then(boards => {
                const b = Array.isArray(boards) ? boards.find(x => x.id === boardId) : null;
                const isEnabled = !!(b?.share?.enabled);
                const hasPw = !!(b?.share?.hasPassword);

                toggle.checked = isEnabled;
                detailsBox.style.display = isEnabled ? 'block' : 'none';
                pwHint.textContent = hasPw ? '● Password currently set' : '○ No password set (open access)';
                pwHint.style.color = hasPw ? 'var(--ok)' : 'var(--text-muted)';
            })
            .catch(() => {});

        // Wire toggle
        toggle.onchange = async () => {
            const enabled = toggle.checked;
            detailsBox.style.display = enabled ? 'block' : 'none';
            try {
                const res = await fetch(`/api/boards/${boardId}/share`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ enabled })
                });
                if (!res.ok) throw new Error('Update failed');
                statusMsg.style.display = 'block';
                statusMsg.className = 'share-status-msg success';
                statusMsg.textContent = enabled ? 'Sharing enabled!' : 'Sharing disabled.';
                this._loadBoardsList();
            } catch (err) {
                statusMsg.style.display = 'block';
                statusMsg.className = 'share-status-msg error';
                statusMsg.textContent = 'Failed to update share status.';
            }
        };

        // Wire save password button
        const saveBtn = document.getElementById('shareSaveBtn');
        saveBtn.onclick = async () => {
            const password = pwInput.value.trim();
            saveBtn.disabled = true;
            try {
                const res = await fetch(`/api/boards/${boardId}/share`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        enabled: toggle.checked,
                        password: password || undefined,
                        removePassword: password === '' && confirm('Remove password protection? Anyone with the link will be able to view without a password.')
                    })
                });
                if (!res.ok) throw new Error('Save failed');
                const data = await res.json();
                const hasPw = !!data.share?.hasPassword;
                pwHint.textContent = hasPw ? '● Password currently set' : '○ No password set (open access)';
                pwHint.style.color = hasPw ? 'var(--ok)' : 'var(--text-muted)';
                pwInput.value = '';
                statusMsg.style.display = 'block';
                statusMsg.className = 'share-status-msg success';
                statusMsg.textContent = 'Password settings updated!';
                this._loadBoardsList();
            } catch (err) {
                statusMsg.style.display = 'block';
                statusMsg.className = 'share-status-msg error';
                statusMsg.textContent = 'Failed to save password.';
            } finally {
                saveBtn.disabled = false;
            }
        };

        // Copy link
        const copyBtn = document.getElementById('shareCopyBtn');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(shareUrl);
                const originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = '<svg class="icon"><use href="#i-check"/></svg><span>Copied!</span>';
                setTimeout(() => { copyBtn.innerHTML = originalHtml; }, 2000);
            } catch {
                linkInput.select();
                document.execCommand('copy');
            }
        };

        modal.classList.add('active');

        // Close handlers
        const closeBtn = document.getElementById('shareBoardModalClose');
        const onClose = () => {
            modal.classList.remove('active');
            closeBtn.removeEventListener('click', onClose);
            modal.removeEventListener('click', onBackdrop);
        };
        const onBackdrop = (e) => {
            if (e.target === modal) onClose();
        };
        closeBtn.addEventListener('click', onClose);
        modal.addEventListener('click', onBackdrop);
    },


    _updateBoardUI() {
        const name = this.currentBoardName || '';
        const sidebarEl = document.getElementById('currentBoardName');
        if (sidebarEl) sidebarEl.textContent = name;
        const topBarEl = document.getElementById('topBarBoardName');
        if (topBarEl) topBarEl.textContent = name;
        const dlBtn = document.getElementById('downloadBoardBtn');
        if (dlBtn) dlBtn.style.display = this.currentBoardId || isApiMode() ? '' : 'none';
        if (isApiMode()) return;
        if (this.currentBoardId) {
            sessionStorage.setItem('diffusionCanvas_sessionBoardId', this.currentBoardId);
        } else {
            sessionStorage.removeItem('diffusionCanvas_sessionBoardId');
        }
    },

    _downloadTemporaryCanvas() {
        const state = this.serializeCanvas();
        state.nodes.forEach((saved, index) => {
            const data = this.nodeManager.nodes[index].data;
            saved.data.imageData = data.imageData || null;
            saved.data.videoData = data.videoData || null;
            saved.data.modelData = data.modelData || null;
        });
        const payload = { name: 'Temporary API canvas', state };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'temporary-api-canvas.dc.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    _confirm(message) {
        return new Promise(resolve => {
            document.getElementById('confirmMessage').textContent = message;
            const overlay = document.getElementById('confirmDialog');
            overlay.classList.add('active');
            const ok = document.getElementById('confirmOk');
            const cancel = document.getElementById('confirmCancel');
            const cleanup = (result) => {
                overlay.classList.remove('active');
                ok.removeEventListener('click', onOk);
                cancel.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onBackdrop);
                resolve(result);
            };
            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);
            const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
            ok.addEventListener('click', onOk);
            cancel.addEventListener('click', onCancel);
            overlay.addEventListener('click', onBackdrop);
        });
    },

    _prompt(message, defaultValue = '') {
        return new Promise(resolve => {
            document.getElementById('promptMessage').textContent = message;
            const input = document.getElementById('promptInput');
            input.value = defaultValue;
            const overlay = document.getElementById('promptDialog');
            overlay.classList.add('active');
            requestAnimationFrame(() => { input.focus(); input.select(); });
            const ok = document.getElementById('promptOk');
            const cancel = document.getElementById('promptCancel');
            const cleanup = (result) => {
                overlay.classList.remove('active');
                ok.removeEventListener('click', onOk);
                cancel.removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKey);
                overlay.removeEventListener('click', onBackdrop);
                resolve(result);
            };
            const onOk = () => cleanup(input.value);
            const onCancel = () => cleanup(null);
            const onKey = (e) => { if (e.key === 'Enter') onOk(); else if (e.key === 'Escape') onCancel(); };
            const onBackdrop = (e) => { if (e.target === overlay) onCancel(); };
            ok.addEventListener('click', onOk);
            cancel.addEventListener('click', onCancel);
            input.addEventListener('keydown', onKey);
            overlay.addEventListener('click', onBackdrop);
        });
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
    },

    _fmtBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(2) + ' MB';
    },

    _updateBoardsFooter(count, totalBytes) {
        let footer = document.getElementById('boardsModalFooter');
        if (!footer) {
            footer = document.createElement('div');
            footer.id = 'boardsModalFooter';
            footer.className = 'boards-modal-footer';
            document.querySelector('.boards-modal-inner').appendChild(footer);
        }
        footer.textContent = count
            ? `${count} board${count !== 1 ? 's' : ''}  ·  ${this._fmtBytes(totalBytes)} total`
            : 'No boards';
    }
});

// ── HISTORY ───────────────────────────────────────────────────────────────────

Object.assign(App.prototype, {

    _pushHistory(label) {
        if (!this.nodeManager) return;
        const nodeCount = this.nodeManager.nodes.length;
        // Don't push if canvas is empty and last entry was also empty
        if (nodeCount === 0 && this.historyStack.length > 0 && this.historyStack[0].nodeCount === 0) return;

        try {
            const state = this.serializeCanvas();
            this.historyStack.unshift({
                state,
                label,
                timestamp: new Date().toISOString(),
                nodeCount
            });
            // Cap at 30 entries
            if (this.historyStack.length > 30) this.historyStack.pop();
            this.historyCurrentIdx = -1; // reset "browsing" pointer
        } catch (e) {
            console.warn('History snapshot failed:', e);
        }
    },

    async _restoreHistory(idx) {
        const entry = this.historyStack[idx];
        if (!entry) return;
        if (!await this._confirm(`Restore to: "${entry.label}"?\nThis will replace the current canvas.`)) return;

        // Save current state before restoring so user can undo the undo
        this._pushHistory('Before restore');

        this._showLoading('Restoring...');
        try {
            this._clearCanvasImmediate();
            await this.deserializeCanvas(entry.state);
            this.historyCurrentIdx = idx;
            this.uiManager.updateStatus(`Restored: "${entry.label}"`);
        } catch (e) {
            this.uiManager.updateStatus('Restore failed', '#e74c3c');
        } finally {
            this._hideLoading();
        }
    }

});
