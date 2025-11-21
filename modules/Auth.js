export class Auth {
    constructor() {
        this.loginModal = document.getElementById('loginModal');
        this.userInfo = document.getElementById('userInfo');
        this.userPhoto = document.getElementById('userPhoto');
        this.userName = document.getElementById('userName');
        this.localLoginForm = document.getElementById('localLoginForm');
        this.loginError = document.getElementById('loginError');
        
        this.init();
    }

    init() {
        if (this.localLoginForm) {
            this.localLoginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                this.loginError.textContent = '';

                const email = this.localLoginForm.email.value;
                const password = this.localLoginForm.password.value;

                try {
                    await this.login(email, password);
                } catch (error) {
                    this.loginError.textContent = error.message;
                }
            });
        }

        // User menu functionality
        const userMenuBtn = document.getElementById('userMenuBtn');
        const userDropdown = document.getElementById('userDropdown');
        const deleteAccountBtn = document.getElementById('deleteAccountBtn');

        if (userMenuBtn && userDropdown) {
            userMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.user-info-wrapper')) {
                    userDropdown.classList.remove('active');
                }
            });
        }

        // Delete account functionality
        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', async () => {
                if (confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.')) {
                    try {
                        await this.deleteAccount();
                        alert('Your account has been deleted successfully.');
                        window.location.href = '/auth/logout';
                    } catch (error) {
                        alert('Failed to delete account: ' + error.message);
                    }
                }
            });
        }
        
        // Check auth on load
        this.checkAuth();
    }

    async login(email, password) {
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

        await this.checkAuth();
    }

    async deleteAccount() {
        const response = await fetch('/api/user/delete', {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete account');
        }
    }

    async checkAvailableProviders() {
        try {
            const response = await fetch('/api/auth/providers');
            const providers = await response.json();
            
            const googleBtn = document.querySelector('.google-btn');
            const facebookBtn = document.querySelector('.facebook-btn');
            const linkedinBtn = document.querySelector('.linkedin-btn');
            
            if (googleBtn && !providers.google) googleBtn.style.display = 'none';
            if (facebookBtn && !providers.facebook) facebookBtn.style.display = 'none';
            if (linkedinBtn && !providers.linkedin) linkedinBtn.style.display = 'none';
            
            const hasAnyProvider = providers.google || providers.facebook || providers.linkedin;
            if (!hasAnyProvider) {
                const oauthButtons = document.querySelector('.oauth-buttons');
                if (oauthButtons) {
                    oauthButtons.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #e74c3c;">
                            <p style="margin-bottom: 10px;">No OAuth providers configured</p>
                            <p style="font-size: 12px; color: #888;">Please configure at least one OAuth provider in your .env file.</p>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error('Failed to check available providers:', error);
        }
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/user', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.user) {
                this.updateUI(data.user);
            } else {
                this.showLogin();
                await this.checkAvailableProviders();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.showLogin();
            await this.checkAvailableProviders();
        }
    }

    updateUI(user) {
        this.loginModal.classList.add('hidden');
        this.userInfo.style.display = 'flex';
        this.userPhoto.src = user.photo || '/user_placeholder.png';
        this.userPhoto.onerror = () => {
            this.userPhoto.onerror = null;
            this.userPhoto.src = '/user_placeholder.png';
        };
        this.userName.textContent = user.displayName || user.email;
        
        const userCredits = document.getElementById('userCredits');
        if (userCredits) {
            const credits = user.credits || 0;
            userCredits.textContent = `${credits} credit${credits !== 1 ? 's' : ''}`;
        }
        
        const adminLink = document.getElementById('adminLink');
        if (user.isAdmin && adminLink) {
            adminLink.style.display = 'inline-block';
        }
    }

    showLogin() {
        this.loginModal.classList.remove('hidden');
        this.userInfo.style.display = 'none';
    }
}
