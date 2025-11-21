import { dataURLtoFile, compressImage } from './Utils.js';

export class CanvasManager {
    constructor(callbacks) {
        this.nodeCanvas = document.getElementById('nodeCanvas');
        this.connectionCanvas = document.getElementById('connectionCanvas');
        this.ctx = this.connectionCanvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimapCanvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        this.minimapViewport = document.getElementById('minimapViewport');
        this.canvasContainer = document.querySelector('.canvas-container');
        this.toolbar = document.querySelector('.toolbar-overlay');

        this.callbacks = callbacks || {};

        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };

        this.isDragging = false;
        this.draggedNode = null;
        this.dragOffset = { x: 0, y: 0 };

        this.isConnecting = false;
        this.connectionStart = null;
        this.tempConnectionEnd = { x: 0, y: 0 };

        this.isResizing = false;
        this.resizedNode = null;
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0, imageWidth: 0 };

        this.isMiddlePanning = false;
        this.middlePanStart = { x: 0, y: 0 };

        this.isToolbarDragging = false;
        this.toolbarDragStart = { x: 0, y: 0 };
        this.toolbarPosition = { x: 20, y: 180 };

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.setupZoomControls();
        this.setupPanControls();
        this.setupGlobalMouseEvents();
        this.setupToolbarDragging();
        this.setupMinimap();
        this.setupContextMenus();
    }

    resizeCanvas() {
        this.connectionCanvas.width = this.canvasContainer.clientWidth;
        this.connectionCanvas.height = this.canvasContainer.clientHeight;
        this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
    }

    applyZoom() {
        const transform = `scale(${this.zoom}) translate(${this.panX}px, ${this.panY}px)`;
        this.nodeCanvas.style.transform = transform;
        this.nodeCanvas.style.transformOrigin = '0 0';
        
        this.connectionCanvas.style.transform = 'none';
        
        const baseSize1 = 100;
        const baseSize2 = 20;
        this.canvasContainer.style.backgroundSize = `${baseSize1 * this.zoom}px ${baseSize1 * this.zoom}px, ${baseSize2 * this.zoom}px ${baseSize2 * this.zoom}px`;
        this.canvasContainer.style.backgroundPosition = `${this.panX * this.zoom}px ${this.panY * this.zoom}px`;
        
        this.updateZoomLevel();
        this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
        this.updateMinimap(this.callbacks.getNodes(), this.callbacks.getConnections());
    }

    setZoom(newZoom) {
        this.zoom = Math.max(0.1, Math.min(3, newZoom));
        this.applyZoom();
    }

    updateZoomLevel() {
        const zoomLevelEl = document.getElementById('zoomLevel');
        if (zoomLevelEl) {
            zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    setupZoomControls() {
        document.getElementById('zoomIn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        document.getElementById('zoomOut')?.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        document.getElementById('zoomReset')?.addEventListener('click', () => {
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.applyZoom();
        });

        this.canvasContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = this.canvasContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const canvasX = mouseX / this.zoom - this.panX;
            const canvasY = mouseY / this.zoom - this.panY;
            
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Math.max(0.1, Math.min(3, this.zoom + delta));
            
            this.panX = mouseX / newZoom - canvasX;
            this.panY = mouseY / newZoom - canvasY;
            
            this.zoom = newZoom;
            this.applyZoom();
        }, { passive: false });
    }

    setupPanControls() {
        this.canvasContainer.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Middle mouse button
                e.preventDefault();
                this.isMiddlePanning = true;
                this.middlePanStart = { x: e.clientX, y: e.clientY };
                this.canvasContainer.style.cursor = 'grabbing';
            }
        });
    }

    setupToolbarDragging() {
        this.toolbar.style.left = `${this.toolbarPosition.x}px`;
        this.toolbar.style.top = `${this.toolbarPosition.y}px`;
        this.toolbar.style.transform = 'none';

        this.toolbar.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
                return;
            }
            
            this.isToolbarDragging = true;
            this.toolbarDragStart.x = e.clientX - this.toolbarPosition.x;
            this.toolbarDragStart.y = e.clientY - this.toolbarPosition.y;
            this.toolbar.style.cursor = 'grabbing';
            e.preventDefault();
        });
    }

    setupContextMenus() {
        const contextMenu = document.getElementById('contextMenu');
        let contextMenuPosition = { x: 0, y: 0 };

        this.canvasContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            const rect = this.canvasContainer.getBoundingClientRect();
            contextMenuPosition.x = (e.clientX - rect.left) / this.zoom - this.panX;
            contextMenuPosition.y = (e.clientY - rect.top) / this.zoom - this.panY;
            
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.style.top = `${e.clientY}px`;
            contextMenu.classList.add('active');
            
            contextMenu.dataset.isConnectionMenu = 'false';
        });

        contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                
                if (this.callbacks.createNode) {
                    const newNode = this.callbacks.createNode(action, contextMenuPosition.x, contextMenuPosition.y);
                    
                    if (contextMenu.dataset.isConnectionMenu === 'true' && newNode && this.connectionStart) {
                        const fromNodeId = this.connectionStart.nodeId;
                        const toNodeId = newNode.id;
                        const fromType = this.connectionStart.type;
                        const toType = fromType === 'output' ? 'input' : 'output';
                        
                        if (this.callbacks.createConnection) {
                            this.callbacks.createConnection(fromNodeId, toNodeId, fromType, toType);
                        }
                    }
                }

                contextMenu.classList.remove('active');
                contextMenu.dataset.isConnectionMenu = 'false';
                this.connectionStart = null;
                this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
            });
        });

        document.addEventListener('click', (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.classList.remove('active');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && contextMenu.classList.contains('active')) {
                contextMenu.classList.remove('active');
            }
        });
    }

    showConnectionMenu(x, y) {
        const contextMenu = document.getElementById('contextMenu');
        const rect = this.canvasContainer.getBoundingClientRect();
        
        // Set position for node creation (canvas coordinates)
        // We need to store this somewhere accessible to the context menu handler
        // Re-using the closure variable from setupContextMenus won't work easily across methods
        // So we'll calculate it again in the handler or store it on the instance if needed
        // For now, let's just set the visual position
        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.add('active');
        contextMenu.dataset.isConnectionMenu = 'true';
    }

    setupGlobalMouseEvents() {
        document.addEventListener('mousemove', (e) => {
            // Handle Node Resizing
            if (this.isResizing && this.resizedNode) {
                const deltaX = (e.clientX - this.resizeStart.x) / this.zoom;
                const newWidth = Math.max(250, this.resizeStart.width + deltaX);
                
                this.resizedNode.element.style.width = `${newWidth}px`;
                
                if (this.resizedNode.data.image && this.resizedNode.data.imageData) {
                    const scaleFactor = newWidth / this.resizeStart.width;
                    const newImageWidth = Math.round(this.resizeStart.imageWidth * scaleFactor);
                    
                    this.resizedNode.data.imageWidth = newImageWidth;
                    const img = this.resizedNode.data.image;
                    img.style.width = `${newImageWidth}px`;
                    
                    const scaleIndicator = this.resizedNode.element.querySelector('.scale-indicator');
                    if (scaleIndicator) {
                        scaleIndicator.textContent = `${this.resizedNode.data.originalWidth} x ${this.resizedNode.data.originalHeight}px`;
                    }
                }
                
                this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
                return;
            }
            
            // Handle Node Dragging
            if (this.isDragging && this.draggedNode) {
                const container = this.nodeCanvas.getBoundingClientRect();
                const mouseCanvasX = (e.clientX - container.left) / this.zoom - this.panX;
                const mouseCanvasY = (e.clientY - container.top) / this.zoom - this.panY;
                
                this.draggedNode.position.x = mouseCanvasX - this.dragOffset.x;
                this.draggedNode.position.y = mouseCanvasY - this.dragOffset.y;

                this.draggedNode.element.style.left = `${this.draggedNode.position.x}px`;
                this.draggedNode.element.style.top = `${this.draggedNode.position.y}px`;

                this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
            }
            
            // Handle Connection Dragging
            if (this.isConnecting && this.connectionStart) {
                const container = this.canvasContainer.getBoundingClientRect();
                const mouseX = (e.clientX - container.left) / this.zoom - this.panX;
                const mouseY = (e.clientY - container.top) / this.zoom - this.panY;
                this.tempConnectionEnd.x = mouseX;
                this.tempConnectionEnd.y = mouseY;
                this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
            }

            // Handle Canvas Panning
            if (this.isMiddlePanning) {
                const dx = (e.clientX - this.middlePanStart.x) / this.zoom;
                const dy = (e.clientY - this.middlePanStart.y) / this.zoom;
                
                this.panX += dx;
                this.panY += dy;
                
                this.middlePanStart = { x: e.clientX, y: e.clientY };
                this.applyZoom();
            }

            // Handle Toolbar Dragging
            if (this.isToolbarDragging) {
                this.toolbarPosition.x = e.clientX - this.toolbarDragStart.x;
                this.toolbarPosition.y = e.clientY - this.toolbarDragStart.y;
                
                this.toolbar.style.left = `${this.toolbarPosition.x}px`;
                this.toolbar.style.top = `${this.toolbarPosition.y}px`;
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isResizing) {
                this.isResizing = false;
                this.resizedNode = null;
            }
            
            if (this.isDragging && this.draggedNode) {
                this.draggedNode.element.style.zIndex = '';
            }
            this.isDragging = false;
            this.draggedNode = null;
            
            if (this.isConnecting) {
                // Check if valid connection point or cancel
                const endPoint = document.elementFromPoint(e.clientX, e.clientY);
                if (!endPoint || (endPoint.id !== 'connectionCanvas' && !endPoint.classList.contains('connection-point'))) {
                    this.isConnecting = false;
                    this.connectionStart = null;
                    this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
                }
            }

            if (this.isMiddlePanning) {
                this.isMiddlePanning = false;
                this.canvasContainer.style.cursor = '';
            }

            if (this.isToolbarDragging) {
                this.isToolbarDragging = false;
                this.toolbar.style.cursor = 'move';
            }
        });

        // Handle connection deletion
        this.connectionCanvas.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = this.canvasContainer.getBoundingClientRect();
            const clickX = (e.clientX - container.left) / this.zoom - this.panX;
            const clickY = (e.clientY - container.top) / this.zoom - this.panY;
            
            const connections = this.callbacks.getConnections();
            
            for (let i = connections.length - 1; i >= 0; i--) {
                const conn = connections[i];
                
                if (!conn.midpoint) continue;
                
                const distance = Math.sqrt(
                    Math.pow(clickX - conn.midpoint.x, 2) + 
                    Math.pow(clickY - conn.midpoint.y, 2)
                );
                
                if (distance <= 15) {
                    if (this.callbacks.removeConnection) {
                        this.callbacks.removeConnection(i);
                    }
                    e.preventDefault();
                    return;
                }
            }
        });

        // Drag and Drop Files
        this.canvasContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        this.canvasContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const files = Array.from(e.dataTransfer.files);
            const imageFiles = files.filter(file => file.type.startsWith('image/'));
            
            if (imageFiles.length > 0) {
                const rect = this.canvasContainer.getBoundingClientRect();
                const dropX = (e.clientX - rect.left) / this.zoom - this.panX;
                const dropY = (e.clientY - rect.top) / this.zoom - this.panY;
                
                imageFiles.forEach((file, index) => {
                    const offsetY = index * 20;
                    if (this.callbacks.createImageNodeWithFile) {
                        this.callbacks.createImageNodeWithFile(dropX, dropY + offsetY, file);
                    }
                });
            }
        });
    }

    setupMinimap() {
        setInterval(() => {
            this.updateMinimap(this.callbacks.getNodes(), this.callbacks.getConnections());
        }, 100);

        this.minimapCanvas.addEventListener('click', (e) => {
            if (this.callbacks.getNodes().length === 0) return;
            
            const rect = this.minimapCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            
            const scale = parseFloat(this.minimapViewport.dataset.scale);
            const minX = parseFloat(this.minimapViewport.dataset.minX);
            const minY = parseFloat(this.minimapViewport.dataset.minY);
            const offsetX = parseFloat(this.minimapViewport.dataset.offsetX);
            const offsetY = parseFloat(this.minimapViewport.dataset.offsetY);
            
            const canvasX = (clickX - offsetX) / scale + minX;
            const canvasY = (clickY - offsetY) / scale + minY;
            
            this.panX = -(canvasX - this.canvasContainer.clientWidth / (2 * this.zoom));
            this.panY = -(canvasY - this.canvasContainer.clientHeight / (2 * this.zoom));
            
            this.applyZoom();
        });
    }

    updateMinimap(nodes, connections) {
        this.minimapCanvas.width = 300;
        this.minimapCanvas.height = 225;
        
        this.minimapCtx.fillStyle = '#1a1a1a';
        this.minimapCtx.fillRect(0, 0, 300, 225);
        
        if (nodes.length === 0) {
            this.minimapViewport.style.width = '0px';
            this.minimapViewport.style.height = '0px';
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        nodes.forEach(node => {
            const nodeWidth = node.element.offsetWidth || 280;
            const nodeHeight = node.element.offsetHeight || 150;
            
            minX = Math.min(minX, node.position.x);
            minY = Math.min(minY, node.position.y);
            maxX = Math.max(maxX, node.position.x + nodeWidth);
            maxY = Math.max(maxY, node.position.y + nodeHeight);
        });
        
        const padding = 100;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;
        
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        
        const scaleX = this.minimapCanvas.width / boundsWidth;
        const scaleY = this.minimapCanvas.height / boundsHeight;
        const scale = Math.min(scaleX, scaleY);
        
        const offsetX = (this.minimapCanvas.width - boundsWidth * scale) / 2;
        const offsetY = (this.minimapCanvas.height - boundsHeight * scale) / 2;
        
        nodes.forEach(node => {
            const x = (node.position.x - minX) * scale + offsetX;
            const y = (node.position.y - minY) * scale + offsetY;
            const width = (node.element.offsetWidth || 280) * scale;
            const height = (node.element.offsetHeight || 150) * scale;
            
            if (node.type === 'image') {
                this.minimapCtx.fillStyle = '#4a6fa5';
            } else if (node.type === 'prompt') {
                this.minimapCtx.fillStyle = '#6b4aa5';
            } else if (node.type === 'action') {
                this.minimapCtx.fillStyle = '#a54a6f';
            } else if (node.type === 'result') {
                this.minimapCtx.fillStyle = '#4aa56b';
            }
            
            this.minimapCtx.fillRect(x, y, width, height);
            
            this.minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.minimapCtx.lineWidth = 1;
            this.minimapCtx.strokeRect(x, y, width, height);
        });
        
        this.minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        this.minimapCtx.lineWidth = 1.5;
        connections.forEach(conn => {
            const fromNode = nodes.find(n => n.id === conn.from);
            const toNode = nodes.find(n => n.id === conn.to);
            if (!fromNode || !toNode) return;
            
            const fromX = (fromNode.position.x + (fromNode.element.offsetWidth || 280) - minX) * scale + offsetX;
            const fromY = (fromNode.position.y + (fromNode.element.offsetHeight || 150) / 2 - minY) * scale + offsetY;
            const toX = (toNode.position.x - minX) * scale + offsetX;
            const toY = (toNode.position.y + (toNode.element.offsetHeight || 150) / 2 - minY) * scale + offsetY;
            
            this.minimapCtx.beginPath();
            this.minimapCtx.moveTo(fromX, fromY);
            this.minimapCtx.lineTo(toX, toY);
            this.minimapCtx.stroke();
        });
        
        const viewportWidth = (this.canvasContainer.clientWidth / this.zoom) * scale;
        const viewportHeight = (this.canvasContainer.clientHeight / this.zoom) * scale;
        const viewportX = (-this.panX - minX) * scale + offsetX;
        const viewportY = (-this.panY - minY) * scale + offsetY;
        
        this.minimapViewport.style.width = `${viewportWidth}px`;
        this.minimapViewport.style.height = `${viewportHeight}px`;
        this.minimapViewport.style.left = `${viewportX}px`;
        this.minimapViewport.style.top = `${viewportY}px`;
        
        this.minimapViewport.dataset.scale = scale;
        this.minimapViewport.dataset.minX = minX;
        this.minimapViewport.dataset.minY = minY;
        this.minimapViewport.dataset.offsetX = offsetX;
        this.minimapViewport.dataset.offsetY = offsetY;
    }

    drawConnections(connections, nodes) {
        this.ctx.clearRect(0, 0, this.connectionCanvas.width, this.connectionCanvas.height);
        
        this.ctx.save();
        this.ctx.translate(this.panX * this.zoom, this.panY * this.zoom);
        this.ctx.scale(this.zoom, this.zoom);

        connections.forEach((conn) => {
            const fromNode = nodes.find(n => n.id === conn.from);
            const toNode = nodes.find(n => n.id === conn.to);

            if (!fromNode || !toNode) return;

            const fromPoint = this.getConnectionPoint(fromNode, 'output');
            const toPoint = this.getConnectionPoint(toNode, 'input');

            this.ctx.beginPath();
            this.ctx.strokeStyle = '#555';
            this.ctx.lineWidth = 2;

            const cp1x = fromPoint.x + (toPoint.x - fromPoint.x) / 2;
            const cp1y = fromPoint.y;
            const cp2x = fromPoint.x + (toPoint.x - fromPoint.x) / 2;
            const cp2y = toPoint.y;

            this.ctx.moveTo(fromPoint.x, fromPoint.y);
            this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPoint.x, toPoint.y);
            this.ctx.stroke();
            
            const t = 0.5;
            const midX = Math.pow(1-t, 3) * fromPoint.x +
                         3 * Math.pow(1-t, 2) * t * cp1x +
                         3 * (1-t) * Math.pow(t, 2) * cp2x +
                         Math.pow(t, 3) * toPoint.x;
            const midY = Math.pow(1-t, 3) * fromPoint.y +
                         3 * Math.pow(1-t, 2) * t * cp1y +
                         3 * (1-t) * Math.pow(t, 2) * cp2y +
                         Math.pow(t, 3) * toPoint.y;
            
            conn.midpoint = { x: midX, y: midY };
            
            this.ctx.beginPath();
            this.ctx.arc(midX, midY, 10, 0, Math.PI * 2);
            this.ctx.fillStyle = '#2a2a2a';
            this.ctx.fill();
            this.ctx.strokeStyle = '#555';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(midX - 5, midY);
            this.ctx.lineTo(midX + 5, midY);
            this.ctx.strokeStyle = '#aaa';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        });
        
        if (this.isConnecting && this.connectionStart) {
            const startNode = nodes.find(n => n.id === this.connectionStart.nodeId);
            if (startNode) {
                const startPoint = this.getConnectionPoint(startNode, this.connectionStart.type);
                
                this.ctx.strokeStyle = '#888';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 5]);
                
                const cp1x = startPoint.x + (this.tempConnectionEnd.x - startPoint.x) / 2;
                const cp1y = startPoint.y;
                const cp2x = startPoint.x + (this.tempConnectionEnd.x - startPoint.x) / 2;
                const cp2y = this.tempConnectionEnd.y;
                
                this.ctx.beginPath();
                this.ctx.moveTo(startPoint.x, startPoint.y);
                this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, this.tempConnectionEnd.x, this.tempConnectionEnd.y);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        }
        
        this.ctx.restore();
    }

    getConnectionPoint(node, type) {
        const nodeWidth = node.element.offsetWidth;
        const nodeHeight = node.element.offsetHeight;
        
        if (type === 'output') {
            return {
                x: node.position.x + nodeWidth,
                y: node.position.y + nodeHeight / 2
            };
        } else {
            return {
                x: node.position.x,
                y: node.position.y + nodeHeight / 2
            };
        }
    }

    startDrag(e, node) {
        this.isDragging = true;
        this.draggedNode = node;
        
        const container = this.nodeCanvas.getBoundingClientRect();
        const mouseCanvasX = (e.clientX - container.left) / this.zoom - this.panX;
        const mouseCanvasY = (e.clientY - container.top) / this.zoom - this.panY;
        
        this.dragOffset.x = mouseCanvasX - node.position.x;
        this.dragOffset.y = mouseCanvasY - node.position.y;
        node.element.style.zIndex = 1000;
    }

    startConnection(e, nodeId, pointEl) {
        this.isConnecting = true;
        this.connectionStart = { 
            nodeId, 
            type: pointEl.classList.contains('input') ? 'input' : 'output', 
            element: pointEl 
        };

        const connectionMouseUp = (upEvent) => {
            if (this.isConnecting && this.connectionStart) {
                const endPoint = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
                const isOverConnectionPoint = endPoint && endPoint.classList.contains('connection-point') &&
                                              endPoint.dataset.node !== this.connectionStart.nodeId &&
                                              ((this.connectionStart.type === 'output' && endPoint.classList.contains('input')) ||
                                               (this.connectionStart.type === 'input' && endPoint.classList.contains('output')));

                if (isOverConnectionPoint) {
                    const endType = endPoint.classList.contains('input') ? 'input' : 'output';
                    const endNodeId = endPoint.dataset.node;
                    if (this.callbacks.createConnection) {
                        this.callbacks.createConnection(this.connectionStart.nodeId, endNodeId, this.connectionStart.type, endType);
                    }
                    this.connectionStart = null;
                } else {
                    const rect = this.canvasContainer.getBoundingClientRect();
                    const x = (upEvent.clientX - rect.left) / this.zoom - this.panX;
                    const y = (upEvent.clientY - rect.top) / this.zoom - this.panY;
                    
                    this.showConnectionMenu(upEvent.clientX, upEvent.clientY);
                    // contextMenu handler will read this.connectionStart
                }
                
                this.isConnecting = false;
                this.drawConnections(this.callbacks.getConnections(), this.callbacks.getNodes());
            }
            document.removeEventListener('mouseup', connectionMouseUp);
        };
        
        document.addEventListener('mouseup', connectionMouseUp);
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

    getViewportCenter() {
        const centerX = (this.canvasContainer.clientWidth / 2) / this.zoom - this.panX;
        const centerY = (this.canvasContainer.clientHeight / 2) / this.zoom - this.panY;
        return { x: centerX, y: centerY };
    }
}
