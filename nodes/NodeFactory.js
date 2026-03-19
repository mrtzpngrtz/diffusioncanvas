import { ImageNode } from './ImageNode.js';
import { PromptNode } from './PromptNode.js';
import { ActionNode } from './ActionNode.js';
import { ResultNode } from './ResultNode.js';
import { DrawNode } from './DrawNode.js';

/**
 * NodeFactory - Central registry for all node types
 * 
 * To add a new node type:
 * 1. Create a new file in the nodes/ directory (e.g., MyCustomNode.js)
 * 2. Extend NodeBase and implement the create() method
 * 3. Import it here and register it in the constructor
 * 4. Add a button in index.html if needed
 */
export class NodeFactory {
    constructor() {
        // Register all available node types
        this.nodeTypes = {
            'image': new ImageNode(),
            'prompt': new PromptNode(),
            'action': new ActionNode(),
            'result': new ResultNode(),
            'draw': new DrawNode()
        };
    }

    /**
     * Create a node of the specified type
     * @param {string} type - Node type (image, prompt, action, result, draw)
     * @param {string} nodeId - Unique identifier for the node
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {object} callbacks - Callback functions for node interactions
     * @param {any} extraParams - Additional parameters (e.g., imageUrl for result nodes)
     * @returns {object} Created node object
     */
    createNode(type, nodeId, x, y, callbacks, extraParams = {}) {
        const nodeClass = this.nodeTypes[type];
        
        if (!nodeClass) {
            console.error(`Unknown node type: ${type}`);
            return null;
        }

        // Handle special cases for different node types
        switch (type) {
            case 'result':
                return nodeClass.create(
                    nodeId, 
                    x, 
                    y, 
                    extraParams.imageUrl, 
                    extraParams.sourcePromptNode, 
                    callbacks
                );
            default:
                return nodeClass.create(nodeId, x, y, callbacks);
        }
    }

    /**
     * Register a custom node type
     * Useful for plugins or extensions
     * @param {string} typeName - Name of the node type
     * @param {NodeBase} nodeClass - Instance of a class extending NodeBase
     */
    registerNodeType(typeName, nodeClass) {
        if (this.nodeTypes[typeName]) {
            console.warn(`Node type '${typeName}' already exists. Overwriting...`);
        }
        this.nodeTypes[typeName] = nodeClass;
    }

    /**
     * Get list of all registered node types
     * @returns {string[]} Array of node type names
     */
    getAvailableTypes() {
        return Object.keys(this.nodeTypes);
    }

    /**
     * Check if a node type exists
     * @param {string} type - Node type to check
     * @returns {boolean} True if type exists
     */
    hasNodeType(type) {
        return this.nodeTypes.hasOwnProperty(type);
    }
}
