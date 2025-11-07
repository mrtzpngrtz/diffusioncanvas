# Modular Node System Refactoring Guide

## Overview

The node system has been refactored into a modular architecture where each node type is in its own file. This makes it easier to develop new nodes without modifying the entire codebase.

## New Structure

```
nodes/
├── NodeBase.js          # Base class with shared utilities
├── NodeFactory.js       # Central registry for all node types
├── ImageNode.js         # Image upload node
├── PromptNode.js        # Text prompt node
├── ActionNode.js        # Preset action node
├── ResultNode.js        # Generated image display
├── DrawNode.js          # Canvas drawing node
└── README.md            # Development guide for new nodes
```

## How to Use the Modular System

### 1. Update index.html

Change the script tag to use ES modules:

```html
<!-- Old -->
<script src="script.js"></script>

<!-- New -->
<script type="module" src="script.js"></script>
```

### 2. Keep Original script.js

The original `script.js` file is very large (~2700 lines). To use the modular system:

**Option A: Gradual Migration**
- Keep using `script.js` as-is for now
- When you want to add a new node type, cre

ate it in the `nodes/` directory
- Import NodeFactory in `script.js`:

```javascript
import { NodeFactory } from './nodes/NodeFactory.js';
const nodeFactory = new NodeFactory();
```

- Replace individual node creation functions with:

```javascript
// Old way
function createImageNode(x, y) {
    // 80+ lines of code
}

// New way
function createImageNode(x, y) {
    const nodeId = `node-${nodeIdCounter++}`;
    const node = nodeFactory.createNode('image', nodeId, x, y, nodeCallbacks);
    if (node) {
        nodes.push(node);
        nodeCanvas.appendChild(node.element);
    }
    return node;
}
```

**Option B: Full Refactor** (Recommended for new projects)
- Copy the modular code structure
- Keep all the canvas/connection/UI logic in main script
- Only move node-specific code to modules

### 3. Define Callbacks Object

Create a callbacks object that node classes can use:

```javascript
const nodeCallbacks = {
    removeNode: (nodeId) => removeNode(nodeId),
    startConnection: (e, nodeId, pointEl) => { /* connection logic */ },
    startDrag: (e, node) => { /* drag logic */ },
    startResize: (e, node) => { /* resize logic */ },
    updateGenerateButton: (node) => updateGenerateButton(node),
    generateImage: (node) => generateImage(node),
    cloneNode: (nodeId) => cloneNode(nodeId),
    handleImageFile: (file, node) => handleImageFile(file, node),
    updateDrawNodeImage: (node) => updateDrawNodeImage(node),
    openLightbox: (imageData) => openLightbox(imageData),
    downloadImage: (imageData, filename) => downloadImage(imageData, filename)
};
```

## Creating a New Custom Node

Follow the guide in `nodes/README.md`. Example:

```javascript
// nodes/MyCustomNode.js
import { NodeBase } from './NodeBase.js';

export class MyCustomNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node my-custom-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        nodeEl.innerHTML = `
            ${this.createNodeHeader('My Custom Node')}
            <div class="node-content">
                <input type="text" placeholder="Custom input">
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
        `;

        const node = {
            id: nodeId,
            type: 'mycustom',
            element: nodeEl,
            data: { value: '' },
            position: { x, y }
        };

        // Setup event handlers...
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);
        
        return node;
    }
}
```

Then register it:

```javascript
// In NodeFactory.js
import { MyCustomNode } from './MyCustomNode.js';

constructor() {
    this.nodeTypes = {
        // ... existing nodes
        'mycustom': new MyCustomNode()
    };
}
```

## Benefits of Modular System

1. **Isolation** - Each node type is self-contained
2. **Maintainability** - Easy to find and edit specific node code
3. **Extensibility** - Add new nodes without touching existing code
4. **Collaboration** - Multiple developers can work on different nodes
5. **Testing** - Test individual node types in isolation
6. **Plugin System** - Runtime registration of custom nodes

## Migration Strategy

### Phase 1: Setup (Current)
✅ Create modular node files  
✅ Create NodeFactory  
✅ Create documentation

### Phase 2: Integration (Next)
- [ ] Add ES module script tag to index.html
- [ ] Import NodeFactory in script.js
- [ ] Create callbacks object
- [ ] Test one node type with factory

### Phase 3: Full Migration (Optional)
- [ ] Replace all createXNode functions
- [ ] Simplify script.js
- [ ] Remove redundant code

### Phase 4: Enhancement (Future)
- [ ] Add plugin system
- [ ] Create node marketplace
- [ ] Enable runtime node loading

## Important Notes

### Browser Compatibility
ES modules require a modern browser. All recent versions of Chrome, Firefox, Edge, and Safari support modules.

### Server Configuration
When using ES modules:
- Files must be served with correct MIME type (`text/javascript`)
- Cannot use `file://` protocol (must use http server)
- CORS may apply for cross-origin requests

### Backward Compatibility
The original `script.js` continues to work as-is. The modular system is opt-in.

## Example: Adding a New Node

1. Create `nodes/VideoNode.js`
2. Extend `NodeBase` and implement `create()`
3. Register in `NodeFactory.js`
4. Add button in `index.html`
5. Wire up in `script.js`

That's it! The node is ready to use.

## Questions?

See `nodes/README.md` for detailed development guide.
