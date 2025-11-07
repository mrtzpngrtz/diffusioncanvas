# Node Development Guide

This document explains how to create custom nodes for Diffusion Canvas.

## Architecture

The node system is modular and plugin-friendly:

- **NodeBase.js** - Base class with shared utilities
- **NodeFactory.js** - Registry and factory for all node types
- **Individual Node Files** - Each node type in its own file

## Creating a New Node Type

Follow these steps to add a custom node:

### 1. Create Your Node File

Create a new file in the `nodes/` directory (e.g., `MyCustomNode.js`):

```javascript
import { NodeBase } from './NodeBase.js';

export class MyCustomNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        // Create the DOM element
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node my-custom-node';  // Add custom CSS class
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;

        // Build the HTML structure
        nodeEl.innerHTML = `
            ${this.createNodeHeader('My Custom Node')}
            <div class="node-content">
                <!-- Your custom content here -->
                <input type="text" placeholder="Enter something...">
            </div>
            ${this.createConnectionPoints(nodeId, true, true)}
        `;

        // Create the node data object
        const node = {
            id: nodeId,
            type: 'mycustom',  // Unique type identifier
            element: nodeEl,
            data: { 
                // Your custom data properties
                value: ''
            },
            position: { x, y }
        };

        // Setup event handlers
        const input = nodeEl.querySelector('input');
        input.addEventListener('input', (e) => {
            node.data.value = e.target.value;
        });

        // Close button
        nodeEl.querySelector('.node-close').addEventListener('click', () => 
            callbacks.removeNode(nodeId)
        );

        // Connection points
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });

        // Enable dragging
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
```

### 2. Register Your Node

Edit `NodeFactory.js` to import and register your node:

```javascript
import { MyCustomNode } from './MyCustomNode.js';

export class NodeFactory {
    constructor() {
        this.nodeTypes = {
            'image': new ImageNode(),
            'prompt': new PromptNode(),
            'action': new ActionNode(),
            'result': new ResultNode(),
            'draw': new DrawNode(),
            'mycustom': new MyCustomNode()  // Add your node here
        };
    }
    // ... rest of the code
}
```

### 3. Add UI Button (Optional)

In `index.html`, add a button to create your node:

```html
<button id="addMyCustomNode" class="btn">+ My Custom Node</button>
```

### 4. Wire Up the Button

In `script.js`, add the button handler:

```javascript
document.getElementById('addMyCustomNode').addEventListener('click', () => {
    const center = getViewportCenter();
    createNode('mycustom', center.x - 125, center.y - 75);
});
```

### 5. Add CSS Styling (Optional)

In `style.css`, add custom styles:

```css
.my-custom-node {
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
}

.my-custom-node .node-header {
    border-bottom: 2px solid rgba(255, 255, 255, 0.2);
}
```

## Available Callbacks

The `callbacks` object provides these functions:

- **removeNode(nodeId)** - Remove a node
- **startConnection(e, nodeId, pointEl)** - Start connection drag
- **startDrag(e, node)** - Start node drag
- **startResize(e, node)** - Start node resize
- **updateGenerateButton(node)** - Update generate button state
- **generateImage(node)** - Generate image from prompt/action
- **cloneNode(nodeId)** - Clone a node
- **handleImageFile(file, node)** - Handle image upload
- **updateDrawNodeImage(node)** - Update draw node image data
- **openLightbox(imageData)** - Open lightbox with image
- **downloadImage(imageData, filename)** - Download image

## Helper Methods from NodeBase

- **createNodeHeader(title)** - Generate standard node header HTML
- **createConnectionPoints(nodeId, hasInput, hasOutput)** - Generate connection point HTML
- **setupNodeDragging(nodeEl, node, dragCallback)** - Setup drag handlers
- **setupConnectionPoint(pointEl, nodeId, connectionCallback)** - Setup connection handlers
- **setupNodeResize(nodeEl, node, resizeHandle, resizeCallback)** - Setup resize handlers

## Node Data Structure

Each node should return this structure:

```javascript
{
    id: 'node-123',           // Unique identifier
    type: 'mycustom',         // Node type name
    element: nodeEl,          // DOM element
    data: {                   // Custom data
        // Your properties here
    },
    position: { x: 100, y: 100 }  // Canvas position
}
```

## Connection System

Nodes can have input and output connection points:

- **Input** (left side) - Receives data from other nodes
- **Output** (right side) - Sends data to other nodes

```javascript
// No inputs, only output (like Image/Draw nodes)
${this.createConnectionPoints(nodeId, false, true)}

// Both input and output (like Prompt/Action nodes)
${this.createConnectionPoints(nodeId, true, true)}

// Only input, no output (rare)
${this.createConnectionPoints(nodeId, true, false)}
```

## Best Practices

1. **Keep it Simple** - Each node should do one thing well
2. **Use Callbacks** - Don't directly manipulate global state
3. **Clean Up** - Remove event listeners when node is destroyed
4. **Consistent Styling** - Follow existing node design patterns
5. **Document Data** - Comment what each data property does
6. **Handle Errors** - Validate inputs and provide user feedback

## Examples

Look at existing nodes for reference:

- **ImageNode.js** - File upload, drag & drop, image display
- **PromptNode.js** - Text input, dropdowns, generate button
- **ActionNode.js** - Select dropdown with presets
- **ResultNode.js** - Display generated images, lightbox
- **DrawNode.js** - Canvas drawing, tools, colors

## Testing

After creating your node:

1. Refresh the browser
2. Click your "Add" button
3. Test dragging the node
4. Test connections to other nodes
5. Test saving/loading canvas
6. Verify it persists correctly

## Advanced: Runtime Registration

You can register nodes at runtime without editing NodeFactory:

```javascript
import { MyCustomNode } from './MyCustomNode.js';

// In your initialization code:
nodeFactory.registerNodeType('mycustom', new MyCustomNode());
```

This is useful for plugins or dynamic node loading.

## Questions?

The modular system makes it easy to extend Diffusion Canvas. Each node is self-contained and can be developed independently. Happy coding!
