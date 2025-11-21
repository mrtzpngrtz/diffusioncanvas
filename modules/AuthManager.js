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
        this.setupLocalLogin();
        this.setupUserMenu();
        this.setupDeleteAccount();
        this.checkAuth();
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
                    oauthButtons.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #e74c3c;">
                            <p style="margin-bottom: 10px;">No OAuth providers configured</p>
                            <p style="font-size: 12px; color: #888;">Please configure at least one OAuth provider in your .env file.</p>
                            <p style="font-size: 12px; color: #888;">See OAUTH_SETUP.md for instructions.</p>
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
                // User is authenticated
                this.loginModal.classList.add('hidden');
                this.userInfo.style.display = 'flex';
                this.userPhoto.src = data.user.photo || '/user_placeholder.png';
                this.userPhoto.onerror = () => {
                    this.userPhoto.onerror = null;
                    this.userPhoto.src = '/user_placeholder.png';
                };
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
                    adminLink.style.display = 'inline-block';
                }
            } else {
                // User is not authenticated
                this.loginModal.classList.remove('hidden');
                this.userInfo.style.display = 'none';
                // Check which providers are available
                await this.checkAvailableProviders();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.loginModal.classList.remove('hidden');
            this.userInfo.style.display = 'none';
            await this.checkAvailableProviders();
        }
    }
}
