// Base utilities shared by all node types
export class NodeBase {
    constructor() {
        this.nodes = [];
        this.connections = [];
    }

    // Setup node dragging
    setupNodeDragging(nodeEl, node, dragCallback) {
        nodeEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.connection-point') ||
                e.target.tagName === 'TEXTAREA' ||
                e.target.tagName === 'BUTTON' ||
                e.target.tagName === 'INPUT' ||
                e.target.tagName === 'SELECT' ||
                e.target.closest('.draw-canvas') ||
                e.target.closest('.draw-overlay') ||
                e.target.closest('.draw-toolbar')) {
                return;
            }
            if (dragCallback) dragCallback(e, node);
        });
    }

    // Setup connection point
    setupConnectionPoint(pointEl, nodeId, connectionCallback) {
        pointEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (connectionCallback) connectionCallback(e, nodeId, pointEl);
        });
    }

    // Setup node resize
    setupNodeResize(nodeEl, node, resizeHandle, resizeCallback) {
        resizeHandle.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (resizeCallback) resizeCallback(e, node);
        });
    }

    // Common node header HTML — optional icon references a sprite symbol id
    createNodeHeader(title, icon = null) {
        const iconHtml = icon ? `<svg class="icon node-title-icon"><use href="#${icon}"/></svg>` : '';
        return `
            <div class="node-header">
                <span class="node-title">${iconHtml}${title}</span>
                <button class="node-close" title="Remove node"><svg class="icon"><use href="#i-x"/></svg></button>
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
