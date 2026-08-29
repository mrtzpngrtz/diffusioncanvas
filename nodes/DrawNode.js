import { NodeBase } from './NodeBase.js';

export class DrawNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node draw-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Draw Canvas', 'i-pencil')}
            <div class="node-content">
                <select class="aspect-ratio-select">
                    <option value="1:1">1:1 (512x512)</option>
                    <option value="16:9" selected>16:9 (672x384)</option>
                    <option value="4:3">4:3 (592x448)</option>
                    <option value="3:4">3:4 (448x592)</option>
                    <option value="9:16">9:16 (384x672)</option>
                </select>
                <div class="draw-canvas-wrapper">
                    <canvas class="draw-canvas" width="672" height="384"></canvas>
                </div>
                <div class="draw-controls">
                    <div class="draw-tools">
                        <button class="draw-tool-btn active" data-tool="draw">draw</button>
                        <button class="draw-tool-btn" data-tool="erase">erase</button>
                        <input type="color" class="draw-color-picker" value="#000000">
                        <input type="range" class="draw-size-slider" min="1" max="50" value="5">
                        <button class="draw-tool-btn" data-tool="clear">clear</button>
                    </div>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, false, true)}
        `;

        const canvas = nodeEl.querySelector('.draw-canvas');
        const drawCtx = canvas.getContext('2d');
        const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
        const colorPicker = nodeEl.querySelector('.draw-color-picker');
        const sizeSlider = nodeEl.querySelector('.draw-size-slider');
        const toolBtns = nodeEl.querySelectorAll('.draw-tool-btn');

        const node = {
            id: nodeId,
            type: 'draw',
            element: nodeEl,
            data: { 
                canvas: canvas,
                context: drawCtx,
                aspectRatio: '16:9',
                tool: 'draw',
                color: '#000000',
                size: 5,
                isDrawing: false,
                imageData: null
            },
            position: { x, y }
        };

        // Initialize white background
        drawCtx.fillStyle = '#ffffff';
        drawCtx.fillRect(0, 0, canvas.width, canvas.height);

        // Aspect ratio handling
        const aspectRatios = {
            '1:1': { width: 512, height: 512 },
            '16:9': { width: 672, height: 384 },
            '4:3': { width: 592, height: 448 },
            '3:4': { width: 448, height: 592 },
            '9:16': { width: 384, height: 672 }
        };

        aspectRatioSelect.addEventListener('change', (e) => {
            const ratio = e.target.value;
            node.data.aspectRatio = ratio;
            const dimensions = aspectRatios[ratio];
            
            // Save current drawing
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0);
            
            // Resize canvas
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
            
            // Clear with white background
            drawCtx.fillStyle = '#ffffff';
            drawCtx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Restore drawing (scaled if needed)
            drawCtx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
            
            callbacks.updateDrawNodeImage(node);
        });

        // Tool selection
        toolBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = btn.dataset.tool;
                
                if (tool === 'clear') {
                    drawCtx.fillStyle = '#ffffff';
                    drawCtx.fillRect(0, 0, canvas.width, canvas.height);
                    callbacks.updateDrawNodeImage(node);
                    return;
                }
                
                toolBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                node.data.tool = tool;
            });
        });

        // Color and size
        colorPicker.addEventListener('change', (e) => {
            node.data.color = e.target.value;
        });

        sizeSlider.addEventListener('input', (e) => {
            node.data.size = parseInt(e.target.value);
        });

        // Drawing functionality
        let lastX = 0;
        let lastY = 0;

        const getMousePos = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (canvas.width / rect.width),
                y: (e.clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        canvas.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            node.data.isDrawing = true;
            const pos = getMousePos(e);
            lastX = pos.x;
            lastY = pos.y;
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!node.data.isDrawing) return;
            
            const pos = getMousePos(e);
            
            drawCtx.beginPath();
            drawCtx.moveTo(lastX, lastY);
            drawCtx.lineTo(pos.x, pos.y);
            
            if (node.data.tool === 'draw') {
                drawCtx.strokeStyle = node.data.color;
                drawCtx.lineWidth = node.data.size;
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.globalCompositeOperation = 'source-over';
            } else if (node.data.tool === 'erase') {
                drawCtx.strokeStyle = '#ffffff';
                drawCtx.lineWidth = node.data.size * 2;
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.globalCompositeOperation = 'destination-out';
            }
            
            drawCtx.stroke();
            
            lastX = pos.x;
            lastY = pos.y;
        });

        const stopDrawing = () => {
            if (node.data.isDrawing) {
                node.data.isDrawing = false;
                callbacks.updateDrawNodeImage(node);
            }
        };

        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Connection point
        this.setupConnectionPoint(
            nodeEl.querySelector('.connection-point'), 
            nodeId, 
            callbacks.startConnection
        );

        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        // Initial image update
        callbacks.updateDrawNodeImage(node);

        return node;
    }
}
