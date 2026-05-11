import { ImageNode } from '../nodes/ImageNode.js';
import { PromptNode } from '../nodes/PromptNode.js';
import { ActionNode } from '../nodes/ActionNode.js';
import { DrawNode } from '../nodes/DrawNode.js';
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
        this.multiDragOffsets = new Map(); // nodeId -> {x, y}

        // Resizing state
        this.isResizing = false;
        this.resizedNode = null;
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0, imageWidth: 0 };

        // Multi-select state
        this.selectedNodes = new Set(); // set of node IDs
        this.isMarquee = false;
        this.marqueeStart = { x: 0, y: 0 };
        this.marqueeEl = null;
    }

    init() {
        this.setupGlobalEvents();
        this.setupMarquee();
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
            openLightbox: (src) => this.uiManager.openLightbox(src),
            downloadImage: (src, name, meta) => this.downloadImage(src, name, meta),
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
            case 'result': {
                const imgData = data?.imageUrl || data?.imageData;
                node = new ResultNode().create(nodeId, x, y, imgData, data?.sourceNode, callbacks);
                if (node) {
                    if (data?.prompt) node.data.prompt = data.prompt;
                    if (data?.model)  node.data.model  = data.model;
                    node.updateMeta?.();
                }
                break;
            }
        }

        if (node) {
            // Restore data if provided (e.g. from load or clone)
            if (data) {
                Object.assign(node.data, data);
                
                // Update UI based on restored data
                if (type === 'prompt') {
                    if (data.prompt) node.element.querySelector('textarea').value = data.prompt;
                    if (data.aspectRatio) {
                        const aspectRatioSelect = node.element.querySelector('.aspect-ratio-select');
                        if (aspectRatioSelect) aspectRatioSelect.value = data.aspectRatio;
                    }
                    if (data.model) {
                        const modelSelect = node.element.querySelector('.model-select');
                        if (modelSelect) modelSelect.value = data.model;
                    }
                    this.updateGenerateButton(node);
                } else if (type === 'action') {
                    if (data.action) {
                        const actionSelect = node.element.querySelector('.action-select');
                        if (actionSelect) actionSelect.value = data.action;
                    }
                    this.updateGenerateButton(node);
                }
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
        this.selectedNodes.delete(nodeId);

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
        if (e.shiftKey) {
            // Shift-click: toggle this node in selection, don't drag
            if (this.selectedNodes.has(node.id)) {
                this.selectedNodes.delete(node.id);
                node.element.classList.remove('selected');
            } else {
                this.selectedNodes.add(node.id);
                node.element.classList.add('selected');
            }
            return;
        }

        // If clicking a node that isn't selected, clear selection and select only this one
        if (!this.selectedNodes.has(node.id)) {
            this.clearSelection();
            this.selectedNodes.add(node.id);
            node.element.classList.add('selected');
        }

        this.isDragging = true;
        this.draggedNode = node;

        const container = this.canvasManager.container.getBoundingClientRect();
        const zoom = this.canvasManager.zoom;
        const panX = this.canvasManager.panX;
        const panY = this.canvasManager.panY;

        const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
        const mouseCanvasY = (e.clientY - container.top) / zoom - panY;

        // Store per-node drag offsets for all selected nodes
        this.multiDragOffsets.clear();
        for (const id of this.selectedNodes) {
            const n = this.nodes.find(nd => nd.id === id);
            if (n) {
                this.multiDragOffsets.set(id, {
                    x: mouseCanvasX - n.position.x,
                    y: mouseCanvasY - n.position.y
                });
            }
        }

        this.dragOffset.x = mouseCanvasX - node.position.x;
        this.dragOffset.y = mouseCanvasY - node.position.y;
        node.element.style.zIndex = 1000;
    }

    clearSelection() {
        for (const id of this.selectedNodes) {
            const n = this.nodes.find(nd => nd.id === id);
            if (n) n.element.classList.remove('selected');
        }
        this.selectedNodes.clear();
    }

    handleMouseMove(e) {
        if (this.isResizing && this.resizedNode) {
            const zoom = this.canvasManager.zoom;
            const deltaX = (e.clientX - this.resizeStart.x) / zoom;
            const newWidth = Math.max(200, this.resizeStart.width + deltaX);
            this.resizedNode.element.style.width = `${newWidth}px`;

            // Prompt nodes also resize vertically
            if (this.resizedNode.type === 'prompt') {
                const deltaY = (e.clientY - this.resizeStart.y) / zoom;
                const newHeight = Math.max(180, this.resizeStart.height + deltaY);
                this.resizedNode.element.style.height = `${newHeight}px`;
            }

            this.connectionManager.drawConnections();
            return;
        }

        if (this.isDragging && this.draggedNode) {
            const container = this.canvasManager.container.getBoundingClientRect();
            const zoom = this.canvasManager.zoom;
            const panX = this.canvasManager.panX;
            const panY = this.canvasManager.panY;

            const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
            const mouseCanvasY = (e.clientY - container.top) / zoom - panY;

            // Move all selected nodes together
            for (const id of this.selectedNodes) {
                const n = this.nodes.find(nd => nd.id === id);
                const offset = this.multiDragOffsets.get(id);
                if (n && offset) {
                    n.position.x = mouseCanvasX - offset.x;
                    n.position.y = mouseCanvasY - offset.y;
                    n.element.style.left = `${n.position.x}px`;
                    n.element.style.top = `${n.position.y}px`;
                }
            }

            this.connectionManager.drawConnections();
        }

        // Update marquee rect
        if (this.isMarquee && this.marqueeEl) {
            const container = this.canvasManager.container.getBoundingClientRect();
            const x1 = Math.min(this.marqueeStart.x, e.clientX) - container.left;
            const y1 = Math.min(this.marqueeStart.y, e.clientY) - container.top;
            const w = Math.abs(e.clientX - this.marqueeStart.x);
            const h = Math.abs(e.clientY - this.marqueeStart.y);
            this.marqueeEl.style.left   = x1 + 'px';
            this.marqueeEl.style.top    = y1 + 'px';
            this.marqueeEl.style.width  = w + 'px';
            this.marqueeEl.style.height = h + 'px';
        }
    }

    handleMouseUp(e) {
        if (this.isResizing) {
            if (this.resizedNode) {
                // Persist final width for serialization
                this.resizedNode.data.nodeWidth = this.resizedNode.element.offsetWidth;
                if (this.resizedNode.type === 'prompt') {
                    this.resizedNode.data.nodeHeight = this.resizedNode.element.offsetHeight;
                }
            }
            this.isResizing = false;
            this.resizedNode = null;
        }

        if (this.isDragging && this.draggedNode) {
            this.draggedNode.element.style.zIndex = '';
        }
        this.isDragging = false;
        this.draggedNode = null;

        // Finish marquee selection
        if (this.isMarquee) {
            this.isMarquee = false;
            if (this.marqueeEl) {
                this.marqueeEl.style.display = 'none';
                this.marqueeEl.style.width = '0';
                this.marqueeEl.style.height = '0';
            }
            // Only select if the marquee had meaningful size (avoid accidental tiny drags)
            const w = Math.abs(e.clientX - this.marqueeStart.x);
            const h = Math.abs(e.clientY - this.marqueeStart.y);
            if (w > 6 || h > 6) {
                this._selectNodesInMarquee(e);
            } else {
                // Plain click on empty canvas — clear selection
                this.clearSelection();
            }
        }
    }

    setupMarquee() {
        const canvas = document.getElementById('connectionCanvas');
        const container = document.querySelector('.canvas-container');
        if (!canvas || !container) return;

        // Create marquee overlay element
        this.marqueeEl = document.createElement('div');
        this.marqueeEl.className = 'marquee-rect';
        container.appendChild(this.marqueeEl);

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (this.connectionManager.isConnecting) return;
            if (this.canvasManager.isSpaceDown) return;
            e.preventDefault();
            this.isMarquee = true;
            this.marqueeStart = { x: e.clientX, y: e.clientY };
            const rect = container.getBoundingClientRect();
            this.marqueeEl.style.left   = (e.clientX - rect.left) + 'px';
            this.marqueeEl.style.top    = (e.clientY - rect.top) + 'px';
            this.marqueeEl.style.width  = '0';
            this.marqueeEl.style.height = '0';
            this.marqueeEl.style.display = 'block';
        });
    }

    _selectNodesInMarquee(upEvent) {
        const container = this.canvasManager.container.getBoundingClientRect();
        const zoom = this.canvasManager.zoom;
        const panX = this.canvasManager.panX;
        const panY = this.canvasManager.panY;

        // Marquee bounds in screen coords → canvas coords
        const sx1 = Math.min(this.marqueeStart.x, upEvent.clientX);
        const sy1 = Math.min(this.marqueeStart.y, upEvent.clientY);
        const sx2 = Math.max(this.marqueeStart.x, upEvent.clientX);
        const sy2 = Math.max(this.marqueeStart.y, upEvent.clientY);

        const cx1 = (sx1 - container.left) / zoom - panX;
        const cy1 = (sy1 - container.top)  / zoom - panY;
        const cx2 = (sx2 - container.left) / zoom - panX;
        const cy2 = (sy2 - container.top)  / zoom - panY;

        if (!upEvent.shiftKey) this.clearSelection();

        for (const n of this.nodes) {
            const nx1 = n.position.x;
            const ny1 = n.position.y;
            const nx2 = nx1 + (n.element ? n.element.offsetWidth  : 220);
            const ny2 = ny1 + (n.element ? n.element.offsetHeight : 120);
            // Overlap test
            if (nx2 > cx1 && nx1 < cx2 && ny2 > cy1 && ny1 < cy2) {
                this.selectedNodes.add(n.id);
                n.element.classList.add('selected');
            }
        }
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
        
        // Update model indicator if present
        const modelIndicator = node.element.querySelector('.model-indicator');
        if (modelIndicator && node.data.model) {
            if (node.data.model === 'gemini-3.1-flash-image-preview') modelIndicator.textContent = 'Nano Banana Flash';
            else if (node.data.model === 'gemini-3-pro-image-preview') modelIndicator.textContent = 'Nano Banana Pro';
            else if (node.data.model === 'imagen-4.0-ultra-generate-001') modelIndicator.textContent = 'Imagen Ultra';
            else if (node.data.model === 'imagen-4.0-fast-generate-001') modelIndicator.textContent = 'Imagen Fast';
            else modelIndicator.textContent = node.data.model;
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

            // Count existing result nodes for this source to offset new ones
            const existingResults = this.nodes.filter(n =>
                n.type === 'result' && n.data.sourcePromptNode === node
            );
            const offsetY = existingResults.length * 20;

            // Always create a new result node
            const resultNode = this.createNode('result', resultX, resultY + offsetY, {
                imageUrl: result.image,
                sourceNode: node,
                prompt: result.prompt,
                model: result.model
            });
            node.data.resultNode = resultNode;

            // Auto-connect
            this.connectionManager.createConnection(node.id, resultNode.id, 'output', 'input');
            
            // Update credits display
            if (result.creditsRemaining !== undefined) {
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    userCredits.textContent = `${result.creditsRemaining} credit${result.creditsRemaining !== 1 ? 's' : ''}`;
                }
            }
            
            this.uiManager.updateStatus('Image generated!', '#27ae60');
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
            img.draggable = false;
            img.addEventListener('dragstart', (ev) => ev.preventDefault());
            img.onload = () => {
                node.data.image = img;
                node.data.imageData = e.target.result;
                node.data.originalWidth = img.naturalWidth;
                node.data.originalHeight = img.naturalHeight;
                node.data.imageWidth = null;
                node.element.style.width = '400px';

                // Read embedded iTXt metadata (prompt/model) if present
                const meta = this._readPNGMetadata(e.target.result);
                if (meta.prompt) node.data.prompt = meta.prompt;
                if (meta.model)  node.data.model  = meta.model;

                // Update DOM
                const content = node.element.querySelector('.node-content');
                content.innerHTML = ''; // Clear dropzone

                const wrapper = document.createElement('div');
                wrapper.className = 'image-wrapper';
                wrapper.appendChild(img);

                // Show metadata overlay if recovered from PNG
                if (meta.prompt || meta.model) {
                    const metaEl = document.createElement('div');
                    metaEl.className = 'result-meta result-meta-has-data';
                    metaEl.innerHTML = `
                        <div class="result-meta-prompt">${meta.prompt || ''}</div>
                        <div class="result-meta-model">${meta.model || ''}</div>
                    `;
                    wrapper.appendChild(metaEl);
                    img.addEventListener('click', () => metaEl.classList.toggle('result-meta-visible'));
                }

                content.appendChild(wrapper);

                // Show clear button
                const clearBtn = node.element.querySelector('.clear-button');
                if (clearBtn) clearBtn.style.display = '';

                // Add action buttons as hover overlay
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
            <button class="icon-btn" title="Download">↓</button>
            <button class="icon-btn icon-btn-std" title="Reset to standard size">⊡</button>
            <button class="icon-btn node-clone" title="Clone Node">⎘</button>
        `;
        // Append inside image-wrapper so the overlay sits on the image
        const wrapper = container.querySelector('.image-wrapper') || container;
        wrapper.appendChild(actionButtons);

        actionButtons.querySelector('.node-clone').addEventListener('click', () => this.cloneNode(node.id));
        const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
        const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
        const stdBtn = actionButtons.querySelector('.icon-btn-std');

        lightboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.uiManager.openLightbox(node.data.imageData);
        });

        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(node.data.imageData, 'image.png', {
                prompt: node.data.prompt,
                model: node.data.model
            });
        });

        stdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.element.style.width = '400px';
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

    _crc32(buf) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc ^= buf[i];
            for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    _makePNGiTXtChunk(keyword, text) {
        const enc = new TextEncoder();
        const kw = enc.encode(keyword);
        const tx = enc.encode(text);
        // iTXt: keyword + \0 + comp_flag(0) + comp_method(0) + lang\0 + translated_kw\0 + text
        const data = new Uint8Array(kw.length + 5 + tx.length);
        data.set(kw, 0);
        // bytes kw.length+0..+4 are already 0 (null, flags, empty lang, empty translated kw)
        data.set(tx, kw.length + 5);
        const type = new Uint8Array([0x69, 0x54, 0x58, 0x74]); // "iTXt"
        const chunk = new Uint8Array(4 + 4 + data.length + 4);
        const view = new DataView(chunk.buffer);
        view.setUint32(0, data.length, false);
        chunk.set(type, 4);
        chunk.set(data, 8);
        const crcInput = new Uint8Array(type.length + data.length);
        crcInput.set(type, 0); crcInput.set(data, 4);
        view.setUint32(8 + data.length, this._crc32(crcInput), false);
        return chunk;
    }

    _embedPNGMetadata(dataUrl, metadata) {
        if (!dataUrl || !dataUrl.startsWith('data:image/png')) return dataUrl;
        const b64 = dataUrl.split(',')[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const chunks = [];
        if (metadata.prompt) chunks.push(this._makePNGiTXtChunk('prompt', metadata.prompt));
        if (metadata.model)  chunks.push(this._makePNGiTXtChunk('model',  metadata.model));
        if (!chunks.length) return dataUrl;

        // Insert after IHDR (8 sig + 4 len + 4 type + 13 data + 4 crc = 33 bytes)
        const insertAt = 33;
        const extra = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(bytes.length + extra);
        out.set(bytes.slice(0, insertAt), 0);
        let off = insertAt;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        out.set(bytes.slice(insertAt), off);

        let outBin = '';
        const CHUNK = 65536;
        for (let i = 0; i < out.length; i += CHUNK) {
            outBin += String.fromCharCode.apply(null, out.subarray(i, i + CHUNK));
        }
        return 'data:image/png;base64,' + btoa(outBin);
    }

    _readPNGMetadata(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
            console.log('[readPNGMeta] skipped — not PNG:', dataUrl?.slice(0, 30));
            return {};
        }
        try {
            const b64 = dataUrl.split(',')[1];
            // Only decode first 2KB — our iTXt chunks sit right after IHDR (byte 33)
            // 2KB covers prompts up to ~1900 chars which is plenty
            const b64Slice = b64.slice(0, 2732); // 2048 bytes * 4/3 rounded up to mult of 4
            const bin = atob(b64Slice);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

            const result = {};
            let pos = 8; // skip PNG signature
            const dec = new TextDecoder();
            while (pos + 12 <= bytes.length) {
                const len = ((bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3]) >>> 0;
                const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
                if (type === 'iTXt' && len > 0 && pos + 8 + len <= bytes.length) {
                    const data = bytes.subarray(pos + 8, pos + 8 + len);
                    const kwEnd = data.indexOf(0);
                    if (kwEnd >= 0) {
                        const keyword = dec.decode(data.subarray(0, kwEnd));
                        const textStart = kwEnd + 5; // null + comp_flag + comp_method + lang\0 + translated_kw\0
                        if (textStart < data.length) {
                            result[keyword] = dec.decode(data.subarray(textStart));
                        }
                    }
                }
                if (type === 'IEND' || type === 'IDAT') break; // stop at image data
                pos += 12 + len;
            }
            console.log('[readPNGMeta] result:', result);
            return result;
        } catch (e) {
            console.warn('[readPNGMeta] failed:', e);
            return {};
        }
    }

    downloadImage(data, filename, metadata = {}) {
        let finalData = data;
        if (metadata.prompt || metadata.model) {
            try {
                finalData = this._embedPNGMetadata(data, metadata);
                console.log('[download] PNG metadata embedded — prompt:', metadata.prompt?.slice(0, 60));
            } catch (e) {
                console.warn('[download] PNG metadata embedding failed, downloading without:', e);
            }
        } else {
            console.log('[download] No metadata to embed (prompt:', metadata.prompt, ', model:', metadata.model, ')');
        }
        const link = document.createElement('a');
        link.href = finalData;
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
