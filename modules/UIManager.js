import { createDrawSurface, drawToolbarHTML } from './DrawTools.js';
import { getPreference, setPreference } from './ApiSession.js';
export class UIManager {
    constructor() {
        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = document.querySelector('.theme-icon');
        this.statusEl = document.getElementById('status');
        this.lightbox = document.getElementById('lightbox');
        this.lightboxImage = document.getElementById('lightboxImage');
        this.contextMenu = document.getElementById('contextMenu');
        this.toolbar = document.querySelector('.toolbar-overlay');
        
        this.init();
    }

    init() {
        this.setupTheme();
        this.setupLightbox();
        this.setupContextMenu();
        this.setupToolbarDragging();
    }

    setupTheme() {
        // Default is light. dark-mode class enables dark theme; the sun/moon
        // icons swap purely via CSS on body.dark-mode.
        const savedTheme = getPreference('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
        }

        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => this.toggleTheme());
        }
    }

    toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        setPreference('theme', isDarkMode ? 'dark' : 'light');
        if (this.onThemeChange) this.onThemeChange();
    }

    updateStatus(message, color = '#555') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        // Callers pass legacy hex colors; map them onto the design tokens so
        // the status bar stays consistent in both themes.
        const tone = {
            '#e74c3c': 'var(--accent)',   // error
            '#e67e22': 'var(--accent)',   // warning (e.g. unsaved version restore)
            '#27ae60': 'var(--ok)',       // success
            '#667eea': 'var(--text)',     // info/progress — stronger than idle
        }[color] || 'var(--text-muted)';
        this.statusEl.style.color = tone;
        // Re-trigger the flash animation on every update
        this.statusEl.classList.remove('status-flash');
        void this.statusEl.offsetWidth;
        this.statusEl.classList.add('status-flash');
    }

    setupLightbox() {
        if (!this.lightbox || !this.lightboxImage) return;

        this.lightboxStage = document.getElementById('lightboxStage');
        this.lightboxCanvas = document.getElementById('lightboxCanvas');
        this.lightboxToolbar = document.getElementById('lightboxToolbar');
        this._lightboxNode = null;
        this._lightboxDrawing = false;

        // Backdrop closes; anything inside the stage or the controls does not
        this.lightbox.addEventListener('click', (e) => {
            if (e.target === this.lightbox) this.closeLightbox();
        });
        this.lightboxStage?.addEventListener('click', (e) => e.stopPropagation());
        this.lightboxToolbar?.addEventListener('click', (e) => e.stopPropagation());

        document.getElementById('lightboxCloseBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeLightbox();
        });

        document.getElementById('lightboxDrawBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleLightboxDraw(!this._lightboxDrawing);
        });

        document.addEventListener('keydown', (e) => {
            if (!this.lightbox.classList.contains('active')) return;
            if (e.key === 'Escape') this.closeLightbox();
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && this._lightboxDrawing) {
                e.preventDefault();
                e.stopPropagation();
                this._lightboxSurface?.undo();
            }
        });
    }

    // The lightbox annotates the node it was opened from: the same mask, at the
    // image's own resolution, on a canvas the size of the screen instead of a
    // thumbnail. Drawing is opt-in so a plain look at an image stays a look.
    _toggleLightboxDraw(on) {
        if (!this.lightboxCanvas) return;
        if (on && !this._lightboxNode) return; // nothing to annotate onto
        this._lightboxDrawing = on;

        this.lightbox.classList.toggle('drawing', on);
        this.lightboxToolbar.classList.toggle('active', on);
        document.getElementById('lightboxDrawBtn')?.classList.toggle('active', on);
        this.lightboxCanvas.style.pointerEvents = on ? 'all' : 'none';

        if (on && !this._lightboxSurface) {
            this.lightboxToolbar.innerHTML = drawToolbarHTML({ done: true });
            this._lightboxSurface = createDrawSurface({
                canvas: this.lightboxCanvas,
                toolbar: this.lightboxToolbar,
                onChange: () => this._commitLightboxDrawing()
            });
            this.lightboxToolbar.querySelector('.draw-done')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleLightboxDraw(false);
            });
        }
    }

    // Write the lightbox canvas back onto the node's own overlay, so the node
    // shows the same annotation and the board saves it as usual.
    _commitLightboxDrawing() {
        const node = this._lightboxNode;
        if (!node) return;
        node.data.maskData = this.lightboxCanvas.toDataURL('image/png');

        const target = node.data.drawCanvas;
        if (!target) return;
        const ctx = target.getContext('2d');
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.drawImage(this.lightboxCanvas, 0, 0, target.width, target.height);
    }

    openLightbox(imageSrc, node = null) {
        if (!this.lightbox || !this.lightboxImage) return;
        this.lightboxImage.src = imageSrc;
        this.lightbox.classList.add('active');

        this._lightboxNode = node;
        const drawBtn = document.getElementById('lightboxDrawBtn');
        if (drawBtn) drawBtn.style.display = node ? '' : 'none';
        if (!this.lightboxCanvas) return;

        // Match the canvas to the image's own pixels, then carry over whatever
        // has already been drawn on the node.
        const setup = () => {
            const w = this.lightboxImage.naturalWidth || 1024;
            const h = this.lightboxImage.naturalHeight || 1024;
            this.lightboxCanvas.width = w;
            this.lightboxCanvas.height = h;
            const ctx = this.lightboxCanvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);
            if (node?.data.maskData) {
                const mask = new Image();
                mask.onload = () => ctx.drawImage(mask, 0, 0, w, h);
                mask.src = node.data.maskData;
            }
        };
        if (this.lightboxImage.complete && this.lightboxImage.naturalWidth) setup();
        else this.lightboxImage.addEventListener('load', setup, { once: true });
    }

    closeLightbox() {
        if (!this.lightbox || !this.lightboxImage) return;
        this._toggleLightboxDraw(false);
        this.lightbox.classList.remove('active');
        this.lightboxImage.src = '';
        this._lightboxNode = null;
    }

    setupContextMenu() {
        // Hide context menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target)) {
                this.contextMenu.classList.remove('active');
            }
        });

        // Hide context menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.contextMenu && this.contextMenu.classList.contains('active')) {
                this.contextMenu.classList.remove('active');
            }
        });
    }

    showContextMenu(x, y, isConnectionMenu = false) {
        if (!this.contextMenu) return;

        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.classList.add('active');
        
        this.contextMenu.dataset.isConnectionMenu = isConnectionMenu ? 'true' : 'false';
    }

    setupToolbarDragging() {
        if (!this.toolbar) return;

        let isToolbarDragging = false;
        let toolbarDragStart = { x: 0, y: 0 };
        // Floating card with a comfortable margin from the top-left corner
        let toolbarPosition = { x: 16, y: 16 };

        // Set initial position
        this.toolbar.style.left = `${toolbarPosition.x}px`;
        this.toolbar.style.top = `${toolbarPosition.y}px`;
        this.toolbar.style.transform = 'none';

        this.toolbar.addEventListener('mousedown', (e) => {
            // Don't drag if clicking on a button
            if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
                return;
            }
            
            isToolbarDragging = true;
            toolbarDragStart.x = e.clientX - toolbarPosition.x;
            toolbarDragStart.y = e.clientY - toolbarPosition.y;
            this.toolbar.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (isToolbarDragging) {
                toolbarPosition.x = e.clientX - toolbarDragStart.x;
                toolbarPosition.y = e.clientY - toolbarDragStart.y;
                
                this.toolbar.style.left = `${toolbarPosition.x}px`;
                this.toolbar.style.top = `${toolbarPosition.y}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isToolbarDragging) {
                isToolbarDragging = false;
                this.toolbar.style.cursor = 'move';
            }
        });
    }
}
