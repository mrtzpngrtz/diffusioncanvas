// Password protection
const CORRECT_PASSWORD = 'wtfsingularity';
const passwordModal = document.getElementById('passwordModal');
const passwordInput = document.getElementById('passwordInput');
const passwordSubmit = document.getElementById('passwordSubmit');
const passwordError = document.getElementById('passwordError');

// Check password on submit
function checkPassword() {
    const enteredPassword = passwordInput.value;
    if (enteredPassword === CORRECT_PASSWORD) {
        passwordModal.classList.add('hidden');
        passwordInput.value = '';
        passwordError.textContent = '';
    } else {
        passwordError.textContent = 'Incorrect password. Please try again.';
        passwordInput.value = '';
        passwordInput.focus();
    }
}

passwordSubmit.addEventListener('click', checkPassword);
passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        checkPassword();
    }
});

// Focus password input on page load
window.addEventListener('load', () => {
    passwordInput.focus();
});

// Theme toggle functionality
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.querySelector('.theme-icon');

// Load saved theme preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    themeIcon.textContent = '🌙';
}

// Toggle theme
function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const isLightMode = document.body.classList.contains('light-mode');
    
    // Update icon
    themeIcon.textContent = isLightMode ? '🌙' : '☀️';
    
    // Save preference
    localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
}

themeToggle.addEventListener('click', toggleTheme);

// Canvas and node management
const nodeCanvas = document.getElementById('nodeCanvas');
const connectionCanvas = document.getElementById('connectionCanvas');
const ctx = connectionCanvas.getContext('2d');
const statusEl = document.getElementById('status');
const minimapCanvas = document.getElementById('minimapCanvas');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapViewport = document.getElementById('minimapViewport');

// Node and connection storage
let nodes = [];
let connections = [];
let nodeIdCounter = 0;

// Zoom and pan
let zoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

// Connection and dragging state
let isDragging = false;
let draggedNode = null;
let dragOffset = { x: 0, y: 0 };
let isConnecting = false;
let connectionStart = null;
let tempConnectionEnd = { x: 0, y: 0 };

// Resize connection canvas to match container
function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    connectionCanvas.width = container.clientWidth;
    connectionCanvas.height = container.clientHeight;
    drawConnections();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Update status message
function updateStatus(message, color = '#555') {
    statusEl.textContent = message;
    statusEl.style.color = color;
}

// Create Image Node
function createImageNode(x = 100, y = 100) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node image-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Image Input</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content">
            <div class="drop-zone">
                <p>Drop image here or click to upload</p>
                <input type="file" accept="image/*" style="display: none;">
            </div>
        </div>
        <div class="connection-point output" data-node="${nodeId}"></div>
    `;

    const node = {
        id: nodeId,
        type: 'image',
        element: nodeEl,
        data: { image: null, imageData: null },
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    nodeEl.appendChild(resizeHandle);
    setupNodeResize(nodeEl, node, resizeHandle);

    // Handle file upload
    const dropZone = nodeEl.querySelector('.drop-zone');
    const fileInput = nodeEl.querySelector('input[type="file"]');

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file, node);
        }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file, node);
        }
    });

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection point
    setupConnectionPoint(nodeEl.querySelector('.connection-point'), nodeId);

    setupNodeDragging(nodeEl, node);
    updateStatus('Image node created');

    return node;
}

// Handle image file upload
function handleImageFile(file, node) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.onload = () => {
            node.data.image = img;
            node.data.imageData = e.target.result;
            node.data.imageWidth = 250; // Default width in pixels
            const content = node.element.querySelector('.node-content');
            content.innerHTML = '';
            
            const wrapper = document.createElement('div');
            wrapper.className = 'image-wrapper';
            img.style.width = `${node.data.imageWidth}px`;
            wrapper.appendChild(img);
            
            const controls = document.createElement('div');
            controls.className = 'image-controls';
            controls.innerHTML = `
                <button class="scale-btn" data-action="smaller">-</button>
                <span class="scale-label">${node.data.imageWidth}px</span>
                <button class="scale-btn" data-action="larger">+</button>
            `;
            
            content.appendChild(wrapper);
            content.appendChild(controls);
            
            // Add action buttons (lightbox and download)
            const actionButtons = document.createElement('div');
            actionButtons.className = 'image-actions';
            actionButtons.innerHTML = `
                <button class="icon-btn" title="View Full Size">⛶</button>
                <button class="icon-btn" title="Download Image">↓</button>
            `;
            content.appendChild(actionButtons);
            
            const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
            const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
            
            lightboxBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openLightbox(node.data.imageData);
            });
            
            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadImage(node.data.imageData, 'image.png');
            });
            
            const smallerBtn = controls.querySelector('[data-action="smaller"]');
            const largerBtn = controls.querySelector('[data-action="larger"]');
            const scaleLabel = controls.querySelector('.scale-label');
            
            smallerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                node.data.imageWidth = Math.max(100, node.data.imageWidth - 50);
                img.style.width = `${node.data.imageWidth}px`;
                scaleLabel.textContent = `${node.data.imageWidth}px`;
            });
            
            largerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                node.data.imageWidth = Math.min(800, node.data.imageWidth + 50);
                img.style.width = `${node.data.imageWidth}px`;
                scaleLabel.textContent = `${node.data.imageWidth}px`;
            });
            
            updateStatus('Image loaded successfully', '#888');
        };
    };
    reader.readAsDataURL(file);
}

// Create Action Node
function createActionNode(x = 300, y = 100) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node action-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Action Preset</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content">
            <select class="action-select">
                <option value="">Select an action...</option>
                <option value="colorize this image">Colorize this image</option>
                <option value="make it a night scene">Make it a night scene</option>
                <option value="make it a day scene">Make it a day scene</option>
                <option value="add vintage filter">Add vintage filter</option>
                <option value="make it black and white">Make it black and white</option>
                <option value="add warm tones">Add warm tones</option>
                <option value="add cool tones">Add cool tones</option>
                <option value="increase contrast">Increase contrast</option>
                <option value="add dramatic lighting">Add dramatic lighting</option>
                <option value="make it look like a painting">Make it look like a painting</option>
                <option value="add snow">Add snow</option>
                <option value="add rain">Add rain</option>
                <option value="make it autumn">Make it autumn</option>
                <option value="make it spring">Make it spring</option>
            </select>
        </div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
        <div class="node-actions">
            <button class="node-btn generate-btn" disabled>Generate Image</button>
        </div>
    `;

    const node = {
        id: nodeId,
        type: 'action',
        element: nodeEl,
        data: { action: '', connectedImages: [] },
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

    // Select handling
    const select = nodeEl.querySelector('.action-select');
    select.addEventListener('change', (e) => {
        node.data.action = e.target.value;
        updateGenerateButton(node);
    });

    // Generate button
    const generateBtn = nodeEl.querySelector('.generate-btn');
    generateBtn.addEventListener('click', () => generateImage(node));

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection points
    nodeEl.querySelectorAll('.connection-point').forEach(point => {
        setupConnectionPoint(point, nodeId);
    });

    setupNodeDragging(nodeEl, node);
    updateStatus('Action node created');

    return node;
}

// Create Prompt Node
function createPromptNode(x = 300, y = 100) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node prompt-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Prompt Input</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content">
            <textarea placeholder="Enter your prompt here..."></textarea>
        </div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
        <div class="node-actions">
            <button class="node-btn generate-btn" disabled>Generate Image</button>
        </div>
    `;

    const node = {
        id: nodeId,
        type: 'prompt',
        element: nodeEl,
        data: { prompt: '', connectedImages: [] }, // Changed to array for multiple images
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

    // Textarea handling with debounced auto-regeneration
    let regenerateTimeout;
    const textarea = nodeEl.querySelector('textarea');
    textarea.addEventListener('input', (e) => {
        node.data.prompt = e.target.value;
        updateGenerateButton(node);
        
        // Auto-regenerate if there's already a result node
        if (node.data.resultNode && node.data.connectedImage && node.data.prompt.trim()) {
            // Clear existing timeout
            clearTimeout(regenerateTimeout);
            // Debounce: wait 1 second after user stops typing
            regenerateTimeout = setTimeout(() => {
                generateImage(node);
            }, 1000);
        }
    });

    // Generate button
    const generateBtn = nodeEl.querySelector('.generate-btn');
    generateBtn.addEventListener('click', () => generateImage(node));

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection points
    nodeEl.querySelectorAll('.connection-point').forEach(point => {
        setupConnectionPoint(point, nodeId);
    });

    setupNodeDragging(nodeEl, node);
    updateStatus('Prompt node created');

    return node;
}

// Create Result Node
function createResultNode(x, y, imageUrl, sourcePromptNode = null) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node result-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    const img = document.createElement('img');
    img.src = imageUrl;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Generated Result</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content"></div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
    `;

    const node = {
        id: nodeId,
        type: 'result',
        element: nodeEl,
        data: { 
            image: img, 
            imageData: imageUrl, 
            imageWidth: 250,
            sourcePromptNode: sourcePromptNode // Store reference to prompt node
        },
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);
    
    const content = nodeEl.querySelector('.node-content');
    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper';
    img.style.width = `${node.data.imageWidth}px`;
    wrapper.appendChild(img);
    
    const controls = document.createElement('div');
    controls.className = 'image-controls';
    controls.innerHTML = `
        <button class="scale-btn" data-action="smaller">-</button>
        <span class="scale-label">${node.data.imageWidth}px</span>
        <button class="scale-btn" data-action="larger">+</button>
    `;
    
    content.appendChild(wrapper);
    content.appendChild(controls);
    
    // Add action buttons (lightbox and download)
    const actionButtons = document.createElement('div');
    actionButtons.className = 'image-actions';
    actionButtons.innerHTML = `
        <button class="icon-btn" title="View Full Size">⛶</button>
        <button class="icon-btn" title="Download Image">↓</button>
    `;
    content.appendChild(actionButtons);
    
    const lightboxBtn = actionButtons.querySelector('.icon-btn:nth-child(1)');
    const downloadBtn = actionButtons.querySelector('.icon-btn:nth-child(2)');
    
    lightboxBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(node.data.imageData);
    });
    
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadImage(node.data.imageData, 'generated-result.png');
    });
    
    const smallerBtn = controls.querySelector('[data-action="smaller"]');
    const largerBtn = controls.querySelector('[data-action="larger"]');
    const scaleLabel = controls.querySelector('.scale-label');
    
    smallerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        node.data.imageWidth = Math.max(100, node.data.imageWidth - 50);
        img.style.width = `${node.data.imageWidth}px`;
        scaleLabel.textContent = `${node.data.imageWidth}px`;
    });
    
    largerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        node.data.imageWidth = Math.min(800, node.data.imageWidth + 50);
        img.style.width = `${node.data.imageWidth}px`;
        scaleLabel.textContent = `${node.data.imageWidth}px`;
    });

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection points
    nodeEl.querySelectorAll('.connection-point').forEach(point => {
        setupConnectionPoint(point, nodeId);
    });

    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    nodeEl.appendChild(resizeHandle);
    setupNodeResize(nodeEl, node, resizeHandle);

    setupNodeDragging(nodeEl, node);

    // If linked to a prompt node, auto-connect them
    if (sourcePromptNode) {
        connections.push({
            from: sourcePromptNode.id,
            to: nodeId
        });
        drawConnections();
    }

    return node;
}

// Update generate button state
function updateGenerateButton(node) {
    const generateBtn = node.element.querySelector('.generate-btn');
    
    // Count images from this node
    let totalImages = node.data.connectedImages.length;
    
    // Also count images from connected prompt nodes
    if (node.data.connectedPrompts && node.data.connectedPrompts.length > 0) {
        node.data.connectedPrompts.forEach(promptNode => {
            if (promptNode.data.connectedImages) {
                totalImages += promptNode.data.connectedImages.length;
            }
        });
    }
    
    const hasImages = totalImages > 0;
    
    let hasContent = false;
    if (node.type === 'prompt') {
        hasContent = node.data.prompt.trim().length > 0;
    } else if (node.type === 'action') {
        hasContent = node.data.action.trim().length > 0;
    }
    
    // Enable button if there's content (with or without images)
    generateBtn.disabled = !hasContent;
    
    // Update button text to show image count
    if (hasImages) {
        generateBtn.textContent = `Generate (${totalImages} image${totalImages > 1 ? 's' : ''})`;
    } else {
        generateBtn.textContent = 'Generate Image';
    }
}

// Setup node resizing
let isResizing = false;
let resizedNode = null;
let resizeStart = { x: 0, y: 0, width: 0, height: 0 };

function setupNodeResize(nodeEl, node, resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizing = true;
        resizedNode = node;
        
        resizeStart.x = e.clientX;
        resizeStart.y = e.clientY;
        resizeStart.width = nodeEl.offsetWidth;
        resizeStart.height = nodeEl.offsetHeight;
    });
}

// Setup node dragging
function setupNodeDragging(nodeEl, node) {
    nodeEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.connection-point') || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.tagName === 'BUTTON' ||
            e.target.tagName === 'INPUT') {
            return;
        }

        isDragging = true;
        draggedNode = node;
        
        // Calculate offset in canvas space (not screen space)
        const container = nodeCanvas.getBoundingClientRect();
        const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
        const mouseCanvasY = (e.clientY - container.top) / zoom - panY;
        
        dragOffset.x = mouseCanvasX - node.position.x;
        dragOffset.y = mouseCanvasY - node.position.y;
        nodeEl.style.zIndex = 1000;
    });
}

// Global mouse move handler
document.addEventListener('mousemove', (e) => {
    if (isResizing && resizedNode) {
        const deltaX = (e.clientX - resizeStart.x) / zoom;
        
        const newWidth = Math.max(250, resizeStart.width + deltaX);
        
        resizedNode.element.style.width = `${newWidth}px`;
        
        // Scale the image if it exists
        if (resizedNode.data.image && resizedNode.data.imageData) {
            const scaleFactor = newWidth / resizeStart.width;
            const newImageWidth = Math.round(250 * scaleFactor);
            
            resizedNode.data.imageWidth = newImageWidth;
            const img = resizedNode.data.image;
            img.style.width = `${newImageWidth}px`;
            
            // Update the scale label if it exists
            const scaleLabel = resizedNode.element.querySelector('.scale-label');
            if (scaleLabel) {
                scaleLabel.textContent = `${newImageWidth}px`;
            }
        }
        
        drawConnections();
        return;
    }
    
    if (isDragging && draggedNode) {
        const container = nodeCanvas.getBoundingClientRect();
        
        // Convert screen coordinates to canvas space
        const mouseCanvasX = (e.clientX - container.left) / zoom - panX;
        const mouseCanvasY = (e.clientY - container.top) / zoom - panY;
        
        // Calculate new position using the stored offset
        draggedNode.position.x = mouseCanvasX - dragOffset.x;
        draggedNode.position.y = mouseCanvasY - dragOffset.y;

        draggedNode.element.style.left = `${draggedNode.position.x}px`;
        draggedNode.element.style.top = `${draggedNode.position.y}px`;

        drawConnections();
    }
    
    // Update temporary connection while dragging
    if (isConnecting && connectionStart) {
        const container = connectionCanvas.getBoundingClientRect();
        // Mouse position in screen space (canvas coordinates)
        const mouseX = e.clientX - container.left;
        const mouseY = e.clientY - container.top;
        tempConnectionEnd.x = mouseX;
        tempConnectionEnd.y = mouseY;
        drawConnections();
    }
});

// Global mouse up handler
document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizedNode = null;
    }
    
    if (isDragging && draggedNode) {
        draggedNode.element.style.zIndex = '';
    }
    isDragging = false;
    draggedNode = null;
    
    // Cancel connection if not dropped on a valid point
    if (isConnecting) {
        isConnecting = false;
        connectionStart = null;
        drawConnections();
    }
});

// Setup connection points
function setupConnectionPoint(pointEl, nodeId) {
    pointEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isConnecting = true;
        connectionStart = { nodeId, type: pointEl.classList.contains('input') ? 'input' : 'output', element: pointEl };
    });

    pointEl.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        if (isConnecting && connectionStart) {
            const endType = pointEl.classList.contains('input') ? 'input' : 'output';
            const endNodeId = pointEl.dataset.node;

            // Can't connect to same node or same type
            if (connectionStart.nodeId !== endNodeId && connectionStart.type !== endType) {
                createConnection(connectionStart.nodeId, endNodeId, connectionStart.type, endType);
            }
        }
        isConnecting = false;
        connectionStart = null;
    });
}

// Create connection between nodes
function createConnection(fromNodeId, toNodeId, fromType, toType) {
    const fromNode = nodes.find(n => n.id === fromNodeId);
    const toNode = nodes.find(n => n.id === toNodeId);

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
    const exists = connections.some(c => 
        c.from === sourceNode.id && c.to === targetNode.id
    );

    if (exists) return;

    // Create connection
    connections.push({
        from: sourceNode.id,
        to: targetNode.id
    });

    // Update prompt/action node with connected images (from image or result node)
    if ((targetNode.type === 'prompt' || targetNode.type === 'action') && (sourceNode.type === 'image' || sourceNode.type === 'result')) {
        // Add to array if not already present
        if (!targetNode.data.connectedImages.includes(sourceNode)) {
            targetNode.data.connectedImages.push(sourceNode);
        }
        updateGenerateButton(targetNode);
    }
    
    // Allow chaining prompts to prompts/actions
    if ((targetNode.type === 'prompt' || targetNode.type === 'action') && sourceNode.type === 'prompt') {
        if (!targetNode.data.connectedPrompts) {
            targetNode.data.connectedPrompts = [];
        }
        if (!targetNode.data.connectedPrompts.includes(sourceNode)) {
            targetNode.data.connectedPrompts.push(sourceNode);
        }
        updateGenerateButton(targetNode);
    }

    drawConnections();
    updateStatus('Nodes connected', '#27ae60');
}

// Draw all connections
function drawConnections() {
    ctx.clearRect(0, 0, connectionCanvas.width, connectionCanvas.height);

    // Draw established connections
    connections.forEach((conn, index) => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);

        if (!fromNode || !toNode) return;

        const fromPoint = getConnectionPoint(fromNode, 'output');
        const toPoint = getConnectionPoint(toNode, 'input');

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
        
        // Calculate midpoint of the curve (t=0.5)
        const t = 0.5;
        const midX = Math.pow(1-t, 3) * fromPoint.x +
                     3 * Math.pow(1-t, 2) * t * cp1x +
                     3 * (1-t) * Math.pow(t, 2) * cp2x +
                     Math.pow(t, 3) * toPoint.x;
        const midY = Math.pow(1-t, 3) * fromPoint.y +
                     3 * Math.pow(1-t, 2) * t * cp1y +
                     3 * (1-t) * Math.pow(t, 2) * cp2y +
                     Math.pow(t, 3) * toPoint.y;
        
        // Store midpoint for click detection
        conn.midpoint = { x: midX, y: midY };
        
        // Draw disconnect button (small circle with minus)
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
    
    // Draw temporary connection while dragging
    if (isConnecting && connectionStart) {
        const startNode = nodes.find(n => n.id === connectionStart.nodeId);
        if (startNode) {
            const startPoint = getConnectionPoint(startNode, connectionStart.type);
            
            ctx.beginPath();
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            
            const cp1x = startPoint.x + (tempConnectionEnd.x - startPoint.x) / 2;
            const cp1y = startPoint.y;
            const cp2x = startPoint.x + (tempConnectionEnd.x - startPoint.x) / 2;
            const cp2y = tempConnectionEnd.y;
            
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tempConnectionEnd.x, tempConnectionEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

// Get connection point coordinates in screen space (with zoom applied)
function getConnectionPoint(node, type) {
    // Get actual node dimensions
    const nodeWidth = node.element.offsetWidth;
    const nodeHeight = node.element.offsetHeight;
    
    // Calculate position in node space
    let x, y;
    if (type === 'output') {
        x = node.position.x + nodeWidth;
        y = node.position.y + nodeHeight / 2;
    } else {
        x = node.position.x;
        y = node.position.y + nodeHeight / 2;
    }
    
    // Apply zoom transform to get screen position
    return {
        x: (x + panX) * zoom,
        y: (y + panY) * zoom
    };
}

// Remove node
function removeNode(nodeId) {
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;

    const node = nodes[nodeIndex];
    node.element.remove();
    nodes.splice(nodeIndex, 1);

    // Remove associated connections
    connections = connections.filter(c => c.from !== nodeId && c.to !== nodeId);

    drawConnections();
    updateStatus('Node removed');
}

// Clear all nodes
function clearCanvas() {
    if (confirm('Are you sure you want to clear all nodes?')) {
        nodes.forEach(node => node.element.remove());
        nodes = [];
        connections = [];
        drawConnections();
        updateStatus('Canvas cleared');
    }
}

// Generate image using Google GenAI API
async function generateImage(node) {
    // Collect images from this node and from connected prompt nodes
    let imageNodes = [...(node.data.connectedImages || [])];
    
    // Also collect images from connected prompt nodes
    if (node.data.connectedPrompts && node.data.connectedPrompts.length > 0) {
        node.data.connectedPrompts.forEach(promptNode => {
            if (promptNode.data.connectedImages) {
                promptNode.data.connectedImages.forEach(imgNode => {
                    if (!imageNodes.includes(imgNode)) {
                        imageNodes.push(imgNode);
                    }
                });
            }
        });
    }

    // Build combined prompt from connected prompts and own prompt
    let promptParts = [];
    
    // Add connected prompts first
    if (node.data.connectedPrompts && node.data.connectedPrompts.length > 0) {
        node.data.connectedPrompts.forEach(promptNode => {
            const connectedPrompt = promptNode.data.prompt.trim();
            if (connectedPrompt) {
                promptParts.push(connectedPrompt);
            }
        });
    }
    
    // Add this node's own prompt/action
    let ownPrompt = '';
    if (node.type === 'prompt') {
        ownPrompt = node.data.prompt.trim();
    } else if (node.type === 'action') {
        ownPrompt = node.data.action.trim();
    }
    
    if (ownPrompt) {
        promptParts.push(ownPrompt);
    }
    
    // Combine all prompts
    const prompt = promptParts.join(', ');
    
    if (!prompt) {
        updateStatus('No prompt or action provided', '#e74c3c');
        return;
    }

    const generateBtn = node.element.querySelector('.generate-btn');
    const originalText = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="loading"></span> Generating...';
    updateStatus('Generating image...', '#667eea');

    try {
        // Collect all image data from connected nodes (optional now)
        const images = imageNodes.map(node => node.data.imageData).filter(data => data);

        // Call the backend API (with or without images)
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt,
                images: images  // Send array of images
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate image');
        }

        const result = await response.json();
        
        // Create a result node with the generated image
        const nodeRect = node.element.getBoundingClientRect();
        const container = nodeCanvas.getBoundingClientRect();
        const resultX = nodeRect.left - container.left + nodeRect.width + 50;
        const resultY = nodeRect.top - container.top;

        if (result.image) {
            // Check if there's already a result node for this prompt/action
            const existingResult = nodes.find(n => 
                n.type === 'result' && n.data.sourcePromptNode === node
            );
            
            if (existingResult) {
                // Update existing result node image
                const img = existingResult.data.image;
                img.src = result.image;
                existingResult.data.imageData = result.image;
                updateStatus('Image regenerated successfully!', '#27ae60');
            } else {
                // Create new result node and link it to prompt/action
                const resultNode = createResultNode(resultX, resultY, result.image, node);
                node.data.resultNode = resultNode;
            }
            updateStatus('Image generated successfully!', '#27ae60');
        } else if (result.text) {
            updateStatus(`Generated text: ${result.text}`, '#667eea');
            alert(`API Response: ${result.text}\n\nNote: No image was generated. The model may have returned text instead.`);
        } else {
            throw new Error('No image or text returned from API');
        }

    } catch (error) {
        console.error('Generation error:', error);
        updateStatus(`Error: ${error.message}`, '#e74c3c');
        
        let errorMessage = `Generation failed: ${error.message}`;
        if (error.message.includes('fetch')) {
            errorMessage += '\n\nMake sure the backend server is running on http://localhost:3000';
            errorMessage += '\nRun: npm start';
        }
        alert(errorMessage);
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = originalText;
    }
}

// Helper function to get center of visible viewport in canvas coordinates
function getViewportCenter() {
    const container = document.querySelector('.canvas-container');
    const centerX = (container.clientWidth / 2) / zoom - panX;
    const centerY = (container.clientHeight / 2) / zoom - panY;
    return { x: centerX, y: centerY };
}

// Event listeners
document.getElementById('addImageNode').addEventListener('click', () => {
    const center = getViewportCenter();
    createImageNode(center.x - 125, center.y - 75);
});

document.getElementById('addPromptNode').addEventListener('click', () => {
    const center = getViewportCenter();
    createPromptNode(center.x - 125, center.y - 75);
});

document.getElementById('addActionNode').addEventListener('click', () => {
    const center = getViewportCenter();
    createActionNode(center.x - 125, center.y - 75);
});

document.getElementById('clearCanvas').addEventListener('click', clearCanvas);

// Zoom functions
function applyZoom() {
    const transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    nodeCanvas.style.transform = transform;
    nodeCanvas.style.transformOrigin = '0 0';
    updateZoomLevel();
    drawConnections();
    updateMinimap();
}

function setZoom(newZoom) {
    zoom = Math.max(0.1, Math.min(3, newZoom));
    applyZoom();
}

function updateZoomLevel() {
    document.getElementById('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
}

// Mouse wheel zoom (zoom to mouse position)
const canvasContainer = document.querySelector('.canvas-container');
canvasContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    const rect = canvasContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate mouse position in canvas space before zoom
    const canvasX = mouseX / zoom - panX;
    const canvasY = mouseY / zoom - panY;
    
    // Apply zoom
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(3, zoom + delta));
    
    // Adjust pan to keep mouse position stable
    panX = mouseX / newZoom - canvasX;
    panY = mouseY / newZoom - canvasY;
    
    zoom = newZoom;
    applyZoom();
}, { passive: false });

// Middle mouse button panning
let isMiddlePanning = false;
let middlePanStart = { x: 0, y: 0 };

canvasContainer.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        isMiddlePanning = true;
        middlePanStart = { x: e.clientX, y: e.clientY };
        canvasContainer.style.cursor = 'grabbing';
    }
});

document.addEventListener('mousemove', (e) => {
    if (isMiddlePanning) {
        const dx = (e.clientX - middlePanStart.x) / zoom;
        const dy = (e.clientY - middlePanStart.y) / zoom;
        
        panX += dx;
        panY += dy;
        
        middlePanStart = { x: e.clientX, y: e.clientY };
        applyZoom();
    }
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 1 && isMiddlePanning) {
        isMiddlePanning = false;
        canvasContainer.style.cursor = '';
    }
});

// Click on connections to disconnect
connectionCanvas.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = connectionCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    console.log('Canvas clicked at:', clickX, clickY);
    
    // Check if click is on any disconnect button
    for (let i = connections.length - 1; i >= 0; i--) {
        const conn = connections[i];
        
        if (!conn.midpoint) continue;
        
        // Check if click is within the disconnect button (increased hitbox for easier clicking)
        const distance = Math.sqrt(
            Math.pow(clickX - conn.midpoint.x, 2) + 
            Math.pow(clickY - conn.midpoint.y, 2)
        );
        
        console.log('Distance to connection', i, ':', distance, 'midpoint:', conn.midpoint);
        
        if (distance <= 25) {
            console.log('Removing connection', i);
            // Found a click on disconnect button
            const fromNode = nodes.find(n => n.id === conn.from);
            const toNode = nodes.find(n => n.id === conn.to);
            
            // Remove connection
            connections.splice(i, 1);
            
            // Update prompt/action node if this was an image or prompt connection
            if (toNode && (toNode.type === 'prompt' || toNode.type === 'action') && fromNode) {
                // Check for image connection
                if (toNode.data.connectedImages) {
                    const imageIndex = toNode.data.connectedImages.indexOf(fromNode);
                    if (imageIndex > -1) {
                        toNode.data.connectedImages.splice(imageIndex, 1);
                    }
                }
                
                // Check for prompt connection
                if (toNode.data.connectedPrompts && fromNode.type === 'prompt') {
                    const promptIndex = toNode.data.connectedPrompts.indexOf(fromNode);
                    if (promptIndex > -1) {
                        toNode.data.connectedPrompts.splice(promptIndex, 1);
                    }
                }
                
                updateGenerateButton(toNode);
            }
            
            drawConnections();
            updateStatus('Connection removed', '#e74c3c');
            e.preventDefault();
            return;
        }
    }
});

// Zoom controls
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 0.1));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 0.1));
document.getElementById('zoomReset').addEventListener('click', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyZoom();
});

// Minimap
function updateMinimap() {
    const scale = 0.1;
    minimapCanvas.width = 200;
    minimapCanvas.height = 150;
    
    minimapCtx.fillStyle = '#2a2a2a';
    minimapCtx.fillRect(0, 0, 200, 150);
    
    // Draw nodes on minimap
    nodes.forEach(node => {
        const x = node.position.x * scale;
        const y = node.position.y * scale;
        
        minimapCtx.fillStyle = node.type === 'result' ? '#4a4a4a' : '#404040';
        minimapCtx.fillRect(x, y, 25 * scale, 15 * scale);
    });
    
    // Draw connections on minimap
    minimapCtx.strokeStyle = '#555';
    minimapCtx.lineWidth = 1;
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (!fromNode || !toNode) return;
        
        minimapCtx.beginPath();
        minimapCtx.moveTo(fromNode.position.x * scale, fromNode.position.y * scale);
        minimapCtx.lineTo(toNode.position.x * scale, toNode.position.y * scale);
        minimapCtx.stroke();
    });
    
    // Update viewport indicator
    const viewportWidth = (canvasContainer.clientWidth / zoom) * scale;
    const viewportHeight = (canvasContainer.clientHeight / zoom) * scale;
    minimapViewport.style.width = `${viewportWidth}px`;
    minimapViewport.style.height = `${viewportHeight}px`;
    minimapViewport.style.left = `${-panX * scale}px`;
    minimapViewport.style.top = `${-panY * scale}px`;
}

// Update minimap periodically
setInterval(updateMinimap, 100);

// Download image function
function downloadImage(imageData, filename = 'generated-image.png') {
    const link = document.createElement('a');
    link.href = imageData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    updateStatus('Image downloaded', '#27ae60');
}

// Lightbox functionality
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');

function openLightbox(imageSrc) {
    lightboxImage.src = imageSrc;
    lightbox.classList.add('active');
}

function closeLightbox() {
    lightbox.classList.remove('active');
    lightboxImage.src = '';
}

lightbox.addEventListener('click', closeLightbox);

// Prevent closing when clicking the image itself
lightboxImage.addEventListener('click', (e) => {
    e.stopPropagation();
});

// Close lightbox with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
        closeLightbox();
    }
});

// Drag and drop images onto canvas
canvasContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

canvasContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
        const rect = canvasContainer.getBoundingClientRect();
        const dropX = (e.clientX - rect.left) / zoom - panX;
        const dropY = (e.clientY - rect.top) / zoom - panY;
        
        // Create an image node for each dropped image
        imageFiles.forEach((file, index) => {
            const offsetY = index * 20; // Offset multiple images slightly
            const newNode = createImageNode(dropX, dropY + offsetY);
            
            // Load the image into the node
            handleImageFile(file, newNode);
        });
    }
});

// Context menu functionality
const contextMenu = document.getElementById('contextMenu');
let contextMenuPosition = { x: 0, y: 0 };

// Show context menu on right-click
canvasContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    // Store the position for node creation
    const rect = canvasContainer.getBoundingClientRect();
    contextMenuPosition.x = (e.clientX - rect.left) / zoom - panX;
    contextMenuPosition.y = (e.clientY - rect.top) / zoom - panY;
    
    // Position the menu at cursor
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.classList.add('active');
});

// Handle context menu item clicks
contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        
        switch(action) {
            case 'addImage':
                createImageNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addPrompt':
                createPromptNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addAction':
                createActionNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
        }
        
        contextMenu.classList.remove('active');
    });
});

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        contextMenu.classList.remove('active');
    }
});

// Hide context menu on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenu.classList.contains('active')) {
        contextMenu.classList.remove('active');
    }
});

// Initialize with sample nodes
updateStatus('Ready - Add nodes to get started');
updateMinimap();
