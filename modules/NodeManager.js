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
                        const aspectRestoreBtn = node.element.querySelector('.aspect-restore-btn');
                        if (aspectRestoreBtn) aspectRestoreBtn.style.display = data.aspectRatio === 'original' ? 'none' : '';
                    }
                    if (data.resolution) {
                        const resolutionSelect = node.element.querySelector('.resolution-select');
                        if (resolutionSelect) resolutionSelect.value = data.resolution;
                    }
                    if (data.outputFormat) {
                        const outputFormatSelect = node.element.querySelector('.output-format-select');
                        if (outputFormatSelect) outputFormatSelect.value = data.outputFormat;
                    }
                    if (data.model) {
                        const modelSelect = node.element.querySelector('.model-select');
                        if (modelSelect) modelSelect.value = data.model;
                    }
                    // FLUX.2 [flex] params + row visibility
                    const fluxFlexRow = node.element.querySelector('.flux-flex-row');
                    if (fluxFlexRow) {
                        const stepsInput = node.element.querySelector('.flux-steps');
                        const guidanceInput = node.element.querySelector('.flux-guidance');
                        if (stepsInput && data.steps != null) stepsInput.value = data.steps;
                        if (guidanceInput && data.guidance != null) guidanceInput.value = data.guidance;
                        fluxFlexRow.style.display = data.model === 'flux-2-flex' ? '' : 'none';
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
        
        // Update button text
        const ownText = node.type === 'prompt' ? (node.data.prompt || '') : (node.data.action || '');
        const chainSteps = ownText.split('#').map(s => s.trim()).filter(Boolean).length;
        if (chainSteps > 1) {
            generateBtn.textContent = `Generate chain (${chainSteps} steps)`;
        } else if (hasImages) {
            generateBtn.textContent = `Generate (${totalImages} image${totalImages > 1 ? 's' : ''})`;
        } else {
            generateBtn.textContent = 'Generate Image';
        }
        
        // Update model indicator if present
        const modelIndicator = node.element.querySelector('.model-indicator');
        if (modelIndicator && node.data.model) {
            if (node.data.model === 'gemini-3.1-flash-image' || node.data.model === 'gemini-3.1-flash-image-preview') modelIndicator.textContent = 'Nano Banana Flash';
            else if (node.data.model === 'gemini-3-pro-image' || node.data.model === 'gemini-3-pro-image-preview') modelIndicator.textContent = 'Nano Banana Pro';
            else if (node.data.model === 'gemini-2.5-flash-image') modelIndicator.textContent = 'Nano Banana';
            else if (node.data.model === 'imagen-4.0-ultra-generate-001') modelIndicator.textContent = 'Imagen Ultra';
            else if (node.data.model === 'imagen-4.0-fast-generate-001') modelIndicator.textContent = 'Imagen Fast';
            else if (node.data.model === 'gpt-image-2-2026-04-21') modelIndicator.textContent = 'GPT Image 2';
            else if (node.data.model === 'flux-2-pro-preview') modelIndicator.textContent = 'FLUX.2 Pro';
            else if (node.data.model === 'flux-2-pro') modelIndicator.textContent = 'FLUX.2 Pro (fixed)';
            else if (node.data.model === 'flux-2-flex') modelIndicator.textContent = 'FLUX.2 Flex';
            else if (node.data.model === 'flux-2-klein-9b-preview') modelIndicator.textContent = 'FLUX.2 Klein';
            else if (node.data.model === 'flux-2-klein-9b') modelIndicator.textContent = 'FLUX.2 Klein (fixed)';
            else if (node.data.model === 'flux-2-max') modelIndicator.textContent = 'FLUX.2 Max';
            else modelIndicator.textContent = node.data.model;
        }
    }

    _placeResultNode(sourceNode, apiResult, offsetSteps = 0) {
        const existingResults = this.nodes.filter(n =>
            n.type === 'result' && n.data.sourcePromptNode === sourceNode
        );
        const resultX = sourceNode.position.x + sourceNode.element.offsetWidth + 50 + offsetSteps * (400 + 50);
        const resultY = sourceNode.position.y + existingResults.length * 20;
        const resultNode = this.createNode('result', resultX, resultY, {
            imageUrl: apiResult.image,
            sourceNode,
            prompt: apiResult.prompt,
            model: apiResult.model
        });
        this.connectionManager.createConnection(sourceNode.id, resultNode.id, 'output', 'input');
        if (apiResult.creditsRemaining !== undefined) {
            const el = document.getElementById('userCredits');
            if (el) el.textContent = `${apiResult.creditsRemaining} credit${apiResult.creditsRemaining !== 1 ? 's' : ''}`;
        }
        return resultNode;
    }

    async handleGenerateImage(node) {
        // Detect # chain separator in the node's own prompt/action text
        const ownText = node.type === 'prompt' ? (node.data.prompt || '') : (node.data.action || '');
        const chainParts = ownText.split('#').map(s => s.trim()).filter(Boolean);

        if (chainParts.length <= 1) {
            // Normal single generation
            const result = await this.apiManager.generateImage(node);
            if (result.success && result.image) {
                this._placeResultNode(node, result);
                this.uiManager.updateStatus('Image generated!', '#27ae60');
            }
            return;
        }

        // --- Chained generation ---
        const generateBtn = node.element.querySelector('.generate-btn');
        generateBtn.disabled = true;

        // Build prefix from connected prompts (applied to first step only)
        const connectedPrefix = (node.data.connectedPrompts || [])
            .map(p => p.data.prompt?.trim()).filter(Boolean).join(', ');

        // Seed images from connected image nodes
        let currentImageDatas = (node.data.connectedImages || [])
            .map(n => n.data.imageData).filter(Boolean);

        let prevNode = node;
        try {
            for (let i = 0; i < chainParts.length; i++) {
                const stepPrompt = (i === 0 && connectedPrefix)
                    ? `${connectedPrefix}, ${chainParts[i]}`
                    : chainParts[i];

                this.uiManager.updateStatus(
                    `Chain ${i + 1}/${chainParts.length}: ${stepPrompt.slice(0, 50)}…`, '#667eea');
                generateBtn.innerHTML = `<span class="loading"></span> ${i + 1}/${chainParts.length}`;

                const { sourceWidth, sourceHeight } = this.apiManager._sourceDimensions(node);
                const apiResult = await this.apiManager.callAPI(
                    stepPrompt, currentImageDatas,
                    node.data.model, node.data.aspectRatio || 'original',
                    node.data.resolution || 'hd', node.data.outputFormat || 'jpg',
                    node.data.steps, node.data.guidance,
                    sourceWidth, sourceHeight
                );
                apiResult.prompt = stepPrompt;
                apiResult.model = node.data.model;

                const resultNode = this._placeResultNode(prevNode, apiResult, i === 0 ? 0 : 0);
                prevNode = resultNode;
            }
            this.uiManager.updateStatus('Chain complete!', '#27ae60');
        } catch (err) {
            this.uiManager.updateStatus(`Chain failed: ${err.message}`, '#e74c3c');
            alert(`Chain generation failed: ${err.message}`);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = chainParts.length > 1
                ? `Generate (${chainParts.length} steps)`
                : 'Generate Image';
            this.updateGenerateButton(node);
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

                // Show metadata overlay if recovered from PNG — visible by default, click to hide
                if (meta.prompt || meta.model) {
                    const metaEl = document.createElement('div');
                    metaEl.className = 'result-meta result-meta-has-data result-meta-visible';
                    metaEl.innerHTML = `
                        <div class="result-meta-prompt">${meta.prompt || ''}</div>
                        <div class="result-meta-model">${meta.model || ''}</div>
                        <button class="result-meta-copy" title="Copy prompt">copy</button>
                    `;
                    metaEl.querySelector('.result-meta-copy').addEventListener('click', (e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(meta.prompt || '').then(() => {
                            const btn = e.currentTarget;
                            btn.textContent = 'copied';
                            setTimeout(() => { btn.textContent = 'copy'; }, 1500);
                        });
                    });
                    wrapper.appendChild(metaEl);
                    img.addEventListener('click', () => metaEl.classList.toggle('result-meta-visible'));
                }

                content.appendChild(wrapper);
                this._setupDrawOverlay(node, wrapper);
                this._setupImageTextInput(node, content, node.data.overlayText);

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
            <button class="icon-btn draw-toggle-btn" title="Draw / Annotate">✏</button>
            <button class="icon-btn node-clone" title="Clone Node">⎘</button>
        `;
        // Append inside image-wrapper so the overlay sits on the image
        const wrapper = container.querySelector('.image-wrapper') || container;
        wrapper.appendChild(actionButtons);

        actionButtons.querySelector('.node-clone').addEventListener('click', () => this.cloneNode(node.id));
        const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
        const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
        const stdBtn = actionButtons.querySelector('.icon-btn-std');
        const drawBtn = actionButtons.querySelector('.draw-toggle-btn');

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

        drawBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const on = drawBtn.classList.toggle('active');
            if (node._drawToggle) node._drawToggle(on);
        });
    }

    _setupDrawOverlay(node, wrapper) {
        const img = wrapper.querySelector('img') || node.data.image;
        if (!img) return;

        const oc = document.createElement('canvas');
        oc.className = 'draw-overlay';
        oc.width = img.naturalWidth || 800;
        oc.height = img.naturalHeight || 600;
        wrapper.appendChild(oc);
        node.data.drawCanvas = oc;

        // Restore saved mask
        if (node.data.maskData) {
            const mi = new Image();
            mi.onload = () => oc.getContext('2d').drawImage(mi, 0, 0);
            mi.src = node.data.maskData;
        }

        // Toolbar
        const tb = document.createElement('div');
        tb.className = 'draw-toolbar';
        tb.innerHTML = `
            <button class="draw-tool active" data-tool="brush" title="Brush">✏</button>
            <button class="draw-tool" data-tool="text" title="Text">T</button>
            <button class="draw-tool" data-tool="eraser" title="Eraser">◫</button>
            <input class="draw-color" type="color" value="#ff3300">
            <input class="draw-size" type="range" min="2" max="80" value="12">
            <button class="draw-clear" title="Clear all">✕</button>
        `;
        wrapper.appendChild(tb);

        let drawing = false, tool = 'brush', color = '#ff3300', size = 12, lx, ly;
        const ctx = oc.getContext('2d');

        const canvasPos = (e) => {
            const r = oc.getBoundingClientRect();
            return { x: (e.clientX - r.left) * oc.width / r.width, y: (e.clientY - r.top) * oc.height / r.height };
        };
        const save = () => { node.data.maskData = oc.toDataURL('image/png'); };

        const placeText = (e) => {
            const p = canvasPos(e);
            const r = oc.getBoundingClientRect();
            const scaleX = r.width / oc.width, scaleY = r.height / oc.height;
            const inp = document.createElement('input');
            inp.className = 'draw-text-input';
            inp.style.cssText = `left:${r.left + p.x * scaleX}px;top:${r.top + p.y * scaleY}px;font-size:${size * 2 * scaleX}px;color:${color};`;
            document.body.appendChild(inp);
            inp.focus();
            const commit = () => {
                const t = inp.value.trim();
                if (t) {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.font = `bold ${size * 2}px sans-serif`;
                    ctx.fillStyle = color;
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = size * 0.5;
                    ctx.fillText(t, p.x, p.y);
                    ctx.shadowBlur = 0;
                    save();
                }
                inp.remove();
            };
            inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') inp.remove(); });
            inp.addEventListener('blur', commit, { once: true });
        };

        oc.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (tool === 'text') { placeText(e); return; }
            drawing = true;
            const p = canvasPos(e);
            lx = p.x; ly = p.y;
            ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.beginPath();
            ctx.arc(lx, ly, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });

        oc.addEventListener('mousemove', (e) => {
            if (!drawing) return;
            const p = canvasPos(e);
            ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
            lx = p.x; ly = p.y;
        });

        const endDraw = () => { if (drawing) { drawing = false; save(); } };
        oc.addEventListener('mouseup', endDraw);
        oc.addEventListener('mouseleave', endDraw);

        tb.querySelectorAll('.draw-tool').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            tool = b.dataset.tool;
            tb.querySelectorAll('.draw-tool').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            oc.style.cursor = tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';
        }));

        tb.querySelector('.draw-color').addEventListener('input', (e) => { color = e.target.value; e.stopPropagation(); });
        tb.querySelector('.draw-size').addEventListener('input', (e) => { size = +e.target.value; e.stopPropagation(); });
        tb.querySelector('.draw-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            ctx.clearRect(0, 0, oc.width, oc.height);
            node.data.maskData = null;
        });

        // Called by the draw toggle button
        node._drawToggle = (on) => {
            oc.style.pointerEvents = on ? 'all' : 'none';
            oc.style.cursor = on ? 'crosshair' : '';
            tb.classList.toggle('active', on);
        };
    }

    copySelectedNodes() {
        const ids = this.selectedNodes.size > 0
            ? [...this.selectedNodes]
            : (this.draggedNode ? [this.draggedNode.id] : []);
        if (!ids.length) return;
        this._clipboard = ids.map(id => {
            const n = this.nodes.find(nd => nd.id === id);
            return n ? { id, x: n.position.x, y: n.position.y } : null;
        }).filter(Boolean);
        this._pasteOffset = 1;
        this.uiManager.updateStatus(`Copied ${this._clipboard.length} node${this._clipboard.length > 1 ? 's' : ''}`, '#667eea');
    }

    pasteNodes() {
        if (!this._clipboard?.length) return;
        const offset = 30 * this._pasteOffset;
        this.clearSelection();
        for (const entry of this._clipboard) {
            const original = this.nodes.find(n => n.id === entry.id);
            if (!original) continue;
            // Temporarily move original to paste position, clone, then restore
            const savedX = original.position.x;
            const savedY = original.position.y;
            original.position.x = entry.x + offset;
            original.position.y = entry.y + offset;
            this.cloneNode(entry.id);
            original.position.x = savedX;
            original.position.y = savedY;
            // Select the new node (last created)
            const newNode = this.nodes[this.nodes.length - 1];
            if (newNode) {
                this.selectedNodes.add(newNode.id);
                newNode.element.classList.add('selected');
            }
        }
        this._pasteOffset++;
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
                    if (originalNode.data.overlayText) {
                        newNode.data.overlayText = originalNode.data.overlayText;
                    }
                    this._setupImageTextInput(newNode, content, newNode.data.overlayText);
                    this.addNodeActionButtons(newNode, content);
                }
                break;
            case 'prompt':
                newNode = this.createNode('prompt', newPosition.x, newPosition.y);
                newNode.data.prompt = originalNode.data.prompt;
                newNode.element.querySelector('textarea').value = originalNode.data.prompt;
                newNode.data.aspectRatio = originalNode.data.aspectRatio;
                newNode.element.querySelector('.aspect-ratio-select').value = originalNode.data.aspectRatio;
                const clonedRestoreBtn = newNode.element.querySelector('.aspect-restore-btn');
                if (clonedRestoreBtn) clonedRestoreBtn.style.display = originalNode.data.aspectRatio === 'original' ? 'none' : '';
                if (originalNode.data.resolution) {
                    newNode.data.resolution = originalNode.data.resolution;
                    const resEl = newNode.element.querySelector('.resolution-select');
                    if (resEl) resEl.value = originalNode.data.resolution;
                }
                if (originalNode.data.outputFormat) {
                    newNode.data.outputFormat = originalNode.data.outputFormat;
                    const fmtEl = newNode.element.querySelector('.output-format-select');
                    if (fmtEl) fmtEl.value = originalNode.data.outputFormat;
                }
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

    _setupImageTextInput(node, content, initialText = '') {
        // Remove any existing text row
        const existing = content.querySelector('.image-text-row');
        if (existing) existing.remove();

        const row = document.createElement('div');
        row.className = 'image-text-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'image-text-input';
        input.placeholder = 'Add text overlay…';
        input.value = initialText || '';
        row.appendChild(input);
        content.appendChild(row);

        if (initialText) this._updateTextOverlay(content, initialText);

        input.addEventListener('input', (e) => {
            node.data.overlayText = e.target.value;
            this._updateTextOverlay(content, e.target.value);
        });
        // Prevent canvas drag when typing
        input.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    _updateTextOverlay(content, text) {
        const wrapper = content.querySelector('.image-wrapper');
        if (!wrapper) return;
        let overlay = wrapper.querySelector('.image-text-preview');
        if (!text?.trim()) {
            if (overlay) overlay.remove();
            return;
        }
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'image-text-preview';
            wrapper.appendChild(overlay);
        }
        overlay.textContent = text;
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
        if (!dataUrl || !dataUrl.startsWith('data:image/png')) return {};
        try {
            const b64 = dataUrl.split(',')[1];
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

            const sig = [137,80,78,71,13,10,26,10];
            if (!sig.every((b, i) => bytes[i] === b)) return {};

            const result = {};
            let pos = 8;
            const dec = new TextDecoder();
            let chunkIdx = 0;
            while (pos + 12 <= bytes.length) {
                const len = ((bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3]) >>> 0;
                const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
                if (chunkIdx < 6) console.log(`[readPNG] #${chunkIdx} @${pos} type="${type}" len=${len}`);
                chunkIdx++;
                if (type === 'IDAT' || type === 'IEND') break;
                if (type === 'iTXt' && len > 0) {
                    const data = bytes.subarray(pos + 8, pos + 8 + len);
                    const kwEnd = data.indexOf(0);
                    if (kwEnd >= 0) {
                        const keyword = dec.decode(data.subarray(0, kwEnd));
                        const textStart = kwEnd + 5;
                        const text = textStart < data.length ? dec.decode(data.subarray(textStart)) : '';
                        result[keyword] = text;
                    }
                }
                pos += 12 + len;
            }
            if (Object.keys(result).length) console.log('[readPNG] found:', result.prompt?.slice(0,40));
            else console.warn('[readPNG] no iTXt found, stopped at chunk #' + chunkIdx);
            return result;
        } catch (e) {
            console.warn('[readPNG] error:', e);
            return {};
        }
    }

    async downloadImage(data, filename, metadata = {}) {
        // Always re-encode through canvas to guarantee valid PNG bytes.
        // Skipping this when header says image/png is unsafe — server historically
        // returned JPEG bytes with a image/png MIME type (now fixed), so old result
        // nodes may have mismatched headers that corrupt the downloaded file.
        const pngData = await new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                resolve(c.toDataURL('image/png'));
            };
            img.src = data;
        });

        let finalData = pngData;
        if (metadata.prompt || metadata.model) {
            try {
                finalData = this._embedPNGMetadata(pngData, metadata);
                console.log('[download] embedded metadata — prompt:', metadata.prompt?.slice(0, 40), '| bytes:', pngData.length, '->', finalData.length);
            } catch (e) {
                console.warn('[download] metadata embed failed:', e);
            }
        } else {
            console.warn('[download] no metadata to embed — prompt:', metadata.prompt, 'model:', metadata.model);
        }

        // Use Blob URL — data URLs can be saved as text in Chrome for large files
        try {
            const b64 = finalData.split(',')[1];
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename.replace(/\.[^.]+$/, '') + '.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch (e) {
            console.warn('[download] blob fallback:', e);
            const link = document.createElement('a');
            link.href = finalData;
            link.download = filename;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        }
    }

    updateDrawNodeImage(node) {
        if (node.type !== 'draw' || !node.data.canvas) return;
        node.data.imageData = node.data.canvas.toDataURL('image/png');
        node.data.originalWidth = node.data.canvas.width;
        node.data.originalHeight = node.data.canvas.height;
    }
}
