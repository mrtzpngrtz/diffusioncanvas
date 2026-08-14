export class ConnectionManager {
    constructor(nodeManager, canvasManager, uiManager) {
        this.nodeManager = nodeManager;
        this.canvasManager = canvasManager;
        this.uiManager = uiManager;
        
        this.connections = [];
        this.isConnecting = false;
        this.connectionStart = null;
        this.tempConnectionEnd = { x: 0, y: 0 };
    }

    init() {
        this.setupGlobalEvents();
        this.setupCanvasEvents();
    }

    setupGlobalEvents() {
        document.addEventListener('pointermove', (e) => {
            if (this.isConnecting && this.connectionStart) {
                const container = this.canvasManager.container.getBoundingClientRect();
                const zoom = this.canvasManager.zoom;
                const panX = this.canvasManager.panX;
                const panY = this.canvasManager.panY;
                const mouseX = (e.clientX - container.left) / zoom - panX;
                const mouseY = (e.clientY - container.top) / zoom - panY;
                this.tempConnectionEnd.x = mouseX;
                this.tempConnectionEnd.y = mouseY;
                this.drawConnections();
            }
        });

        document.addEventListener('pointerup', (e) => {
            if (this.isConnecting) {
                const endPoint = document.elementFromPoint(e.clientX, e.clientY);
                if (!endPoint || (endPoint.id !== 'connectionCanvas' && !endPoint.classList.contains('connection-point'))) {
                    this.isConnecting = false;
                    this.connectionStart = null;
                    this.drawConnections();
                }
            }
        });
    }

    setupCanvasEvents() {
        const connectionCanvas = document.getElementById('connectionCanvas');
        if (connectionCanvas) {
            connectionCanvas.addEventListener('click', (e) => this.handleConnectionClick(e));
        }
    }

    startConnection(e, nodeId, element) {
        this.isConnecting = true;
        this.connectionStart = { 
            nodeId, 
            type: element.classList.contains('input') ? 'input' : 'output', 
            element 
        };
        
        const connectionMouseUp = (upEvent) => {
            if (this.isConnecting && this.connectionStart) {
                const endPoint = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
                const isOverConnectionPoint = endPoint && endPoint.classList.contains('connection-point') &&
                                              endPoint.dataset.node !== this.connectionStart.nodeId &&
                                              ((this.connectionStart.type === 'output' && endPoint.classList.contains('input')) ||
                                               (this.connectionStart.type === 'input' && endPoint.classList.contains('output')));

                if (isOverConnectionPoint) {
                    // If it's a valid connection point, create the connection
                    const endType = endPoint.classList.contains('input') ? 'input' : 'output';
                    const endNodeId = endPoint.dataset.node;
                    this.createConnection(this.connectionStart.nodeId, endNodeId, this.connectionStart.type, endType);
                    this.connectionStart = null;
                } else {
                    // Otherwise, show the context menu to create a new node
                    const rect = this.canvasManager.container.getBoundingClientRect();
                    const zoom = this.canvasManager.zoom;
                    const panX = this.canvasManager.panX;
                    const panY = this.canvasManager.panY;
                    
                    const x = (upEvent.clientX - rect.left) / zoom - panX;
                    const y = (upEvent.clientY - rect.top) / zoom - panY;
                    
                    // Pass connectionStart info to UI manager for context menu to use
                    this.uiManager.showContextMenu(upEvent.clientX, upEvent.clientY, true);
                    // We keep connectionStart active so context menu can use it
                }
                
                if (!isOverConnectionPoint && !upEvent.target.closest('#contextMenu')) {
                     this.isConnecting = false;
                     this.connectionStart = null;
                }
                
                this.drawConnections();
            }
            document.removeEventListener('pointerup', connectionMouseUp);
        };

        document.addEventListener('pointerup', connectionMouseUp);
    }

    createConnection(fromNodeId, toNodeId, fromType, toType) {
        const fromNode = this.nodeManager.nodes.find(n => n.id === fromNodeId);
        const toNode = this.nodeManager.nodes.find(n => n.id === toNodeId);

        if (!fromNode || !toNode) return;

        // Ensure correct direction (output to input)
        let sourceNode, targetNode;
        if (fromType === 'output') {
            sourceNode = fromNode;
            targetNode = toNode;
        } else {
            sourceNode = toNode;
            targetNode = fromNode;
        }

        // Check if connection already exists
        const exists = this.connections.some(c => 
            c.from === sourceNode.id && c.to === targetNode.id
        );

        if (exists) return;

        // Create connection
        this.connections.push({
            from: sourceNode.id,
            to: targetNode.id
        });

        // Update logic (moved from script.js)
        this.updateNodeConnections(sourceNode, targetNode);

        this.drawConnections();
        this.uiManager.updateStatus('Nodes connected', '#27ae60');
    }

    updateNodeConnections(sourceNode, targetNode) {
        // Update prompt/action node with connected images (from image, result, or draw node)
        if ((targetNode.type === 'prompt' || targetNode.type === 'action') && (sourceNode.type === 'image' || sourceNode.type === 'result' || sourceNode.type === 'draw')) {
            if (!targetNode.data.connectedImages.includes(sourceNode)) {
                targetNode.data.connectedImages.push(sourceNode);
            }
            this.nodeManager.updateGenerateButton(targetNode);
        }
        
        // Allow chaining prompts to prompts/actions
        if ((targetNode.type === 'prompt' || targetNode.type === 'action') && sourceNode.type === 'prompt') {
            if (!targetNode.data.connectedPrompts) {
                targetNode.data.connectedPrompts = [];
            }
            if (!targetNode.data.connectedPrompts.includes(sourceNode)) {
                targetNode.data.connectedPrompts.push(sourceNode);
            }
            this.nodeManager.updateGenerateButton(targetNode);
        }
    }

    removeConnectionsForNode(nodeId) {
        this.connections = this.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
        this.drawConnections();
    }

    drawConnections() {
        const ctx = this.canvasManager.ctx;
        const width = this.canvasManager.connectionCanvas.width;
        const height = this.canvasManager.connectionCanvas.height;
        const zoom = this.canvasManager.zoom;
        const panX = this.canvasManager.panX;
        const panY = this.canvasManager.panY;

        ctx.clearRect(0, 0, width, height);
        
        ctx.save();
        ctx.translate(panX * zoom, panY * zoom);
        ctx.scale(zoom, zoom);

        // Draw established connections
        this.connections.forEach((conn) => {
            const fromNode = this.nodeManager.nodes.find(n => n.id === conn.from);
            const toNode = this.nodeManager.nodes.find(n => n.id === conn.to);

            if (!fromNode || !toNode) return;

            const fromPoint = this.getConnectionPoint(fromNode, 'output');
            const toPoint = this.getConnectionPoint(toNode, 'input');

            // Draw curved line
            ctx.beginPath();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;

            const cp1x = fromPoint.x + (toPoint.x - fromPoint.x) / 2;
            const cp1y = fromPoint.y;
            const cp2x = fromPoint.x + (toPoint.x - fromPoint.x) / 2;
            const cp2y = toPoint.y;

            ctx.moveTo(fromPoint.x, fromPoint.y);
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toPoint.x, toPoint.y);
            ctx.stroke();
            
            // Calculate midpoint
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
            
            // Draw disconnect button
            ctx.beginPath();
            ctx.arc(midX, midY, 10, 0, Math.PI * 2);
            ctx.fillStyle = '#2a2a2a';
            ctx.fill();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Draw minus sign
            ctx.beginPath();
            ctx.moveTo(midX - 5, midY);
            ctx.lineTo(midX + 5, midY);
            ctx.strokeStyle = '#aaa';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
        
        // Draw temporary connection
        if (this.isConnecting && this.connectionStart) {
            const startNode = this.nodeManager.nodes.find(n => n.id === this.connectionStart.nodeId);
            if (startNode) {
                const startPoint = this.getConnectionPoint(startNode, this.connectionStart.type);
                
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                
                const cp1x = startPoint.x + (this.tempConnectionEnd.x - startPoint.x) / 2;
                const cp1y = startPoint.y;
                const cp2x = startPoint.x + (this.tempConnectionEnd.x - startPoint.x) / 2;
                const cp2y = this.tempConnectionEnd.y;
                
                ctx.beginPath();
                ctx.moveTo(startPoint.x, startPoint.y);
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, this.tempConnectionEnd.x, this.tempConnectionEnd.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        
        ctx.restore();
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

    handleConnectionClick(e) {
        e.stopPropagation();
        const container = this.canvasManager.container.getBoundingClientRect();
        const zoom = this.canvasManager.zoom;
        const panX = this.canvasManager.panX;
        const panY = this.canvasManager.panY;
        
        const clickX = (e.clientX - container.left) / zoom - panX;
        const clickY = (e.clientY - container.top) / zoom - panY;
        
        for (let i = this.connections.length - 1; i >= 0; i--) {
            const conn = this.connections[i];
            
            if (!conn.midpoint) continue;
            
            const distance = Math.sqrt(
                Math.pow(clickX - conn.midpoint.x, 2) + 
                Math.pow(clickY - conn.midpoint.y, 2)
            );
            
            if (distance <= 15) {
                // Found click on disconnect button
                const fromNode = this.nodeManager.nodes.find(n => n.id === conn.from);
                const toNode = this.nodeManager.nodes.find(n => n.id === conn.to);
                
                // Cleanup connection data
                if (toNode && (toNode.type === 'prompt' || toNode.type === 'action') && fromNode) {
                    if ((fromNode.type === 'image' || fromNode.type === 'result' || fromNode.type === 'draw') && toNode.data.connectedImages) {
                        toNode.data.connectedImages = toNode.data.connectedImages.filter(node => node.id !== fromNode.id);
                        // updateVeo3FrameIndicators(toNode);
                    }
                    if (fromNode.type === 'prompt' && toNode.data.connectedPrompts) {
                         toNode.data.connectedPrompts = toNode.data.connectedPrompts.filter(node => node.id !== fromNode.id);
                    }
                    this.nodeManager.updateGenerateButton(toNode);
                }
                
                if (fromNode && toNode && toNode.type === 'result') {
                    if (fromNode.type === 'prompt' || fromNode.type === 'action') {
                        if (fromNode.data.resultNode && fromNode.data.resultNode.id === toNode.id) {
                            fromNode.data.resultNode = null;
                        }
                        if (toNode.data.sourcePromptNode && toNode.data.sourcePromptNode.id === fromNode.id) {
                            toNode.data.sourcePromptNode = null;
                        }
                    }
                }

                this.connections.splice(i, 1);
                this.drawConnections();
                this.uiManager.updateStatus('Connection removed', '#e74c3c');
                return;
            }
        }
    }
}
