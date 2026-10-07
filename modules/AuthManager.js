import { apiFetch, startApiMode, endApiMode, isApiMode, getApiKeys, updateApiKeys } from './ApiSession.js';

export class AuthManager {
    constructor() {
        this.loginModal = document.getElementById('loginModal');
        this.userInfo = document.getElementById('userInfo');
        this.userPhoto = document.getElementById('userPhoto');
        this.userName = document.getElementById('userName');
        this.localLoginForm = document.getElementById('localLoginForm');
        this.loginError = document.getElementById('loginError');
        this.userMenuBtn = document.getElementById('userMenuBtn');
        this.userDropdown = document.getElementById('userDropdown');
        this.deleteAccountBtn = document.getElementById('deleteAccountBtn');
        
        this.init();
    }

    init() {
        this.setupEntryChoice();
        this.setupLocalLogin();
        this.setupUserMenu();
        this.setupDeleteAccount();
        this.setupApiMode();
        this.ready = this.initializeAuth();
    }

    setupEntryChoice() {
        const tabs = [document.getElementById('apiModeTab'), document.getElementById('loginModeTab')];
        const select = (selected) => {
            for (const tab of tabs) {
                const active = tab === selected;
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
                document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
            }
        };
        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => select(tab));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - index];
                select(next);
                next.focus();
            });
        });
    }

    async initializeAuth() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            if (config.desktop) {
                document.body.classList.add('desktop-mode');
                await startApiMode();
                document.getElementById('apiSettingsBtn').hidden = false;
            }
        } catch (error) {
            console.error('App configuration failed:', error);
        }
        await this.checkAuth();
    }

    setupApiMode() {
        const startButton = document.getElementById('startApiModeBtn');
        startButton.addEventListener('click', async () => {
            startButton.disabled = true;
            document.getElementById('apiModeStartError').textContent = '';
            try {
                await this.ready;
                const user = await startApiMode();
                this.showApiMode(user);
            } catch (error) {
                document.getElementById('apiModeStartError').textContent = error.message;
            } finally {
                startButton.disabled = false;
            }
        });
        const form = document.getElementById('apiModeForm');
        const errorEl = document.getElementById('apiModeError');
        const modal = document.getElementById('apiSettingsModal');
        const close = () => { modal.classList.remove('active'); form.reset(); errorEl.textContent = ''; };
        document.getElementById('apiSettingsBtn').addEventListener('click', () => {
            form.reset();
            errorEl.textContent = '';
            const keys = getApiKeys();
            for (const input of form.querySelectorAll('input[name]')) input.value = keys[input.name] || '';
            modal.classList.add('active');
            document.getElementById('apiGoogleKey').focus();
        });
        document.getElementById('apiSettingsClose').addEventListener('click', close);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        document.getElementById('clearApiKeysBtn').addEventListener('click', async () => {
            try { await updateApiKeys({}); close(); } catch (error) { errorEl.textContent = error.message; }
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorEl.textContent = '';
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                const apiKeys = Object.fromEntries(new FormData(form));
                await updateApiKeys(apiKeys);
                close();
            } catch (error) {
                errorEl.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        });
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            if (isApiMode()) {
                await endApiMode();
                window.location.reload();
            } else {
                window.location.href = '/auth/logout';
            }
        });
        window.addEventListener('api-mode-expired', () => window.location.reload());
    }

    showApiMode(user) {
        document.body.classList.add('api-mode');
        this.loginModal.classList.add('hidden');
        this.userInfo.style.display = 'flex';
        this.userPhoto.style.display = 'none';
        this.userName.textContent = user.displayName;
        document.getElementById('userCredits').textContent = 'Own keys · temporary';
        document.getElementById('apiSettingsBtn').hidden = false;
        document.getElementById('adminLink').style.display = 'none';
        this.deleteAccountBtn.style.display = 'none';
        document.getElementById('logoutBtn').lastChild.textContent = 'End API session';
        document.getElementById('cookieNotice').classList.remove('active');
    }

    setupLocalLogin() {
        if (this.localLoginForm) {
            this.localLoginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                this.loginError.textContent = '';

                const email = this.localLoginForm.email.value;
                const password = this.localLoginForm.password.value;

                try {
                    const response = await fetch('/auth/local/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ email, password }),
                    });

                    if (!response.ok) {
                        const data = await response.json();
                        throw new Error(data.message || 'Login failed');
                    }

                    // On successful login, re-check auth to update UI
                    await this.checkAuth();

                } catch (error) {
                    this.loginError.textContent = error.message;
                }
            });
        }
    }

    setupUserMenu() {
        if (this.userMenuBtn && this.userDropdown) {
            this.userMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.userDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.user-info-wrapper')) {
                    this.userDropdown.classList.remove('active');
                }
            });
        }
    }

    setupDeleteAccount() {
        if (this.deleteAccountBtn) {
            this.deleteAccountBtn.addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.')) {
                    try {
                        const response = await fetch('/api/user/delete', {
                            method: 'DELETE',
                            credentials: 'include'
                        });

                        if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.error || 'Failed to delete account');
                        }

                        alert('Your account has been deleted successfully.');
                        window.location.href = '/auth/logout';
                    } catch (error) {
                        alert('Failed to delete account: ' + error.message);
                    }
                }
            });
        }
    }

    async checkAvailableProviders() {
        try {
            const response = await fetch('/api/auth/providers');
            const providers = await response.json();
            
            // Hide unavailable provider buttons
            const googleBtn = document.querySelector('.google-btn');
            const facebookBtn = document.querySelector('.facebook-btn');
            const linkedinBtn = document.querySelector('.linkedin-btn');
            
            if (googleBtn && !providers.google) {
                googleBtn.style.display = 'none';
            }
            if (facebookBtn && !providers.facebook) {
                facebookBtn.style.display = 'none';
            }
            if (linkedinBtn && !providers.linkedin) {
                linkedinBtn.style.display = 'none';
            }
            
            // Show message if no providers are configured
            const hasAnyProvider = providers.google || providers.facebook || providers.linkedin;
            if (!hasAnyProvider) {
                const oauthButtons = document.querySelector('.oauth-buttons');
                if (oauthButtons) {
                    oauthButtons.innerHTML = '<p class="login-oauth-unavailable">No OAuth providers configured. Use your email and password.</p>';
                    document.querySelector('.login-separator').hidden = true;
                }
            }
        } catch (error) {
            console.error('Failed to check available providers:', error);
        }
    }

    async checkAuth() {
        if (isApiMode()) return;
        // If a share link is opened by a visitor, suppress forcing the regular login modal
        const urlParams = new URLSearchParams(window.location.search);
        const isShareLink = !!urlParams.get('share');

        try {
            const response = await apiFetch('/api/user', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.user) {
                // User is authenticated
                this.loginModal.classList.add('hidden');
                this.userInfo.style.display = 'flex';
                if (data.user.photo) {
                    this.userPhoto.src = data.user.photo;
                    this.userPhoto.style.display = '';
                    this.userPhoto.onerror = () => {
                        this.userPhoto.onerror = null;
                        this.userPhoto.style.display = 'none';
                    };
                } else {
                    this.userPhoto.style.display = 'none';
                }
                this.userName.textContent = data.user.displayName || data.user.email;
                
                // Show credits
                const userCredits = document.getElementById('userCredits');
                if (userCredits) {
                    const credits = data.user.credits || 0;
                    userCredits.textContent = `${credits} credit${credits !== 1 ? 's' : ''}`;
                }
                
                // Show admin link if user is admin
                const adminLink = document.getElementById('adminLink');
                if (data.user.isAdmin && adminLink) {
                    adminLink.style.display = 'flex';
                }
            } else {
                // User is not authenticated
                if (!isShareLink) {
                    this.loginModal.classList.remove('hidden');
                    await this.checkAvailableProviders();
                } else {
                    this.loginModal.classList.add('hidden');
                }
                this.userInfo.style.display = 'none';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            if (!isShareLink) {
                this.loginModal.classList.remove('hidden');
                await this.checkAvailableProviders();
            } else {
                this.loginModal.classList.add('hidden');
            }
            this.userInfo.style.display = 'none';
        }
    }

}
