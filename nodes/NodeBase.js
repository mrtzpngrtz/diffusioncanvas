// Base utilities shared by all node types
export class NodeBase {
    constructor() {
        this.nodes = [];
        this.connections = [];
    }

    // Setup node dragging
    setupNodeDragging(nodeEl, node, dragCallback) {
        nodeEl.addEventListener('mousedown', (e) => {
            if (e.target.closest('.connection-point') || 
                e.target.tagName === 'TEXTAREA' || 
                e.target.tagName === 'BUTTON' ||
                e.target.tagName === 'INPUT' ||
                e.target.tagName === 'SELECT' ||
                e.target.closest('.draw-canvas')) {
                return;
            }

            if (dragCallback) {
                dragCallback(e, node);
            }
        });
    }

    // Setup connection point
    setupConnectionPoint(pointEl, nodeId, connectionCallback) {
        pointEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (connectionCallback) {
                connectionCallback(e, nodeId, pointEl);
            }
        });
    }

    // Setup node resize
    setupNodeResize(nodeEl, node, resizeHandle, resizeCallback) {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (resizeCallback) {
                resizeCallback(e, node);
            }
        });
    }

    // Common node header HTML
    createNodeHeader(title) {
        return `
            <div class="node-header">
                <span class="node-title">${title}</span>
                <button class="node-close">×</button>
            </div>
        `;
    }

    // Common connection points HTML
    createConnectionPoints(nodeId, hasInput = true, hasOutput = true) {
        let html = '';
        if (hasInput) {
            html += `<div class="connection-point input" data-node="${nodeId}"></div>`;
        }
        if (hasOutput) {
            html += `<div class="connection-point output" data-node="${nodeId}"></div>`;
        }
        return html;
    }
}
