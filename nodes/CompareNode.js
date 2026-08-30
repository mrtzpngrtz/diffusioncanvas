import { NodeBase } from './NodeBase.js';

// Before / After node — two connected images over each other with a
// draggable vertical divider. Input 1 = before (left), input 2 = after (right).

export class CompareNode extends NodeBase {
    create(nodeId, x, y, callbacks) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'node compare-node';
        nodeEl.id = nodeId;
        nodeEl.style.left = `${x}px`;
        nodeEl.style.top = `${y}px`;
        nodeEl.style.width = '480px';

        nodeEl.innerHTML = `
            ${this.createNodeHeader('Before / After', 'i-split')}
            <div class="node-content">
                <div class="cmp-stage">
                    <img class="cmp-img cmp-before" draggable="false" alt="">
                    <img class="cmp-img cmp-after" draggable="false" alt="">
                    <div class="cmp-divider"><div class="cmp-handle"><svg class="icon"><use href="#i-split"/></svg></div></div>
                    <span class="cmp-label cmp-label-before">Before</span>
                    <span class="cmp-label cmp-label-after">After</span>
                    <div class="cmp-empty">Connect two images — input 1 = before, input 2 = after</div>
                </div>
                <div class="cmp-bar">
                    <input class="cmp-range" type="range" min="0" max="100" value="50" title="Divider position">
                    <button class="icon-btn cmp-swap" title="Swap before / after"><svg class="icon"><use href="#i-refresh"/></svg></button>
                </div>
            </div>
            ${this.createConnectionPoints(nodeId, true, false)}
        `;

        const node = {
            id: nodeId,
            type: 'compare',
            element: nodeEl,
            data: { split: 50, swap: false, connectedImages: [] },
            position: { x, y }
        };

        const stage    = nodeEl.querySelector('.cmp-stage');
        const before   = nodeEl.querySelector('.cmp-before');
        const after    = nodeEl.querySelector('.cmp-after');
        const divider  = nodeEl.querySelector('.cmp-divider');
        const range    = nodeEl.querySelector('.cmp-range');
        const emptyEl  = nodeEl.querySelector('.cmp-empty');

        const sources = () => {
            const imgs = (node.data.connectedImages || []).filter(n => n.data.imageData).slice(0, 2);
            if (node.data.swap && imgs.length === 2) imgs.reverse();
            return imgs;
        };

        const applySplit = () => {
            const s = Math.min(100, Math.max(0, node.data.split));
            after.style.clipPath = `inset(0 0 0 ${s}%)`;
            divider.style.left = `${s}%`;
            range.value = s;
        };

        let sig = '';
        node.refresh = () => {
            const [a, b] = sources();
            const key = `${a?.data.imageData?.length || 0}|${b?.data.imageData?.length || 0}|${node.data.swap}`;
            if (key === sig) return;
            sig = key;
            before.src = a?.data.imageData || '';
            after.src  = b?.data.imageData || '';
            before.style.visibility = a ? '' : 'hidden';
            after.style.visibility  = b ? '' : 'hidden';
            stage.classList.toggle('ready', !!(a && b));
            emptyEl.style.display = a && b ? 'none' : '';
            if (a) {
                const im = new Image();
                im.onload = () => { stage.style.aspectRatio = `${im.naturalWidth} / ${im.naturalHeight}`; };
                im.src = a.data.imageData;
            }
        };

        // Hook called by ConnectionManager on connect / disconnect
        node.updateModeLabel = () => { node.refresh(); applySplit(); };
        node.syncSettingsUI = () => { applySplit(); node.refresh(); };
        nodeEl.addEventListener('pointerenter', () => node.refresh());

        // Drag the divider anywhere on the stage
        let dragging = false;
        const setFromPointer = (e) => {
            const r = stage.getBoundingClientRect();
            node.data.split = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
            applySplit();
        };
        stage.addEventListener('pointerdown', (e) => {
            if (!stage.classList.contains('ready')) return;
            e.stopPropagation();
            dragging = true;
            stage.setPointerCapture(e.pointerId);
            setFromPointer(e);
        });
        stage.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
        const stop = () => { dragging = false; };
        stage.addEventListener('pointerup', stop);
        stage.addEventListener('pointercancel', stop);

        range.addEventListener('pointerdown', (e) => e.stopPropagation());
        range.addEventListener('input', (e) => { node.data.split = +e.target.value; applySplit(); });
        nodeEl.querySelector('.cmp-swap').addEventListener('click', (e) => {
            e.stopPropagation();
            node.data.swap = !node.data.swap;
            node.refresh();
        });

        applySplit();
        node.refresh();

        nodeEl.querySelector('.node-close').addEventListener('click', () => callbacks.removeNode(nodeId));
        nodeEl.querySelectorAll('.connection-point').forEach(point => {
            this.setupConnectionPoint(point, nodeId, callbacks.startConnection);
        });
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        nodeEl.appendChild(resizeHandle);
        this.setupNodeResize(nodeEl, node, resizeHandle, callbacks.startResize);
        this.setupNodeDragging(nodeEl, node, callbacks.startDrag);

        return node;
    }
}
