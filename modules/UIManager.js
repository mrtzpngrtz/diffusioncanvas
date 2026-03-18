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
        // Default is light/blueprint. dark-mode class enables dark theme.
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            if (this.themeIcon) this.themeIcon.textContent = '●';
        } else {
            if (this.themeIcon) this.themeIcon.textContent = '○';
        }

        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => this.toggleTheme());
        }
    }

    toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');

        if (this.themeIcon) this.themeIcon.textContent = isDarkMode ? '●' : '○';
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    }

    updateStatus(message, color = '#555') {
        if (this.statusEl) {
            this.statusEl.textContent = message;
            this.statusEl.style.color = color;
        }
    }

    setupLightbox() {
        if (!this.lightbox || !this.lightboxImage) return;

        this.lightbox.addEventListener('click', () => this.closeLightbox());
        
        // Prevent closing when clicking the image itself
        this.lightboxImage.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close lightbox with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.lightbox.classList.contains('active')) {
                this.closeLightbox();
            }
        });
    }

    openLightbox(imageSrc) {
        if (this.lightbox && this.lightboxImage) {
            this.lightboxImage.src = imageSrc;
            this.lightbox.classList.add('active');
        }
    }

    closeLightbox() {
        if (this.lightbox && this.lightboxImage) {
            this.lightbox.classList.remove('active');
            this.lightboxImage.src = '';
        }
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
        // Docked flush-left below the title block (~76px tall)
        let toolbarPosition = { x: 0, y: 76 };

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
