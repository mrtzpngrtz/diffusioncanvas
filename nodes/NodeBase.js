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

// Tap on the image toggles the prompt/model overlay. The node takes pointer
// capture on pointerdown (NodeManager.startDrag), so the browser retargets the
// click to the node element — a listener on the image wrapper never sees it.
// Bind on the node and decide from the element the press actually landed on.
export function bindPromptOverlayToggle(nodeEl, metaEl) {
    let tapX = 0, tapY = 0, tapTarget = null;

    nodeEl.addEventListener('pointerdown', (e) => {
        tapX = e.clientX; tapY = e.clientY; tapTarget = e.target;
    });

    nodeEl.addEventListener('click', (e) => {
        const t = tapTarget;
        tapTarget = null;
        if (!t || e.shiftKey) return;
        if (!t.closest('.image-wrapper')) return;
        if (t.closest('button, canvas, .connection-point, .resize-handle')) return;
        // a drag also ends in a click — only a press that stayed put is a tap
        if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > 4) return;
        if (!metaEl.classList.contains('result-meta-has-data')) return;
        metaEl.classList.toggle('result-meta-visible');
    });
}
