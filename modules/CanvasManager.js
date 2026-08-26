export class CanvasManager {
    constructor(nodeManager, connectionManager) {
        this.nodeManager = nodeManager;
        this.connectionManager = connectionManager;
        
        this.container = document.querySelector('.canvas-container');
        this.nodeCanvas = document.getElementById('nodeCanvas');
        this.connectionCanvas = document.getElementById('connectionCanvas');
        this.ctx = this.connectionCanvas.getContext('2d');
        
        // Zoom and pan state
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        
        // Middle mouse pan
        this.isMiddlePanning = false;
        this.middlePanStart = { x: 0, y: 0 };

        // Space + left click pan
        this.isSpacePanning = false;
        this.spacePanStart = { x: 0, y: 0 };
        this.isSpaceDown = false;

        // Touch state
        this.pinchEnabled = true;   // can be toggled by user
        this._touchActive = false;  // true while any background touch is down

        // Minimap
        this.minimapCanvas = document.getElementById('minimapCanvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        this.minimapViewport = document.getElementById('minimapViewport');
        this.isDraggingMinimap = false;
        this.minimapDragStart = { x: 0, y: 0 };
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.setupZoomControls();
        this.setupPanning();
        this.setupMinimap();
        
        // Start minimap loop
        setInterval(() => this.updateMinimap(), 100);
    }

    resizeCanvas() {
        if (this.container && this.connectionCanvas) {
            this.connectionCanvas.width = this.container.clientWidth;
            this.connectionCanvas.height = this.container.clientHeight;
            if (this.connectionManager) {
                this.connectionManager.drawConnections();
            }
        }
    }

    setupZoomControls() {
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');
        const zoomResetBtn = document.getElementById('zoomReset');

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => {
            this.zoom = 1;
            this.panX = 0;
            this.panY = 0;
            this.applyZoom();
        });

        // Touch zoom mode toggle
        const touchZoomBtn = document.getElementById('touchZoomToggle');
        if (touchZoomBtn) {
            touchZoomBtn.addEventListener('click', () => {
                this.pinchEnabled = !this.pinchEnabled;
                touchZoomBtn.textContent = this.pinchEnabled ? '🔒 Pinch' : '🔓 Pan only';
                touchZoomBtn.style.opacity = this.pinchEnabled ? '' : '0.5';
            });
        }

        // Star filter toggle
        const starFilterBtn = document.getElementById('starFilterToggle');
        if (starFilterBtn) {
            starFilterBtn.addEventListener('click', () => {
                const on = starFilterBtn.classList.toggle('active');
                starFilterBtn.textContent = on ? '⭐' : '☆';
                this.nodeCanvas.classList.toggle('filter-starred', on);
                this.drawConnections();
            });
        }

        // Mouse wheel zoom — skip if a touch is active (prevents OS scroll→zoom on touchscreen)
        if (this.container) {
            this.container.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (this._touchActive) return;

                const rect = this.container.getBoundingClientRect();
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
    }

    setupPanning() {
        if (!this.container) return;

        this.container.style.touchAction = 'none';

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.target.matches('input, textarea, [contenteditable]')) {
                e.preventDefault();
                this.isSpaceDown = true;
                if (!this.isSpacePanning) this.container.style.cursor = 'grab';
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.isSpaceDown = false;
                this.isSpacePanning = false;
                this.container.style.cursor = '';
            }
        });

        // Only track pointers that start on canvas background (not on nodes/toolbar/minimap)
        // This prevents node-drag pointers from polluting pinch/pan tracking.
        const bgPts = new Map(); // pointerId → {x, y}
        let pinchDist = 0;
        let touchPanId = null;
        let touchPanPrev = null;
        let touchPanInitial = null; // starting pos for tap-to-deselect detection

        // RAF batching to avoid triggering drawConnections() 120× per second during pan
        let rafId = null;
        let pendingDx = 0, pendingDy = 0;
        const flushPan = () => {
            rafId = null;
            if (pendingDx !== 0 || pendingDy !== 0) {
                this.panX += pendingDx;
                this.panY += pendingDy;
                pendingDx = 0;
                pendingDy = 0;
                this.applyZoom();
            }
        };

        const isBackground = (target) =>
            !target.closest('.node, .minimap, .minimap-viewport, .toolbar-overlay, .draw-toolbar, #contextMenu, .zoom-controls');

        this.container.addEventListener('pointerdown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                this.isMiddlePanning = true;
                this.middlePanStart = { x: e.clientX, y: e.clientY };
                this.container.style.cursor = 'grabbing';
                this.container.setPointerCapture(e.pointerId);
                return;
            }

            if (e.button === 0 && this.isSpaceDown) {
                e.preventDefault();
                this.isSpacePanning = true;
                this.spacePanStart = { x: e.clientX, y: e.clientY };
                this.container.style.cursor = 'grabbing';
                this.container.setPointerCapture(e.pointerId);
                return;
            }

            if ((e.pointerType === 'touch' || e.pointerType === 'pen') && isBackground(e.target)) {
                bgPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
                this._touchActive = true;
                if (bgPts.size === 1) {
                    touchPanId = e.pointerId;
                    touchPanPrev = { x: e.clientX, y: e.clientY };
                    touchPanInitial = { x: e.clientX, y: e.clientY };
                    this.container.setPointerCapture(e.pointerId);
                } else if (bgPts.size === 2 && this.pinchEnabled) {
                    // Second finger down — check minimum distance before enabling pinch
                    const [p1, p2] = [...bgPts.values()];
                    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    if (d >= 50) {
                        // Real 2-finger pinch, cancel 1-finger pan
                        touchPanId = null;
                        pinchDist = d;
                        if (rafId) { cancelAnimationFrame(rafId); flushPan(); }
                    }
                    // else: fingers too close → treat as ghost touch, keep panning
                }
            }
        });

        this.container.addEventListener('pointermove', (e) => {
            if (this.isMiddlePanning) {
                this.panX += (e.clientX - this.middlePanStart.x) / this.zoom;
                this.panY += (e.clientY - this.middlePanStart.y) / this.zoom;
                this.middlePanStart = { x: e.clientX, y: e.clientY };
                this.applyZoom();
                return;
            }

            if (this.isSpacePanning) {
                this.panX += (e.clientX - this.spacePanStart.x) / this.zoom;
                this.panY += (e.clientY - this.spacePanStart.y) / this.zoom;
                this.spacePanStart = { x: e.clientX, y: e.clientY };
                this.applyZoom();
                return;
            }

            if (!bgPts.has(e.pointerId)) return;
            bgPts.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (bgPts.size >= 2 && this.pinchEnabled && pinchDist > 0) {
                // Pinch-to-zoom toward midpoint
                const [p1, p2] = [...bgPts.values()];
                const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                const scale = dist / pinchDist;
                // Only apply if scale change is meaningful (filters ghost-touch micro-jitter)
                if (Math.abs(scale - 1) > 0.01) {
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const rect = this.container.getBoundingClientRect();
                    const cx = (midX - rect.left) / this.zoom - this.panX;
                    const cy = (midY - rect.top) / this.zoom - this.panY;
                    const nz = Math.max(0.1, Math.min(3, this.zoom * scale));
                    this.panX = (midX - rect.left) / nz - cx;
                    this.panY = (midY - rect.top) / nz - cy;
                    this.zoom = nz;
                    this.applyZoom();
                }
                pinchDist = dist;
            } else if (e.pointerId === touchPanId && touchPanPrev) {
                // 1-finger canvas pan — accumulate deltas, apply via RAF
                pendingDx += (e.clientX - touchPanPrev.x) / this.zoom;
                pendingDy += (e.clientY - touchPanPrev.y) / this.zoom;
                touchPanPrev = { x: e.clientX, y: e.clientY };
                if (!rafId) rafId = requestAnimationFrame(flushPan);
            }
        });

        const onPointerEnd = (e) => {
            const wasBg = bgPts.has(e.pointerId);
            if (wasBg) {
                // Tap detection: minimal movement → clear node selection
                if (e.pointerId === touchPanId && touchPanInitial) {
                    const moved = Math.hypot(e.clientX - touchPanInitial.x, e.clientY - touchPanInitial.y);
                    if (moved < 10 && this.nodeManager) {
                        this.nodeManager.clearSelection();
                    }
                }
                bgPts.delete(e.pointerId);
                if (bgPts.size < 2) pinchDist = 0;
                if (e.pointerId === touchPanId) {
                    touchPanId = null;
                    touchPanPrev = null;
                    touchPanInitial = null;
                    // If another background finger is still down, adopt it for pan
                    if (bgPts.size === 1) {
                        const [id, pos] = [...bgPts.entries()][0];
                        touchPanId = id;
                        touchPanPrev = { ...pos };
                        touchPanInitial = { ...pos };
                    }
                }
            }

            if (bgPts.size === 0) this._touchActive = false;

            if (e.button === 1 && this.isMiddlePanning) {
                this.isMiddlePanning = false;
                this.container.style.cursor = '';
            } else if (this.isSpacePanning && e.button === 0) {
                this.isSpacePanning = false;
                this.container.style.cursor = this.isSpaceDown ? 'grab' : '';
            }
        };
        document.addEventListener('pointerup', onPointerEnd);
        document.addEventListener('pointercancel', onPointerEnd);
    }

    applyZoom() {
        const transform = `scale(${this.zoom}) translate(${this.panX}px, ${this.panY}px)`;
        if (this.nodeCanvas) {
            this.nodeCanvas.style.transform = transform;
            this.nodeCanvas.style.transformOrigin = '0 0';
        }
        
        // Don't apply CSS transform to connection canvas - handled in drawing context
        if (this.connectionCanvas) {
            this.connectionCanvas.style.transform = 'none';
        }
        
        // Apply zoom to background grid
        if (this.container) {
            const baseSize1 = 100;
            const baseSize2 = 20;
            this.container.style.backgroundSize = `${baseSize1 * this.zoom}px ${baseSize1 * this.zoom}px, ${baseSize2 * this.zoom}px ${baseSize2 * this.zoom}px`;
            this.container.style.backgroundPosition = `${this.panX * this.zoom}px ${this.panY * this.zoom}px`;
        }
        
        this.updateZoomLevel();
        if (this.connectionManager) {
            this.connectionManager.drawConnections();
        }
        this.updateMinimap();
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

    getViewportCenter() {
        if (this.container) {
            const centerX = (this.container.clientWidth / 2) / this.zoom - this.panX;
            const centerY = (this.container.clientHeight / 2) / this.zoom - this.panY;
            return { x: centerX, y: centerY };
        }
        return { x: 0, y: 0 };
    }

    setupMinimap() {
        if (!this.minimapCanvas || !this.minimapViewport) return;

        // Click to navigate
        this.minimapCanvas.addEventListener('click', (e) => {
            if (!this.nodeManager || this.nodeManager.nodes.length === 0) return;
            
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
            
            this.panX = -(canvasX - this.container.clientWidth / (2 * this.zoom));
            this.panY = -(canvasY - this.container.clientHeight / (2 * this.zoom));
            
            this.applyZoom();
        });

        // Dragging viewport
        this.minimapViewport.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            this.isDraggingMinimap = true;
            this.minimapDragStart.x = e.clientX;
            this.minimapDragStart.y = e.clientY;
            this.minimapViewport.style.cursor = 'grabbing';
            this.minimapViewport.setPointerCapture(e.pointerId);
        });

        this.minimapViewport.addEventListener('pointermove', (e) => {
            if (!this.isDraggingMinimap) return;
            const scale = parseFloat(this.minimapViewport.dataset.scale);
            this.panX -= (e.clientX - this.minimapDragStart.x) / scale;
            this.panY -= (e.clientY - this.minimapDragStart.y) / scale;
            this.minimapDragStart.x = e.clientX;
            this.minimapDragStart.y = e.clientY;
            this.applyZoom();
        });

        this.minimapViewport.addEventListener('pointerup', () => {
            this.isDraggingMinimap = false;
            this.minimapViewport.style.cursor = '';
        });
    }

    updateMinimap() {
        if (!this.minimapCanvas || !this.minimapCtx || !this.minimapViewport) return;
        
        this.minimapCanvas.width = 300;
        this.minimapCanvas.height = 225;
        
        this.minimapCtx.fillStyle = '#1a1a1a';
        this.minimapCtx.fillRect(0, 0, 300, 225);
        
        if (!this.nodeManager || this.nodeManager.nodes.length === 0) {
            this.minimapViewport.style.width = '0px';
            this.minimapViewport.style.height = '0px';
            return;
        }
        
        // Calculate bounds of all nodes
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        this.nodeManager.nodes.forEach(node => {
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
        
        // Draw nodes
        this.nodeManager.nodes.forEach(node => {
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
            } else {
                this.minimapCtx.fillStyle = '#555';
            }
            
            this.minimapCtx.fillRect(x, y, width, height);
            
            this.minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.minimapCtx.lineWidth = 1;
            this.minimapCtx.strokeRect(x, y, width, height);
        });
        
        // Draw connections
        if (this.connectionManager) {
            this.minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            this.minimapCtx.lineWidth = 1.5;
            this.connectionManager.connections.forEach(conn => {
                const fromNode = this.nodeManager.nodes.find(n => n.id === conn.from);
                const toNode = this.nodeManager.nodes.find(n => n.id === conn.to);
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
        }
        
        // Update viewport indicator
        const viewportWidth = (this.container.clientWidth / this.zoom) * scale;
        const viewportHeight = (this.container.clientHeight / this.zoom) * scale;
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
}
