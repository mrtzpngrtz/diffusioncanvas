// Authentication handling
const loginModal = document.getElementById('loginModal');
const userInfo = document.getElementById('userInfo');
const userPhoto = document.getElementById('userPhoto');
const userName = document.getElementById('userName');
const localLoginForm = document.getElementById('localLoginForm');
const loginError = document.getElementById('loginError');

// Handle local login form submission
if (localLoginForm) {
    localLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';

        const email = localLoginForm.email.value;
        const password = localLoginForm.password.value;

        try {
            const response = await fetch('/auth/local/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Login failed');
            }

            // On successful login, re-check auth to update UI
            await checkAuth();

        } catch (error) {
            loginError.textContent = error.message;
        }
    });
}

// Check which OAuth providers are available
async function checkAvailableProviders() {
    try {
        const response = await fetch('/api/auth/providers');
        const providers = await response.json();
        
        // Hide unavailable provider buttons
        const googleBtn = document.querySelector('.google-btn');
        const facebookBtn = document.querySelector('.facebook-btn');
        const linkedinBtn = document.querySelector('.linkedin-btn');
        
        if (googleBtn && !providers.google) {
            googleBtn.style.display = 'none';
        }
        if (facebookBtn && !providers.facebook) {
            facebookBtn.style.display = 'none';
        }
        if (linkedinBtn && !providers.linkedin) {
            linkedinBtn.style.display = 'none';
        }
        
        // Show message if no providers are configured
        const hasAnyProvider = providers.google || providers.facebook || providers.linkedin;
        if (!hasAnyProvider) {
            const oauthButtons = document.querySelector('.oauth-buttons');
            if (oauthButtons) {
                oauthButtons.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #e74c3c;">
                        <p style="margin-bottom: 10px;">No OAuth providers configured</p>
                        <p style="font-size: 12px; color: #888;">Please configure at least one OAuth provider in your .env file.</p>
                        <p style="font-size: 12px; color: #888;">See OAUTH_SETUP.md for instructions.</p>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Failed to check available providers:', error);
    }
}

// Check authentication status on page load
async function checkAuth() {
    try {
        const response = await fetch('/api/user', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.user) {
            // User is authenticated
            loginModal.classList.add('hidden');
            userInfo.style.display = 'flex';
            userPhoto.src = data.user.photo || '/user_placeholder.png';
            userPhoto.onerror = () => {
                userPhoto.onerror = null;
                userPhoto.src = '/user_placeholder.png';
            };
            userName.textContent = data.user.displayName || data.user.email;
            
            // Show credits
            const userCredits = document.getElementById('userCredits');
            if (userCredits) {
                const credits = data.user.credits || 0;
                userCredits.textContent = `${credits} credit${credits !== 1 ? 's' : ''}`;
            }
            
            // Show admin link if user is admin
            const adminLink = document.getElementById('adminLink');
            if (data.user.isAdmin && adminLink) {
                adminLink.style.display = 'inline-block';
            }
        } else {
            // User is not authenticated
            loginModal.classList.remove('hidden');
            userInfo.style.display = 'none';
            // Check which providers are available
            await checkAvailableProviders();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        loginModal.classList.remove('hidden');
        userInfo.style.display = 'none';
        await checkAvailableProviders();
    }
}

// User menu functionality
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');

if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('active');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-info-wrapper')) {
            userDropdown.classList.remove('active');
        }
    });
}

// Delete account functionality
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.')) {
            try {
                const response = await fetch('/api/user/delete', {
                    method: 'DELETE',
                    credentials: 'include'
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to delete account');
                }

                alert('Your account has been deleted successfully.');
                window.location.href = '/auth/logout';
            } catch (error) {
                alert('Failed to delete account: ' + error.message);
            }
        }
    });
}

// Check auth on page load
window.addEventListener('load', () => {
    checkAuth();
});

// Theme toggle functionality
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.querySelector('.theme-icon');

// Load saved theme preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    themeIcon.textContent = '●';
}

// Toggle theme
function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const isLightMode = document.body.classList.contains('light-mode');
    
    // Update icon
    themeIcon.textContent = isLightMode ? '●' : '○';
    
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

// Compress image to reduce payload size for API
function compressImage(imageData, maxWidth = 1024) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // Calculate new dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            // Create canvas and compress
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Compress to JPEG with 0.7 quality (much smaller than PNG)
            const compressed = canvas.toDataURL('image/jpeg', 0.7);
            resolve(compressed);
        };
        img.src = imageData;
    });
}

// Handle image file upload
function handleImageFile(file, node) {
    const MAX_FILE_SIZE_MB = 10; // Increased since we'll compress later
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    
    // Check file size before processing
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
        updateStatus(`Error: Image is too large (${fileSizeMB} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`, '#e74c3c');
        alert(`Image file is too large!\n\nFile size: ${fileSizeMB} MB\nMaximum allowed: ${MAX_FILE_SIZE_MB} MB\n\nPlease use a smaller image file.`);
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.onload = () => {
            img.addEventListener('dragstart', (e) => e.preventDefault());
            node.data.image = img;
            node.data.imageData = e.target.result;
            node.data.originalWidth = img.naturalWidth;
            node.data.originalHeight = img.naturalHeight;
            node.data.imageWidth = 250; // This is now display width
            const content = node.element.querySelector('.node-content');
            content.innerHTML = '';
            
            const wrapper = document.createElement('div');
            wrapper.className = 'image-wrapper';
            img.style.width = `${node.data.imageWidth}px`;
            wrapper.appendChild(img);
            
            content.appendChild(wrapper);
            
            // Add small scale indicator
            const scaleIndicator = document.createElement('div');
            scaleIndicator.className = 'scale-indicator';
            scaleIndicator.textContent = `${node.data.originalWidth} x ${node.data.originalHeight}px`;
            content.appendChild(scaleIndicator);
            
            // Add action buttons (lightbox and download)
            const actionButtons = document.createElement('div');
            actionButtons.className = 'image-actions';
            actionButtons.innerHTML = `
                <button class="icon-btn" title="View Full Size">⛶</button>
                <button class="icon-btn" title="Download Image">↓</button>
                <button class="icon-btn node-clone" title="Clone Node">⎘</button>
            `;
            content.appendChild(actionButtons);
            
            actionButtons.querySelector('.node-clone').addEventListener('click', () => cloneNode(node.id));
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
            
            const clearButton = node.element.querySelector('.clear-button');
            if (clearButton) {
                clearButton.style.display = 'inline-block';
            }
            
            updateStatus('Image loaded successfully', '#27ae60');
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
            <select class="aspect-ratio-select">
                <option value="1:1">1:1 (1024x1024)</option>
                <option value="2:3">2:3 (832x1248)</option>
                <option value="3:2">3:2 (1248x832)</option>
                <option value="3:4">3:4 (864x1184)</option>
                <option value="4:3">4:3 (1184x864)</option>
                <option value="4:5">4:5 (896x1152)</option>
                <option value="5:4">5:4 (1152x896)</option>
                <option value="9:16">9:16 (768x1344)</option>
                <option value="16:9" selected>16:9 (1344x768)</option>
                <option value="21:9">21:9 (1536x672)</option>
            </select>
            <div class="prompt-actions">
                <button class="icon-btn node-clone" title="Clone Node">⎘</button>
            </div>
        </div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
        <div class="node-actions">
            <div class="model-indicator">Imagen 4.0</div>
            <button class="node-btn generate-btn" disabled>Generate Image</button>
        </div>
    `;

    const node = {
        id: nodeId,
        type: 'prompt',
        element: nodeEl,
        data: { prompt: '', aspectRatio: '16:9', connectedImages: [] }, // Changed to array for multiple images
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

    // Aspect ratio select handling
    const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
    aspectRatioSelect.addEventListener('change', (e) => {
        node.data.aspectRatio = e.target.value;
    });

    // Clone button
    const cloneBtn = nodeEl.querySelector('.node-clone');
    cloneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cloneNode(node.id);
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
    img.addEventListener('dragstart', (e) => e.preventDefault());

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
            imageWidth: 250, // display width
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
    
    content.appendChild(wrapper);
    
    // Add small scale indicator
    const scaleIndicator = document.createElement('div');
    scaleIndicator.className = 'scale-indicator';
    scaleIndicator.textContent = `Loading...`;
    content.appendChild(scaleIndicator);

    img.onload = () => {
        node.data.originalWidth = img.naturalWidth;
        node.data.originalHeight = img.naturalHeight;
        scaleIndicator.textContent = `${node.data.originalWidth} x ${node.data.originalHeight}px`;
    };
    
    // Add action buttons (lightbox and download)
    const actionButtons = document.createElement('div');
    actionButtons.className = 'image-actions';
    actionButtons.innerHTML = `
        <button class="icon-btn" title="View Full Size">⛶</button>
        <button class="icon-btn" title="Download Image">↓</button>
        <button class="icon-btn node-clone" title="Clone Node">⎘</button>
    `;
    content.appendChild(actionButtons);
    
    actionButtons.querySelector('.node-clone').addEventListener('click', () => cloneNode(node.id));
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
    
    // Only count images DIRECTLY connected to this node
    // Don't count images from chained prompts to match what we actually send
    let totalImages = node.data.connectedImages.length;
    console.log(`updateGenerateButton for ${node.id}: ${totalImages} directly connected images`, node.data.connectedImages.map(n => n.id));
    
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
    
    // Update model indicator based on whether there are connected images
    const modelIndicator = node.element.querySelector('.model-indicator');
    if (modelIndicator) {
        if (hasImages) {
            modelIndicator.textContent = 'Gemini 2.5 Flash';
        } else {
            modelIndicator.textContent = 'Imagen 4.0';
        }
    }
    
    // Show/hide aspect ratio selector based on whether images are connected
    const aspectRatioSelect = node.element.querySelector('.aspect-ratio-select');
    if (aspectRatioSelect) {
        if (hasImages) {
            // Hide aspect ratio when using Gemini 2.5 Flash (image-to-image)
            aspectRatioSelect.style.display = 'none';
        } else {
            // Show aspect ratio when using Imagen 4.0 (text-to-image)
            aspectRatioSelect.style.display = 'block';
        }
    }
}

// Setup node resizing
let isResizing = false;
let resizedNode = null;
let resizeStart = { x: 0, y: 0, width: 0, height: 0, imageWidth: 0 };

function setupNodeResize(nodeEl, node, resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizing = true;
        resizedNode = node;
        
        resizeStart.x = e.clientX;
        resizeStart.y = e.clientY;
        resizeStart.width = nodeEl.offsetWidth;
        resizeStart.height = nodeEl.offsetHeight;
        // Store the initial image width if it exists
        resizeStart.imageWidth = node.data.imageWidth || 250; // This is display width
    });
}

// Setup node dragging
function setupNodeDragging(nodeEl, node) {
    nodeEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.connection-point') || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.tagName === 'BUTTON' ||
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'SELECT') {
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
            // Calculate scale factor based on node width change
            const scaleFactor = newWidth / resizeStart.width;
            // Apply scale factor to the INITIAL image width (from when resize started)
            const newImageWidth = Math.round(resizeStart.imageWidth * scaleFactor);
            
            resizedNode.data.imageWidth = newImageWidth;
            const img = resizedNode.data.image;
            img.style.width = `${newImageWidth}px`;
            
            // Update scale indicator if it exists
            const scaleIndicator = resizedNode.element.querySelector('.scale-indicator');
            if (scaleIndicator) {
                scaleIndicator.textContent = `${resizedNode.data.originalWidth} x ${resizedNode.data.originalHeight}px`;
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
        const container = canvasContainer.getBoundingClientRect();
        // Convert mouse position to canvas space (accounting for zoom/pan)
        const mouseX = (e.clientX - container.left) / zoom - panX;
        const mouseY = (e.clientY - container.top) / zoom - panY;
        tempConnectionEnd.x = mouseX;
        tempConnectionEnd.y = mouseY;
        drawConnections();
    }
});

// Global mouse up handler
document.addEventListener('mouseup', (e) => {
    if (isResizing) {
        isResizing = false;
        resizedNode = null;
    }
    
    if (isDragging && draggedNode) {
        draggedNode.element.style.zIndex = '';
    }
    isDragging = false;
    draggedNode = null;
    
    // This is a fallback to cancel connection if mouse is released outside the window or on a non-canvas element
    if (isConnecting) {
        const endPoint = document.elementFromPoint(e.clientX, e.clientY);
        if (!endPoint || (endPoint.id !== 'connectionCanvas' && !endPoint.classList.contains('connection-point'))) {
            isConnecting = false;
            connectionStart = null;
            drawConnections();
        }
    }
});

// Setup connection points
function setupConnectionPoint(pointEl, nodeId) {
    pointEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isConnecting = true;
        connectionStart = { nodeId, type: pointEl.classList.contains('input') ? 'input' : 'output', element: pointEl };
        
        // Add a one-time mouseup listener to the whole canvas to handle this connection attempt
        const connectionMouseUp = (upEvent) => {
            if (isConnecting && connectionStart) {
                const endPoint = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
                const isOverConnectionPoint = endPoint && endPoint.classList.contains('connection-point') &&
                                              endPoint.dataset.node !== connectionStart.nodeId &&
                                              ((connectionStart.type === 'output' && endPoint.classList.contains('input')) ||
                                               (connectionStart.type === 'input' && endPoint.classList.contains('output')));

                if (isOverConnectionPoint) {
                    // If it's a valid connection point, create the connection
                    const endType = endPoint.classList.contains('input') ? 'input' : 'output';
                    const endNodeId = endPoint.dataset.node;
                    createConnection(connectionStart.nodeId, endNodeId, connectionStart.type, endType);
                    connectionStart = null;
                } else {
                    // Otherwise, show the context menu to create a new node
                    const rect = canvasContainer.getBoundingClientRect();
                    contextMenuPosition.x = (upEvent.clientX - rect.left) / zoom - panX;
                    contextMenuPosition.y = (upEvent.clientY - rect.top) / zoom - panY;
                    showConnectionMenu(upEvent.clientX, upEvent.clientY);
                    // connectionStart is nulled by the context menu handler
                }
                
                isConnecting = false;
                drawConnections();
            }
            // Clean up this specific listener
            document.removeEventListener('mouseup', connectionMouseUp);
        };
        
        document.addEventListener('mouseup', connectionMouseUp);
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

    // Update prompt/action node with connected images (from image, result, or draw node)
    if ((targetNode.type === 'prompt' || targetNode.type === 'action') && (sourceNode.type === 'image' || sourceNode.type === 'result' || sourceNode.type === 'draw')) {
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
    
    // Save context and apply zoom/pan transformation
    ctx.save();
    ctx.translate(panX * zoom, panY * zoom);
    ctx.scale(zoom, zoom);

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
            
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            
            const cp1x = startPoint.x + (tempConnectionEnd.x - startPoint.x) / 2;
            const cp1y = startPoint.y;
            const cp2x = startPoint.x + (tempConnectionEnd.x - startPoint.x) / 2;
            const cp2y = tempConnectionEnd.y;
            
            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tempConnectionEnd.x, tempConnectionEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    
    // Restore context
    ctx.restore();
}

// Get connection point coordinates in canvas space
function getConnectionPoint(node, type) {
    // Get actual node dimensions
    const nodeWidth = node.element.offsetWidth;
    const nodeHeight = node.element.offsetHeight;
    
    // Return position in canvas space (CSS transform will handle zoom/pan)
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

// Clone node
function cloneNode(nodeId) {
    const originalNode = nodes.find(n => n.id === nodeId);
    if (!originalNode) return;

    const newPosition = {
        x: originalNode.position.x + 30,
        y: originalNode.position.y + 30
    };

    let newNode;
    switch (originalNode.type) {
        case 'image':
            newNode = createImageNode(newPosition.x, newPosition.y);
            if (originalNode.data.imageData) {
                const file = dataURLtoFile(originalNode.data.imageData, 'cloned-image.png');
                handleImageFile(file, newNode);
            }
            break;
        case 'prompt':
            newNode = createPromptNode(newPosition.x, newPosition.y);
            newNode.data.prompt = originalNode.data.prompt;
            newNode.element.querySelector('textarea').value = originalNode.data.prompt;
            newNode.data.aspectRatio = originalNode.data.aspectRatio;
            newNode.element.querySelector('.aspect-ratio-select').value = originalNode.data.aspectRatio;
            break;
        case 'action':
            newNode = createActionNode(newPosition.x, newPosition.y);
            newNode.data.action = originalNode.data.action;
            newNode.element.querySelector('.action-select').value = originalNode.data.action;
            break;
        case 'result':
            newNode = createResultNode(newPosition.x, newPosition.y, originalNode.data.imageData);
            break;
    }

    if (newNode) {
        updateStatus(`Node ${originalNode.id} cloned to ${newNode.id}`, '#27ae60');
    }
}

// Helper to convert data URL to File object for cloning
function dataURLtoFile(dataurl, filename) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
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

// Save canvas state to file
function saveCanvas() {
    try {
        // Create a serializable version of the canvas state
        const canvasState = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            zoom: zoom,
            panX: panX,
            panY: panY,
            nodeIdCounter: nodeIdCounter,
            nodes: nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: {
                    // For image nodes
                    imageData: node.data.imageData,
                    imageWidth: node.data.imageWidth,
                    // For prompt nodes
                    prompt: node.data.prompt,
                    aspectRatio: node.data.aspectRatio,
                    // For action nodes
                    action: node.data.action,
                    // Store IDs of connected nodes instead of references
                    connectedImageIds: node.data.connectedImages ? 
                        node.data.connectedImages.map(n => n.id) : [],
                    connectedPromptIds: node.data.connectedPrompts ? 
                        node.data.connectedPrompts.map(n => n.id) : [],
                    resultNodeId: node.data.resultNode ? node.data.resultNode.id : null,
                    sourcePromptNodeId: node.data.sourcePromptNode ? node.data.sourcePromptNode.id : null
                }
            })),
            connections: connections.map(conn => ({
                from: conn.from,
                to: conn.to
            }))
        };

        // Convert to JSON and create download
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

        updateStatus('Canvas saved successfully!', '#27ae60');
    } catch (error) {
        console.error('Save error:', error);
        updateStatus('Failed to save canvas', '#e74c3c');
        alert('Failed to save canvas: ' + error.message);
    }
}

// Load canvas state from file
function loadCanvas() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const canvasState = JSON.parse(text);

            // Validate the file format
            if (!canvasState.version || !canvasState.nodes) {
                throw new Error('Invalid canvas file format');
            }

            // Confirm before loading
            if (nodes.length > 0) {
                if (!confirm('Loading will replace the current canvas. Continue?')) {
                    return;
                }
            }

            // Clear current canvas
            nodes.forEach(node => node.element.remove());
            nodes = [];
            connections = [];

            // Restore zoom and pan
            zoom = canvasState.zoom || 1;
            panX = canvasState.panX || 0;
            panY = canvasState.panY || 0;
            nodeIdCounter = canvasState.nodeIdCounter || 0;

            // Create a map to store node ID to node object mapping
            const nodeMap = new Map();

            // Track image loading promises
            const imageLoadPromises = [];

            // Recreate all nodes
            for (const nodeData of canvasState.nodes) {
                let node;
                
                switch (nodeData.type) {
                    case 'image':
                        node = createImageNode(nodeData.position.x, nodeData.position.y);
                        // Restore image if exists
                        if (nodeData.data.imageData) {
                            const imageLoadPromise = new Promise((resolve) => {
                                const img = document.createElement('img');
                                img.src = nodeData.data.imageData;
                                img.onload = () => {
                                    node.data.image = img;
                                    node.data.imageData = nodeData.data.imageData;
                                    node.data.imageWidth = nodeData.data.imageWidth || 250;
                                    node.data.originalWidth = img.naturalWidth;
                                    node.data.originalHeight = img.naturalHeight;
                                    
                                    const content = node.element.querySelector('.node-content');
                                    content.innerHTML = '';
                                    
                                    const wrapper = document.createElement('div');
                                    wrapper.className = 'image-wrapper';
                                    img.style.width = `${node.data.imageWidth}px`;
                                    wrapper.appendChild(img);
                                    content.appendChild(wrapper);
                                    
                                    // Add scale indicator
                                    const scaleIndicator = document.createElement('div');
                                    scaleIndicator.className = 'scale-indicator';
                                    scaleIndicator.textContent = `${node.data.originalWidth} x ${node.data.originalHeight}px`;
                                    content.appendChild(scaleIndicator);
                                    
                                    // Add action buttons
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
                                    
                                    resolve();
                                };
                                img.onerror = () => resolve(); // Resolve even on error to not block
                            });
                            imageLoadPromises.push(imageLoadPromise);
                        }
                        break;
                    
                    case 'prompt':
                        node = createPromptNode(nodeData.position.x, nodeData.position.y);
                        // Restore prompt and aspect ratio
                        if (nodeData.data.prompt) {
                            const textarea = node.element.querySelector('textarea');
                            textarea.value = nodeData.data.prompt;
                            node.data.prompt = nodeData.data.prompt;
                        }
                        if (nodeData.data.aspectRatio) {
                            const select = node.element.querySelector('.aspect-ratio-select');
                            select.value = nodeData.data.aspectRatio;
                            node.data.aspectRatio = nodeData.data.aspectRatio;
                        }
                        break;
                    
                    case 'action':
                        node = createActionNode(nodeData.position.x, nodeData.position.y);
                        // Restore action
                        if (nodeData.data.action) {
                            const select = node.element.querySelector('.action-select');
                            select.value = nodeData.data.action;
                            node.data.action = nodeData.data.action;
                        }
                        break;
                    
                    case 'result':
                        node = createResultNode(nodeData.position.x, nodeData.position.y, nodeData.data.imageData);
                        node.data.imageWidth = nodeData.data.imageWidth || 250;
                        // Update image width and track loading
                        const resultImg = node.data.image;
                        resultImg.style.width = `${node.data.imageWidth}px`;
                        // Track result image loading
                        const resultLoadPromise = new Promise((resolve) => {
                            if (resultImg.complete) {
                                resolve();
                            } else {
                                resultImg.onload = () => resolve();
                                resultImg.onerror = () => resolve();
                            }
                        });
                        imageLoadPromises.push(resultLoadPromise);
                        break;
                    
                    case 'draw':
                        node = createDrawNode(nodeData.position.x, nodeData.position.y);
                        // Restore the drawing if it exists
                        if (nodeData.data.imageData) {
                            const drawLoadPromise = new Promise((resolve) => {
                                const img = new Image();
                                img.onload = () => {
                                    node.data.context.drawImage(img, 0, 0);
                                    updateDrawNodeImage(node);
                                    resolve();
                                };
                                img.onerror = () => resolve();
                                img.src = nodeData.data.imageData;
                            });
                            imageLoadPromises.push(drawLoadPromise);
                        }
                        break;
                }

                // Remove the node that was auto-created and replace with our data
                const lastNode = nodes[nodes.length - 1];
                if (lastNode && lastNode.id !== nodeData.id) {
                    // Update the ID to match the saved state
                    lastNode.element.id = nodeData.id;
                    lastNode.id = nodeData.id;
                    
                    // Re-setup connection points with correct ID
                    lastNode.element.querySelectorAll('.connection-point').forEach(point => {
                        point.dataset.node = nodeData.id;
                        const newPoint = point.cloneNode(true);
                        point.parentNode.replaceChild(newPoint, point);
                        setupConnectionPoint(newPoint, nodeData.id);
                    });
                    
                    // Re-setup close button with correct ID
                    const closeBtn = lastNode.element.querySelector('.node-close');
                    if (closeBtn) {
                        const newCloseBtn = closeBtn.cloneNode(true);
                        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                        newCloseBtn.addEventListener('click', () => removeNode(nodeData.id));
                    }
                }

                nodeMap.set(nodeData.id, lastNode);
            }

            // Restore connections between nodes (rebuild references)
            for (const nodeData of canvasState.nodes) {
                const node = nodeMap.get(nodeData.id);
                if (!node) continue;

                // Restore connectedImages
                if (nodeData.data.connectedImageIds) {
                    node.data.connectedImages = nodeData.data.connectedImageIds
                        .map(id => nodeMap.get(id))
                        .filter(n => n);
                }

                // Restore connectedPrompts
                if (nodeData.data.connectedPromptIds) {
                    node.data.connectedPrompts = nodeData.data.connectedPromptIds
                        .map(id => nodeMap.get(id))
                        .filter(n => n);
                }

                // Restore resultNode reference
                if (nodeData.data.resultNodeId) {
                    node.data.resultNode = nodeMap.get(nodeData.data.resultNodeId);
                }

                // Restore sourcePromptNode reference
                if (nodeData.data.sourcePromptNodeId) {
                    node.data.sourcePromptNode = nodeMap.get(nodeData.data.sourcePromptNodeId);
                }

                // Update generate button state for prompt/action nodes
                if (node.type === 'prompt' || node.type === 'action') {
                    updateGenerateButton(node);
                }
            }

            // Restore connections
            connections = [];
            for (const connData of canvasState.connections) {
                connections.push({
                    from: connData.from,
                    to: connData.to
                });
            }

            // Update UI
            applyZoom();
            drawConnections();
            updateMinimap();
            
            // Wait for all images to load before auto-saving
            Promise.all(imageLoadPromises).then(() => {
                // Small delay to ensure everything is settled
                setTimeout(() => {
                    autoSaveCanvas();
                    updateStatus('Canvas loaded and auto-saved successfully!', '#27ae60');
                }, 100);
            });
            
            updateStatus('Canvas loaded successfully!', '#27ae60');
        } catch (error) {
            console.error('Load error:', error);
            updateStatus('Failed to load canvas', '#e74c3c');
            alert('Failed to load canvas: ' + error.message);
        }
    });

    fileInput.click();
}

// Generate image using Google GenAI API
async function generateImage(node) {
    // Only collect images DIRECTLY connected to this node
    // Don't inherit images from chained prompts to avoid payload size issues
    let imageNodes = [...(node.data.connectedImages || [])];

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
        // Collect all image data from connected nodes and compress them
        const images = [];
        if (imageNodes.length > 0) {
            updateStatus('Compressing images...', '#667eea');
            for (const imageNode of imageNodes) {
                if (imageNode.data.imageData) {
                    const compressed = await compressImage(imageNode.data.imageData, 1024);
                    images.push(compressed);
                }
            }
            updateStatus('Generating image...', '#667eea');
        }

        // Call the backend API (with or without images)
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt,
                images: images,  // Send array of images
                aspectRatio: node.data.aspectRatio || '16:9'  // Send aspect ratio
            })
        }); 

        if (!response.ok) {
            let errorMessage = 'Failed to generate image';
            
            // Special handling for 413 Payload Too Large
            if (response.status === 413) {
                errorMessage = 'Images are too large for the server to process.\n\n' +
                    'Solutions:\n' +
                    '• Use smaller images (< 1MB each)\n' +
                    '• Reduce the number of connected images\n' +
                    '• Resize images before uploading';
                throw new Error(errorMessage);
            }
            
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch (e) {
                // If response is not JSON, try to get text
                try {
                    const text = await response.text();
                    if (text) {
                        errorMessage = text.substring(0, 200); // Limit error message length
                    }
                } catch (textError) {
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
            }
            throw new Error(errorMessage);
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
            // Update credits display if returned in response
            if (result.creditsRemaining !== undefined) {
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    userCredits.textContent = `${result.creditsRemaining} credit${result.creditsRemaining !== 1 ? 's' : ''}`;
                }
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

// Create Draw Node
function createDrawNode(x = 300, y = 100) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node draw-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Draw Canvas</span>
            <button class="node-close">×</button>
        </div>
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
        <div class="connection-point output" data-node="${nodeId}"></div>
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

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

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
        
        updateDrawNodeImage(node);
    });

    // Tool selection
    toolBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = btn.dataset.tool;
            
            if (tool === 'clear') {
                drawCtx.fillStyle = '#ffffff';
                drawCtx.fillRect(0, 0, canvas.width, canvas.height);
                updateDrawNodeImage(node);
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
            updateDrawNodeImage(node);
        }
    };

    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection point
    setupConnectionPoint(nodeEl.querySelector('.connection-point'), nodeId);

    setupNodeDragging(nodeEl, node);
    updateStatus('Draw node created');

    // Initial image update
    updateDrawNodeImage(node);

    return node;
}

// Update draw node image data
function updateDrawNodeImage(node) {
    node.data.imageData = node.data.canvas.toDataURL('image/png');
    node.data.originalWidth = node.data.canvas.width;
    node.data.originalHeight = node.data.canvas.height;
}

// Create Veo 3.1 Video Node
function createVeo3Node(x = 300, y = 100) {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node veo3-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Veo 3.1 Video</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content">
            <textarea placeholder="Describe the video you want to generate..."></textarea>
            
            <div class="veo-settings">
                <label class="veo-label">Video Duration:</label>
                <select class="duration-select">
                    <option value="5">5 seconds</option>
                    <option value="8" selected>8 seconds</option>
                    <option value="10">10 seconds</option>
                </select>
                
                <label class="veo-label">Aspect Ratio:</label>
                <select class="aspect-ratio-select">
                    <option value="16:9" selected>16:9 (Landscape)</option>
                    <option value="9:16">9:16 (Portrait)</option>
                    <option value="1:1">1:1 (Square)</option>
                </select>
            </div>
            
            <div class="reference-frames">
                <div class="frame-info">
                    <span class="info-icon">ℹ</span>
                    <span class="info-text">Connect 1-3 images for frame guidance</span>
                </div>
                <div class="frame-indicators">
                    <div class="frame-slot" data-frame="first">
                        <span class="frame-label">First Frame</span>
                        <span class="frame-status">○</span>
                    </div>
                    <div class="frame-slot" data-frame="middle">
                        <span class="frame-label">Middle Frame</span>
                        <span class="frame-status">○</span>
                    </div>
                    <div class="frame-slot" data-frame="last">
                        <span class="frame-label">Last Frame</span>
                        <span class="frame-status">○</span>
                    </div>
                </div>
            </div>
            
            <div class="prompt-actions">
                <button class="icon-btn node-clone" title="Clone Node">⎘</button>
            </div>
        </div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
        <div class="node-actions">
            <div class="model-indicator">Veo 3.1</div>
            <button class="node-btn generate-btn" disabled>Generate Video</button>
        </div>
    `;

    const node = {
        id: nodeId,
        type: 'veo3',
        element: nodeEl,
        data: { 
            prompt: '', 
            duration: 8,
            aspectRatio: '16:9',
            connectedImages: [],
            frameAssignments: {
                first: null,
                middle: null,
                last: null
            }
        },
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

    // Textarea handling
    const textarea = nodeEl.querySelector('textarea');
    textarea.addEventListener('input', (e) => {
        node.data.prompt = e.target.value;
        const generateBtn = nodeEl.querySelector('.generate-btn');
        generateBtn.disabled = e.target.value.trim().length === 0;
    });

    // Duration select
    const durationSelect = nodeEl.querySelector('.duration-select');
    durationSelect.addEventListener('change', (e) => {
        node.data.duration = parseInt(e.target.value);
    });

    // Aspect ratio select
    const aspectRatioSelect = nodeEl.querySelector('.aspect-ratio-select');
    aspectRatioSelect.addEventListener('change', (e) => {
        node.data.aspectRatio = e.target.value;
    });

    // Clone button
    const cloneBtn = nodeEl.querySelector('.node-clone');
    cloneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cloneNode(node.id);
    });

    // Generate button
    const generateBtn = nodeEl.querySelector('.generate-btn');
    generateBtn.addEventListener('click', () => generateVideo(node));

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection points
    nodeEl.querySelectorAll('.connection-point').forEach(point => {
        setupConnectionPoint(point, nodeId);
    });

    setupNodeDragging(nodeEl, node);
    updateStatus('Veo 3.1 video node created');

    return node;
}

// Update frame indicators when images are connected to Veo3 node
function updateVeo3FrameIndicators(node) {
    if (node.type !== 'veo3') return;
    
    const images = node.data.connectedImages;
    
    // Reset assignments
    node.data.frameAssignments = {
        first: null,
        middle: null,
        last: null
    };
    
    // Assign based on number of connected images
    if (images.length === 1) {
        node.data.frameAssignments.first = images[0];
    } else if (images.length === 2) {
        node.data.frameAssignments.first = images[0];
        node.data.frameAssignments.last = images[1];
    } else if (images.length >= 3) {
        node.data.frameAssignments.first = images[0];
        node.data.frameAssignments.middle = images[1];
        node.data.frameAssignments.last = images[2];
    }
    
    // Update visual indicators
    const frameSlots = node.element.querySelectorAll('.frame-slot');
    frameSlots.forEach(slot => {
        const frameType = slot.dataset.frame;
        const status = slot.querySelector('.frame-status');
        
        if (node.data.frameAssignments[frameType]) {
            status.textContent = '●';
            status.style.color = '#27ae60';
            slot.classList.add('connected');
        } else {
            status.textContent = '○';
            status.style.color = '#888';
            slot.classList.remove('connected');
        }
    });
}

// Generate video using Veo 3.1 API
async function generateVideo(node) {
    const prompt = node.data.prompt.trim();
    
    if (!prompt) {
        updateStatus('No prompt provided', '#e74c3c');
        return;
    }

    const generateBtn = node.element.querySelector('.generate-btn');
    const originalText = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="loading"></span> Generating Video...';
    updateStatus('Generating video with Veo 3.1...', '#9b59b6');

    try {
        // Prepare frame data if images are connected
        const frames = {};
        
        if (node.data.frameAssignments.first && node.data.frameAssignments.first.data.imageData) {
            updateStatus('Compressing first frame...', '#9b59b6');
            frames.first = await compressImage(node.data.frameAssignments.first.data.imageData, 1024);
        }
        
        if (node.data.frameAssignments.middle && node.data.frameAssignments.middle.data.imageData) {
            updateStatus('Compressing middle frame...', '#9b59b6');
            frames.middle = await compressImage(node.data.frameAssignments.middle.data.imageData, 1024);
        }
        
        if (node.data.frameAssignments.last && node.data.frameAssignments.last.data.imageData) {
            updateStatus('Compressing last frame...', '#9b59b6');
            frames.last = await compressImage(node.data.frameAssignments.last.data.imageData, 1024);
        }

        updateStatus('Calling Veo 3.1 API...', '#9b59b6');

        // Call the backend API
        const response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                prompt: prompt,
                duration: node.data.duration,
                aspectRatio: node.data.aspectRatio,
                frames: Object.keys(frames).length > 0 ? frames : null
            })
        });

        if (!response.ok) {
            let errorMessage = 'Failed to generate video';
            
            try {
                const error = await response.json();
                errorMessage = error.error || errorMessage;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();

        // Create a video result node
        const nodeRect = node.element.getBoundingClientRect();
        const container = nodeCanvas.getBoundingClientRect();
        const resultX = nodeRect.left - container.left + nodeRect.width + 50;
        const resultY = nodeRect.top - container.top;

        if (result.video) {
            // Create video result node
            createVideoResultNode(resultX, resultY, result.video, node, result.duration, result.aspectRatio);
            
            // Update credits display if returned in response
            if (result.creditsRemaining !== undefined) {
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    userCredits.textContent = `${result.creditsRemaining} credit${result.creditsRemaining !== 1 ? 's' : ''}`;
                }
            }
            
            updateStatus('Video generated successfully!', '#27ae60');
        } else {
            throw new Error('No video returned from API');
        }

    } catch (error) {
        console.error('Video generation error:', error);
        updateStatus(`Error: ${error.message}`, '#e74c3c');
        alert(`Video generation failed: ${error.message}`);
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = originalText;
    }
}

// Create Video Result Node
function createVideoResultNode(x, y, videoUrl, sourceVeoNode = null, duration = 8, aspectRatio = '16:9') {
    const nodeId = `node-${nodeIdCounter++}`;
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node result-node video-result-node';
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    nodeEl.innerHTML = `
        <div class="node-header">
            <span class="node-title">Video Result</span>
            <button class="node-close">×</button>
        </div>
        <div class="node-content">
            <div class="video-wrapper">
                <video controls>
                    <source src="${videoUrl}" type="video/mp4">
                    Your browser does not support video playback.
                </video>
            </div>
            <div class="video-info">
                <span>${duration}s · ${aspectRatio}</span>
            </div>
        </div>
        <div class="connection-point input" data-node="${nodeId}"></div>
        <div class="connection-point output" data-node="${nodeId}"></div>
    `;

    const node = {
        id: nodeId,
        type: 'video-result',
        element: nodeEl,
        data: { 
            videoUrl: videoUrl,
            duration: duration,
            aspectRatio: aspectRatio,
            sourceVeoNode: sourceVeoNode
        },
        position: { x, y }
    };

    nodes.push(node);
    nodeCanvas.appendChild(nodeEl);

    // Close button
    nodeEl.querySelector('.node-close').addEventListener('click', () => removeNode(nodeId));

    // Connection points
    nodeEl.querySelectorAll('.connection-point').forEach(point => {
        setupConnectionPoint(point, nodeId);
    });

    setupNodeDragging(nodeEl, node);

    // If linked to a Veo node, auto-connect them
    if (sourceVeoNode) {
        connections.push({
            from: sourceVeoNode.id,
            to: nodeId
        });
        drawConnections();
    }

    return node;
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

document.getElementById('addDrawNode').addEventListener('click', () => {
    const center = getViewportCenter();
    createDrawNode(center.x - 125, center.y - 75);
});

document.getElementById('addVeo3Node').addEventListener('click', () => {
    const center = getViewportCenter();
    createVeo3Node(center.x - 160, center.y - 100);
});

document.getElementById('clearCanvas').addEventListener('click', clearCanvas);
document.getElementById('saveCanvas').addEventListener('click', saveCanvas);
document.getElementById('loadCanvas').addEventListener('click', loadCanvas);

// Zoom functions
function applyZoom() {
    const transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    nodeCanvas.style.transform = transform;
    nodeCanvas.style.transformOrigin = '0 0';
    
    // Don't apply CSS transform to connection canvas - we'll handle zoom/pan in the drawing context
    connectionCanvas.style.transform = 'none';
    
    // Apply zoom to background grid
    const canvasContainer = document.querySelector('.canvas-container');
    const baseSize1 = 100;
    const baseSize2 = 20;
    canvasContainer.style.backgroundSize = `${baseSize1 * zoom}px ${baseSize1 * zoom}px, ${baseSize2 * zoom}px ${baseSize2 * zoom}px`;
    canvasContainer.style.backgroundPosition = `${panX * zoom}px ${panY * zoom}px`;
    
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
    const container = canvasContainer.getBoundingClientRect();
    // Convert click position to canvas space
    const clickX = (e.clientX - container.left) / zoom - panX;
    const clickY = (e.clientY - container.top) / zoom - panY;
    
    // Check if click is on any disconnect button
    for (let i = connections.length - 1; i >= 0; i--) {
        const conn = connections[i];
        
        if (!conn.midpoint) continue;
        
        // Check if click is within the disconnect button (hitbox in canvas space)
        const distance = Math.sqrt(
            Math.pow(clickX - conn.midpoint.x, 2) + 
            Math.pow(clickY - conn.midpoint.y, 2)
        );
        
        if (distance <= 15) {
            console.log('Removing connection', i);
            // Found a click on disconnect button
            const fromNode = nodes.find(n => n.id === conn.from);
            const toNode = nodes.find(n => n.id === conn.to);
            
            // Clean up node data BEFORE removing connection
            if (toNode && (toNode.type === 'prompt' || toNode.type === 'action') && fromNode) {
                // Check for image/result/draw node connection
                if ((fromNode.type === 'image' || fromNode.type === 'result' || fromNode.type === 'draw') && toNode.data.connectedImages) {
                    // Filter out the disconnected node
                    const originalLength = toNode.data.connectedImages.length;
                    toNode.data.connectedImages = toNode.data.connectedImages.filter(node => node.id !== fromNode.id);
                    console.log(`Removed image node ${fromNode.id}, was ${originalLength}, now ${toNode.data.connectedImages.length}`);
                }
                
                // Check for prompt connection
                if (fromNode.type === 'prompt' && toNode.data.connectedPrompts) {
                    const originalLength = toNode.data.connectedPrompts.length;
                    toNode.data.connectedPrompts = toNode.data.connectedPrompts.filter(node => node.id !== fromNode.id);
                    console.log(`Removed prompt node ${fromNode.id}, was ${originalLength}, now ${toNode.data.connectedPrompts.length}`);
                }
                
                updateGenerateButton(toNode);
            }
            
            // Also clean up if fromNode is a prompt/action and toNode is a result
            if (fromNode && (fromNode.type === 'prompt' || fromNode.type === 'action') && toNode && toNode.type === 'result') {
                // Clear the resultNode reference from the prompt/action
                if (fromNode.data.resultNode && fromNode.data.resultNode.id === toNode.id) {
                    console.log('Clearing resultNode reference from prompt/action node');
                    fromNode.data.resultNode = null;
                }
                // Also clear the sourcePromptNode reference from the result node
                if (toNode.data.sourcePromptNode && toNode.data.sourcePromptNode.id === fromNode.id) {
                    console.log('Clearing sourcePromptNode reference from result node');
                    toNode.data.sourcePromptNode = null;
                }
            }
            
            // Remove connection
            connections.splice(i, 1);
            
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
    minimapCanvas.width = 300;
    minimapCanvas.height = 225;
    
    minimapCtx.fillStyle = '#1a1a1a';
    minimapCtx.fillRect(0, 0, 300, 225);
    
    // If no nodes, use default scale
    if (nodes.length === 0) {
        minimapViewport.style.width = '0px';
        minimapViewport.style.height = '0px';
        return;
    }
    
    // Calculate bounds of all nodes
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
    
    // Add padding around the nodes
    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    
    // Calculate the bounds size
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    
    // Calculate scale to fit all nodes in minimap
    const scaleX = minimapCanvas.width / boundsWidth;
    const scaleY = minimapCanvas.height / boundsHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // Calculate offset to center the content
    const offsetX = (minimapCanvas.width - boundsWidth * scale) / 2;
    const offsetY = (minimapCanvas.height - boundsHeight * scale) / 2;
    
    // Draw nodes on minimap with more detail
    nodes.forEach(node => {
        const x = (node.position.x - minX) * scale + offsetX;
        const y = (node.position.y - minY) * scale + offsetY;
        const width = (node.element.offsetWidth || 280) * scale;
        const height = (node.element.offsetHeight || 150) * scale;
        
        // Different colors for different node types
        if (node.type === 'image') {
            minimapCtx.fillStyle = '#4a6fa5';
        } else if (node.type === 'prompt') {
            minimapCtx.fillStyle = '#6b4aa5';
        } else if (node.type === 'action') {
            minimapCtx.fillStyle = '#a54a6f';
        } else if (node.type === 'result') {
            minimapCtx.fillStyle = '#4aa56b';
        }
        
        minimapCtx.fillRect(x, y, width, height);
        
        // Add border
        minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(x, y, width, height);
    });
    
    // Draw connections on minimap
    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    minimapCtx.lineWidth = 1.5;
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (!fromNode || !toNode) return;
        
        const fromX = (fromNode.position.x + (fromNode.element.offsetWidth || 280) - minX) * scale + offsetX;
        const fromY = (fromNode.position.y + (fromNode.element.offsetHeight || 150) / 2 - minY) * scale + offsetY;
        const toX = (toNode.position.x - minX) * scale + offsetX;
        const toY = (toNode.position.y + (toNode.element.offsetHeight || 150) / 2 - minY) * scale + offsetY;
        
        minimapCtx.beginPath();
        minimapCtx.moveTo(fromX, fromY);
        minimapCtx.lineTo(toX, toY);
        minimapCtx.stroke();
    });
    
    // Update viewport indicator
    const viewportWidth = (canvasContainer.clientWidth / zoom) * scale;
    const viewportHeight = (canvasContainer.clientHeight / zoom) * scale;
    const viewportX = (-panX - minX) * scale + offsetX;
    const viewportY = (-panY - minY) * scale + offsetY;
    
    minimapViewport.style.width = `${viewportWidth}px`;
    minimapViewport.style.height = `${viewportHeight}px`;
    minimapViewport.style.left = `${viewportX}px`;
    minimapViewport.style.top = `${viewportY}px`;
    
    // Store these values for interactive minimap features
    minimapViewport.dataset.scale = scale;
    minimapViewport.dataset.minX = minX;
    minimapViewport.dataset.minY = minY;
    minimapViewport.dataset.offsetX = offsetX;
    minimapViewport.dataset.offsetY = offsetY;
}

// Update minimap periodically
setInterval(updateMinimap, 100);

// Make minimap interactive - click to navigate
minimapCanvas.addEventListener('click', (e) => {
    if (nodes.length === 0) return;
    
    const rect = minimapCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Get dynamically calculated values from dataset
    const scale = parseFloat(minimapViewport.dataset.scale);
    const minX = parseFloat(minimapViewport.dataset.minX);
    const minY = parseFloat(minimapViewport.dataset.minY);
    const offsetX = parseFloat(minimapViewport.dataset.offsetX);
    const offsetY = parseFloat(minimapViewport.dataset.offsetY);
    
    // Convert minimap coordinates to canvas coordinates
    const canvasX = (clickX - offsetX) / scale + minX;
    const canvasY = (clickY - offsetY) / scale + minY;
    
    // Center the view on the clicked position
    const container = document.querySelector('.canvas-container');
    panX = -(canvasX - container.clientWidth / (2 * zoom));
    panY = -(canvasY - container.clientHeight / (2 * zoom));
    
    applyZoom();
});

// Make minimap viewport draggable
let isDraggingMinimap = false;
let minimapDragStart = { x: 0, y: 0 };

minimapViewport.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDraggingMinimap = true;
    minimapDragStart.x = e.clientX;
    minimapDragStart.y = e.clientY;
    minimapViewport.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (isDraggingMinimap) {
        // Get dynamically calculated scale from dataset
        const scale = parseFloat(minimapViewport.dataset.scale);
        const dx = (e.clientX - minimapDragStart.x) / scale;
        const dy = (e.clientY - minimapDragStart.y) / scale;
        
        panX -= dx;
        panY -= dy;
        
        minimapDragStart.x = e.clientX;
        minimapDragStart.y = e.clientY;
        
        applyZoom();
    }
});

document.addEventListener('mouseup', () => {
    if (isDraggingMinimap) {
        isDraggingMinimap = false;
        minimapViewport.style.cursor = '';
    }
});

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

// Show context menu for creating a new node at the end of a connection
function showConnectionMenu(x, y) {
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('active');
    
    // We are in "connection" mode, so we modify the context menu item behavior
    contextMenu.dataset.isConnectionMenu = 'true';
}

// Show context menu on right-click
canvasContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    const rect = canvasContainer.getBoundingClientRect();
    contextMenuPosition.x = (e.clientX - rect.left) / zoom - panX;
    contextMenuPosition.y = (e.clientY - rect.top) / zoom - panY;
    
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.classList.add('active');
    
    // Not a connection menu
    contextMenu.dataset.isConnectionMenu = 'false';
});

// Handle context menu item clicks
contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        let newNode;

        switch(action) {
            case 'addImage':
                newNode = createImageNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addPrompt':
                newNode = createPromptNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addAction':
                newNode = createActionNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addDraw':
                newNode = createDrawNode(contextMenuPosition.x, contextMenuPosition.y);
                break;
            case 'addVeo3':
                newNode = createVeo3Node(contextMenuPosition.x, contextMenuPosition.y);
                break;
        }
        
        // If the menu was opened from a connection, create the connection
        if (contextMenu.dataset.isConnectionMenu === 'true' && newNode && connectionStart) {
            const fromNodeId = connectionStart.nodeId;
            const toNodeId = newNode.id;
            const fromType = connectionStart.type;
            // The new node will be the opposite type of connection
            const toType = fromType === 'output' ? 'input' : 'output';
            
            createConnection(fromNodeId, toNodeId, fromType, toType);
        }

        // Reset and hide menu
        contextMenu.classList.remove('active');
        contextMenu.dataset.isConnectionMenu = 'false';
        connectionStart = null; // End the connection process
        drawConnections();
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

// Make toolbar draggable
const toolbar = document.querySelector('.toolbar-overlay');
let isToolbarDragging = false;
let toolbarDragStart = { x: 0, y: 0 };
// Position toolbar at top-left, below the title with more space
let toolbarPosition = { x: 20, y: 180 }; // Initial position with more breathing room

// Set initial position
toolbar.style.left = `${toolbarPosition.x}px`;
toolbar.style.top = `${toolbarPosition.y}px`;
toolbar.style.transform = 'none'; // Remove the transform

toolbar.addEventListener('mousedown', (e) => {
    // Don't drag if clicking on a button
    if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
        return;
    }
    
    isToolbarDragging = true;
    toolbarDragStart.x = e.clientX - toolbarPosition.x;
    toolbarDragStart.y = e.clientY - toolbarPosition.y;
    toolbar.style.cursor = 'grabbing';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (isToolbarDragging) {
        toolbarPosition.x = e.clientX - toolbarDragStart.x;
        toolbarPosition.y = e.clientY - toolbarDragStart.y;
        
        toolbar.style.left = `${toolbarPosition.x}px`;
        toolbar.style.top = `${toolbarPosition.y}px`;
    }
});

document.addEventListener('mouseup', () => {
    if (isToolbarDragging) {
        isToolbarDragging = false;
        toolbar.style.cursor = 'move';
    }
});

// Auto-save functionality
let autoSaveInterval;
const AUTO_SAVE_DELAY = 5000; // Auto-save every 5 seconds

function autoSaveCanvas() {
    try {
        // Create a serializable version of the canvas state (same as saveCanvas)
        const canvasState = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            zoom: zoom,
            panX: panX,
            panY: panY,
            nodeIdCounter: nodeIdCounter,
            nodes: nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: {
                    // For image nodes
                    imageData: node.data.imageData,
                    imageWidth: node.data.imageWidth,
                    // For prompt nodes
                    prompt: node.data.prompt,
                    aspectRatio: node.data.aspectRatio,
                    // For action nodes
                    action: node.data.action,
                    // Store IDs of connected nodes instead of references
                    connectedImageIds: node.data.connectedImages ? 
                        node.data.connectedImages.map(n => n.id) : [],
                    connectedPromptIds: node.data.connectedPrompts ? 
                        node.data.connectedPrompts.map(n => n.id) : [],
                    resultNodeId: node.data.resultNode ? node.data.resultNode.id : null,
                    sourcePromptNodeId: node.data.sourcePromptNode ? node.data.sourcePromptNode.id : null
                }
            })),
            connections: connections.map(conn => ({
                from: conn.from,
                to: conn.to
            }))
        };

        // Save to localStorage
        localStorage.setItem('diffusionCanvas_autoSave', JSON.stringify(canvasState));
        
        // Show brief auto-save indicator
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(39, 174, 96, 0.9);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
            animation: fadeInOut 2s ease-in-out;
        `;
        indicator.textContent = '✓ Auto-saved';
        document.body.appendChild(indicator);
        
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.remove();
            }
        }, 2000);
        
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('Auto-save disabled: Canvas too large for localStorage');
            
            // Show warning to user once
            if (!localStorage.getItem('autoSaveWarningShown')) {
                localStorage.setItem('autoSaveWarningShown', 'true');
                
                const warning = document.createElement('div');
                warning.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: rgba(255, 152, 0, 0.95);
                    color: white;
                    padding: 12px 20px;
                    border-radius: 4px;
                    font-size: 13px;
                    z-index: 10000;
                    max-width: 300px;
                    line-height: 1.4;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                `;
                warning.innerHTML = `
                    <strong>⚠ Auto-save disabled</strong><br>
                    Canvas too large for browser storage.<br>
                    Use 💾 Save Canvas button instead.
                `;
                document.body.appendChild(warning);
                
                setTimeout(() => {
                    if (warning.parentNode) {
                        warning.remove();
                    }
                }, 8000);
            }
            
            // Stop auto-save interval to prevent repeated errors
            if (autoSaveInterval) {
                clearInterval(autoSaveInterval);
                autoSaveInterval = null;
            }
        } else {
            console.error('Auto-save error:', error);
        }
    }
}

function restoreAutoSavedCanvas() {
    try {
        const savedState = localStorage.getItem('diffusionCanvas_autoSave');
        if (!savedState) return false;

        const canvasState = JSON.parse(savedState);
        
        // Validate the saved state
        if (!canvasState.version || !canvasState.nodes) {
            return false;
        }

        // Clear current canvas
        nodes.forEach(node => node.element.remove());
        nodes = [];
        connections = [];

        // Restore zoom and pan
        zoom = canvasState.zoom || 1;
        panX = canvasState.panX || 0;
        panY = canvasState.panY || 0;
        nodeIdCounter = canvasState.nodeIdCounter || 0;

        // Create a map to store node ID to node object mapping
        const nodeMap = new Map();

        // Recreate all nodes
        for (const nodeData of canvasState.nodes) {
            let node;
            
            switch (nodeData.type) {
                case 'image':
                    node = createImageNode(nodeData.position.x, nodeData.position.y);
                    // Restore image if exists
                    if (nodeData.data.imageData) {
                        const img = document.createElement('img');
                        img.src = nodeData.data.imageData;
                        img.onload = () => {
                            node.data.image = img;
                            node.data.imageData = nodeData.data.imageData;
                            node.data.imageWidth = nodeData.data.imageWidth || 250;
                            node.data.originalWidth = img.naturalWidth;
                            node.data.originalHeight = img.naturalHeight;
                            
                            const content = node.element.querySelector('.node-content');
                            content.innerHTML = '';
                            
                            const wrapper = document.createElement('div');
                            wrapper.className = 'image-wrapper';
                            img.style.width = `${node.data.imageWidth}px`;
                            wrapper.appendChild(img);
                            content.appendChild(wrapper);
                            
                            const scaleIndicator = document.createElement('div');
                            scaleIndicator.className = 'scale-indicator';
                            scaleIndicator.textContent = `${node.data.originalWidth} x ${node.data.originalHeight}px`;
                            content.appendChild(scaleIndicator);
                            
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
                        };
                    }
                    break;
                
                case 'prompt':
                    node = createPromptNode(nodeData.position.x, nodeData.position.y);
                    if (nodeData.data.prompt) {
                        const textarea = node.element.querySelector('textarea');
                        textarea.value = nodeData.data.prompt;
                        node.data.prompt = nodeData.data.prompt;
                    }
                    if (nodeData.data.aspectRatio) {
                        const select = node.element.querySelector('.aspect-ratio-select');
                        select.value = nodeData.data.aspectRatio;
                        node.data.aspectRatio = nodeData.data.aspectRatio;
                    }
                    break;
                
                case 'action':
                    node = createActionNode(nodeData.position.x, nodeData.position.y);
                    if (nodeData.data.action) {
                        const select = node.element.querySelector('.action-select');
                        select.value = nodeData.data.action;
                        node.data.action = nodeData.data.action;
                    }
                    break;
                
                case 'result':
                    node = createResultNode(nodeData.position.x, nodeData.position.y, nodeData.data.imageData);
                    node.data.imageWidth = nodeData.data.imageWidth || 250;
                    const img = node.data.image;
                    img.style.width = `${node.data.imageWidth}px`;
                    break;
                
                case 'draw':
                    node = createDrawNode(nodeData.position.x, nodeData.position.y);
                    if (nodeData.data.imageData) {
                        const img = new Image();
                        img.onload = () => {
                            node.data.context.drawImage(img, 0, 0);
                            updateDrawNodeImage(node);
                        };
                        img.src = nodeData.data.imageData;
                    }
                    break;
            }

            const lastNode = nodes[nodes.length - 1];
            if (lastNode && lastNode.id !== nodeData.id) {
                lastNode.element.id = nodeData.id;
                lastNode.id = nodeData.id;
                
                // Re-setup connection points with correct ID
                lastNode.element.querySelectorAll('.connection-point').forEach(point => {
                    point.dataset.node = nodeData.id;
                    const newPoint = point.cloneNode(true);
                    point.parentNode.replaceChild(newPoint, point);
                    setupConnectionPoint(newPoint, nodeData.id);
                });
                
                // Re-setup close button with correct ID
                const closeBtn = lastNode.element.querySelector('.node-close');
                if (closeBtn) {
                    const newCloseBtn = closeBtn.cloneNode(true);
                    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                    newCloseBtn.addEventListener('click', () => removeNode(nodeData.id));
                }
            }

            nodeMap.set(nodeData.id, lastNode);
        }

        // Restore connections between nodes
        for (const nodeData of canvasState.nodes) {
            const node = nodeMap.get(nodeData.id);
            if (!node) continue;

            if (nodeData.data.connectedImageIds) {
                node.data.connectedImages = nodeData.data.connectedImageIds
                    .map(id => nodeMap.get(id))
                    .filter(n => n);
            }

            if (nodeData.data.connectedPromptIds) {
                node.data.connectedPrompts = nodeData.data.connectedPromptIds
                    .map(id => nodeMap.get(id))
                    .filter(n => n);
            }

            if (nodeData.data.resultNodeId) {
                node.data.resultNode = nodeMap.get(nodeData.data.resultNodeId);
            }

            if (nodeData.data.sourcePromptNodeId) {
                node.data.sourcePromptNode = nodeMap.get(nodeData.data.sourcePromptNodeId);
            }

            if (node.type === 'prompt' || node.type === 'action') {
                updateGenerateButton(node);
            }
        }

        connections = [];
        for (const connData of canvasState.connections) {
            connections.push({
                from: connData.from,
                to: connData.to
            });
        }

        applyZoom();
        drawConnections();
        updateMinimap();
        
        updateStatus('Canvas restored from auto-save', '#667eea');
        return true;
        
    } catch (error) {
        console.error('Auto-restore error:', error);
        return false;
    }
}

function clearAutoSave() {
    localStorage.removeItem('diffusionCanvas_autoSave');
}

// Start auto-save interval
function startAutoSave() {
    // Clear any existing interval
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    
    // Auto-save every 5 seconds
    autoSaveInterval = setInterval(() => {
        if (nodes.length > 0) {
            autoSaveCanvas();
        }
    }, AUTO_SAVE_DELAY);
}

// Try to restore auto-saved canvas on load
const restored = restoreAutoSavedCanvas();

// Start auto-save
startAutoSave();

// Initialize with sample nodes
if (!restored) {
    updateStatus('Ready - Add nodes to get started');
} else {
    updateStatus('Canvas restored from auto-save', '#667eea');
}
updateMinimap();
