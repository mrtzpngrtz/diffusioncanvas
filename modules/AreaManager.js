// Work areas — labelled rectangles drawn on the canvas behind the nodes.
// Dragging an area's header moves the area together with every node inside it,
// so a whole branch of a graph can be pushed aside in one gesture.
//
// The area body deliberately takes no pointer events: only the header and the
// resize grip do. Otherwise an area would swallow marquee drags and panning
// across the space it covers, which is most of the canvas once you use them.

export class AreaManager {
    constructor(canvasManager, nodeManager, uiManager) {
        this.canvasManager = canvasManager;
        this.nodeManager = nodeManager;
        this.uiManager = uiManager;

        this.areas = [];
        this.layer = null;
        this.idCounter = 1;
        this.armed = false;      // next background drag draws an area
        this._draw = null;       // in-progress rectangle
        this._drag = null;       // in-progress move / resize
    }

    init() {
        const nodeCanvas = document.getElementById('nodeCanvas');
        if (!nodeCanvas) return;

        this.layer = document.createElement('div');
        this.layer.className = 'work-area-layer';
        // first child: areas paint behind the nodes that follow them
        nodeCanvas.insertBefore(this.layer, nodeCanvas.firstChild);

        document.addEventListener('pointermove', (e) => this._onPointerMove(e));
        document.addEventListener('pointerup', () => this._onPointerUp());
    }

    // Canvas coordinates for a pointer event
    _toCanvas(e) {
        const r = this.canvasManager.container.getBoundingClientRect();
        const zoom = this.canvasManager.zoom;
        return {
            x: (e.clientX - r.left) / zoom - this.canvasManager.panX,
            y: (e.clientY - r.top) / zoom - this.canvasManager.panY
        };
    }

    arm() {
        this.armed = true;
        this.canvasManager.container.style.cursor = 'crosshair';
        this.uiManager.updateStatus('Drag on the canvas to draw a work area', '#667eea');
    }

    // Called by NodeManager's marquee handler: true means "this drag is mine"
    handleBackgroundPointerDown(e) {
        if (!this.armed && !e.altKey) return false;
        if (e.button !== 0) return false;

        const start = this._toCanvas(e);
        const area = this.createArea({ x: start.x, y: start.y, w: 0, h: 0 });
        this._draw = { area, start };
        this.armed = false;
        this.canvasManager.container.style.cursor = '';
        return true;
    }

    createArea({ x, y, w = 420, h = 320, title = 'Area', id = null }) {
        const area = {
            id: id || `area-${this.idCounter++}`,
            x, y, w, h, title,
            element: document.createElement('div')
        };

        area.element.className = 'work-area';
        area.element.innerHTML = `
            <div class="work-area-header">
                <span class="work-area-title" spellcheck="false"></span>
                <span class="work-area-count"></span>
                <button class="work-area-close" title="Remove area (nodes stay)">&times;</button>
            </div>
            <div class="work-area-resize"></div>
        `;
        const titleEl = area.element.querySelector('.work-area-title');
        titleEl.textContent = title;

        this.layer.appendChild(area.element);
        this.areas.push(area);
        this._place(area);

        area.element.querySelector('.work-area-header').addEventListener('pointerdown', (e) => {
            if (e.target.closest('.work-area-close') || e.target.closest('.work-area-title')) return;
            e.stopPropagation();
            this._startDrag(e, area, 'move');
        });

        area.element.querySelector('.work-area-resize').addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            this._startDrag(e, area, 'resize');
        });

        area.element.querySelector('.work-area-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeArea(area.id);
        });

        // Rename in place
        titleEl.addEventListener('dblclick', () => {
            titleEl.contentEditable = 'true';
            titleEl.focus();
        });
        titleEl.addEventListener('blur', () => {
            titleEl.contentEditable = 'false';
            area.title = titleEl.textContent.trim() || 'Area';
            titleEl.textContent = area.title;
        });
        titleEl.addEventListener('keydown', (e) => {
            e.stopPropagation(); // canvas shortcuts must not fire while typing
            if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
        });

        return area;
    }

    removeArea(id) {
        const i = this.areas.findIndex(a => a.id === id);
        if (i === -1) return;
        this.areas[i].element.remove();
        this.areas.splice(i, 1);
        this.uiManager.updateStatus('Work area removed');
    }

    clear() {
        for (const area of this.areas) area.element.remove();
        this.areas = [];
    }

    _place(area) {
        const el = area.element;
        el.style.left = `${area.x}px`;
        el.style.top = `${area.y}px`;
        el.style.width = `${area.w}px`;
        el.style.height = `${area.h}px`;
        const countEl = el.querySelector('.work-area-count');
        if (countEl) {
            const n = this.nodesInside(area).length;
            countEl.textContent = n ? `${n} node${n > 1 ? 's' : ''}` : '';
        }
    }

    // Membership is positional: a node belongs to an area while its centre is
    // inside the rectangle. Nothing to attach, nothing to keep in sync.
    nodesInside(area) {
        return this.nodeManager.nodes.filter(n => {
            const cx = n.position.x + (n.element.offsetWidth || 0) / 2;
            const cy = n.position.y + (n.element.offsetHeight || 0) / 2;
            return cx >= area.x && cx <= area.x + area.w
                && cy >= area.y && cy <= area.y + area.h;
        });
    }

    _startDrag(e, area, mode) {
        const start = this._toCanvas(e);
        this._drag = {
            area, mode, start,
            origin: { x: area.x, y: area.y, w: area.w, h: area.h },
            // captured once, so a node leaving the rectangle mid-drag still travels
            nodes: mode === 'move'
                ? this.nodesInside(area).map(n => ({
                    node: n,
                    dx: n.position.x - area.x,
                    dy: n.position.y - area.y
                }))
                : []
        };
        area.element.classList.add('dragging');
    }

    _onPointerMove(e) {
        if (this._draw) {
            const area = this._draw.area;
            const start = this._draw.start;
            const p = this._toCanvas(e);
            area.x = Math.min(start.x, p.x);
            area.y = Math.min(start.y, p.y);
            area.w = Math.abs(p.x - start.x);
            area.h = Math.abs(p.y - start.y);
            this._place(area);
            return;
        }

        if (!this._drag) return;
        const p = this._toCanvas(e);
        const { area, mode, start, origin, nodes } = this._drag;

        if (mode === 'resize') {
            area.w = Math.max(120, origin.w + (p.x - start.x));
            area.h = Math.max(80, origin.h + (p.y - start.y));
        } else {
            area.x = origin.x + (p.x - start.x);
            area.y = origin.y + (p.y - start.y);
            for (const entry of nodes) {
                entry.node.position.x = area.x + entry.dx;
                entry.node.position.y = area.y + entry.dy;
                entry.node.element.style.left = `${entry.node.position.x}px`;
                entry.node.element.style.top = `${entry.node.position.y}px`;
            }
            if (nodes.length) this.nodeManager.connectionManager.drawConnections();
        }

        this._place(area);
    }

    _onPointerUp() {
        if (this._draw) {
            const area = this._draw.area;
            this._draw = null;
            // a stray click should not leave a sliver of an area behind
            if (area.w < 40 || area.h < 40) {
                this.removeArea(area.id);
                return;
            }
            this._place(area);
            this.uiManager.updateStatus(
                `Work area with ${this.nodesInside(area).length} node(s)`, '#27ae60');
            return;
        }

        if (!this._drag) return;
        this._drag.area.element.classList.remove('dragging');
        this._place(this._drag.area);
        this.canvasManager.updateMinimap?.();
        this._drag = null;
    }

    serialize() {
        return this.areas.map(a => ({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h, title: a.title }));
    }

    restore(list) {
        this.clear();
        for (const a of list || []) {
            if (!a || typeof a.x !== 'number') continue;
            this.createArea(a);
            const n = parseInt(String(a.id).replace(/\D/g, ''), 10);
            if (n >= this.idCounter) this.idCounter = n + 1;
        }
    }
}
