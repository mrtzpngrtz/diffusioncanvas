// The drawing engine behind both annotation surfaces: the overlay on an image
// node and the large canvas in the lightbox. Everything here works in canvas
// pixels, so the same strokes come out identical whatever size the surface is
// displayed at.

export const DRAW_TOOLS = [
    { id: 'brush',   icon: 'i-pencil', title: 'Brush' },
    { id: 'line',    icon: 'i-line',   title: 'Line' },
    { id: 'arrow',   icon: 'i-arrow',  title: 'Arrow' },
    { id: 'rect',    icon: 'i-square', title: 'Rectangle' },
    { id: 'ellipse', icon: 'i-circle', title: 'Ellipse' },
    { id: 'text',    icon: 'i-type',   title: 'Text' },
    { id: 'eraser',  icon: 'i-eraser', title: 'Eraser' }
];

const SHAPES = new Set(['line', 'arrow', 'rect', 'ellipse']);
const UNDO_LIMIT = 12;

// The toolbar markup, shared so both surfaces offer the same tools in the same
// order. `extra` is appended before the trailing buttons.
export function drawToolbarHTML({ collapse = false, done = false, apply = false } = {}) {
    const tools = DRAW_TOOLS.map((t, i) => `
        <button class="draw-tool${i === 0 ? ' active' : ''}" data-tool="${t.id}" title="${t.title}">
            <svg class="icon"><use href="#${t.icon}"/></svg>
        </button>`).join('');

    return `
        ${tools}
        <span class="draw-sep"></span>
        <button class="draw-fill" title="Filled shapes"><svg class="icon"><use href="#i-fill"/></svg></button>
        <input class="draw-color" type="color" value="#ff3300">
        <input class="draw-size" type="range" min="2" max="80" value="12">
        <span class="draw-sep"></span>
        <button class="draw-undo" title="Undo (Ctrl+Z)"><svg class="icon"><use href="#i-undo"/></svg></button>
        <button class="draw-clear" title="Clear drawing"><svg class="icon"><use href="#i-trash"/></svg></button>
        ${collapse ? '<button class="draw-collapse-btn" title="Collapse toolbar"><svg class="icon"><use href="#i-chevron-down"/></svg></button>' : ''}
        ${apply ? '<button class="draw-apply" title="Apply to node"><svg class="icon"><use href="#i-check"/></svg></button>' : ''}
        ${done ? '<button class="draw-done" title="Done drawing"><svg class="icon"><use href="#i-check"/></svg></button>' : ''}
    `;
}

// Wire a canvas and a toolbar together. onChange fires whenever the pixels
// changed and the change is finished (not on every mouse move).
export function createDrawSurface({ canvas, toolbar, onChange = () => {} }) {
    const ctx = canvas.getContext('2d');
    const state = { tool: 'brush', color: '#ff3300', size: 12, filled: false };

    let drawing = false;
    let start = null;      // shape origin in canvas pixels
    let snapshot = null;   // pixels before the current shape, for live preview
    const undoStack = [];

    const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * canvas.width / r.width,
            y: (e.clientY - r.top) * canvas.height / r.height
        };
    };

    const pushUndo = () => {
        try {
            undoStack.push(canvas.toDataURL('image/png'));
            if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        } catch { /* tainted canvas — undo is a nicety, not worth failing over */ }
    };

    const undo = () => {
        const previous = undoStack.pop();
        if (previous === undefined) return;
        const img = new Image();
        img.onload = () => {
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            onChange();
        };
        img.src = previous;
    };

    const strokeStyle = () => {
        ctx.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = state.color;
        ctx.fillStyle = state.color;
        ctx.lineWidth = state.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };

    const drawShape = (from, to) => {
        strokeStyle();
        const w = to.x - from.x, h = to.y - from.y;

        if (state.tool === 'rect') {
            ctx.beginPath();
            ctx.rect(from.x, from.y, w, h);
            state.filled ? ctx.fill() : ctx.stroke();
            return;
        }

        if (state.tool === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(from.x + w / 2, from.y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
            state.filled ? ctx.fill() : ctx.stroke();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        if (state.tool === 'arrow') {
            // head scales with the line weight, so it stays readable at any size
            const head = Math.max(state.size * 2.5, 12);
            const angle = Math.atan2(h, w);
            ctx.beginPath();
            ctx.moveTo(to.x, to.y);
            ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
            ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
            ctx.closePath();
            ctx.fill();
        }
    };

    const placeText = (e) => {
        const p = pos(e);
        const r = canvas.getBoundingClientRect();
        const scale = r.width / canvas.width;
        const input = document.createElement('input');
        input.className = 'draw-text-input';
        input.style.cssText =
            `left:${r.left + p.x * scale}px;top:${r.top + p.y * scale}px;` +
            `font-size:${state.size * 2 * scale}px;color:${state.color};`;
        document.body.appendChild(input);

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            const text = input.value.trim();
            if (text) {
                pushUndo();
                ctx.globalCompositeOperation = 'source-over';
                ctx.font = `bold ${state.size * 2}px sans-serif`;
                ctx.fillStyle = state.color;
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = state.size * 0.5;
                ctx.fillText(text, p.x, p.y);
                ctx.shadowBlur = 0;
                onChange();
            }
            input.remove();
        };

        input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') { committed = true; input.remove(); }
        });
        // let focus settle before blur can fire
        setTimeout(() => input.addEventListener('blur', commit, { once: true }), 50);
        input.focus();
    };

    // Text uses click so the input is not blurred by the same mouseup
    canvas.addEventListener('click', (e) => {
        if (state.tool !== 'text') return;
        e.stopPropagation();
        placeText(e);
    });

    canvas.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (state.tool === 'text') return;

        pushUndo();
        drawing = true;
        start = pos(e);
        canvas.setPointerCapture(e.pointerId);

        if (SHAPES.has(state.tool)) {
            // keep the pixels underneath so the shape can be redrawn while dragging
            snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return;
        }

        strokeStyle();
        ctx.beginPath();
        ctx.arc(start.x, start.y, state.size / 2, 0, Math.PI * 2);
        ctx.fill();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);

        if (SHAPES.has(state.tool)) {
            if (snapshot) ctx.putImageData(snapshot, 0, 0);
            drawShape(start, p);
            return;
        }

        strokeStyle();
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        start = p;
    });

    const finish = (e) => {
        if (!drawing) return;
        drawing = false;
        if (SHAPES.has(state.tool) && e) {
            if (snapshot) ctx.putImageData(snapshot, 0, 0);
            drawShape(start, pos(e));
        }
        snapshot = null;
        onChange();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => finish(null));

    const cursorFor = (tool) =>
        tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair';

    const setTool = (tool) => {
        state.tool = tool;
        toolbar.querySelectorAll('.draw-tool').forEach(b =>
            b.classList.toggle('active', b.dataset.tool === tool));
        toolbar.querySelector('.draw-fill')?.classList.toggle('disabled', !SHAPES.has(tool));
        canvas.style.cursor = cursorFor(tool);
    };

    toolbar.querySelectorAll('.draw-tool').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool(b.dataset.tool);
    }));

    toolbar.querySelector('.draw-fill')?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.filled = !state.filled;
        e.currentTarget.classList.toggle('active', state.filled);
    });

    toolbar.querySelector('.draw-color')?.addEventListener('input', (e) => {
        e.stopPropagation();
        state.color = e.target.value;
    });

    toolbar.querySelector('.draw-size')?.addEventListener('input', (e) => {
        e.stopPropagation();
        state.size = +e.target.value;
    });

    toolbar.querySelector('.draw-undo')?.addEventListener('click', (e) => {
        e.stopPropagation();
        undo();
    });

    toolbar.querySelector('.draw-clear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndo();
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onChange();
    });

    setTool('brush');

    return { state, setTool, undo, pushUndo };
}
