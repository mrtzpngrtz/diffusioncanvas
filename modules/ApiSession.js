let token = null;
const transientPreferences = new Map();

export function isApiMode() {
    return token !== null;
}

export async function startApiMode(apiKeys) {
    const response = await fetch('/api/api-mode', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start API mode.');
    token = data.token;
    transientPreferences.clear();
    window.dispatchEvent(new Event('api-mode-started'));
    return data.user;
}

export async function endApiMode() {
    const currentToken = token;
    token = null;
    transientPreferences.clear();
    if (currentToken) {
        try {
            await fetch('/api/api-mode', {
                method: 'DELETE', credentials: 'omit', cache: 'no-store',
                headers: { 'X-Api-Session': currentToken }, keepalive: true
            });
        } catch { /* the server also expires abandoned sessions */ }
    }
}

export async function apiFetch(input, options = {}) {
    if (!token) return fetch(input, options);
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return fetch(input, options);
    const headers = new Headers(options.headers);
    headers.set('X-Api-Session', token);
    const response = await fetch(input, { ...options, headers, credentials: 'omit', cache: 'no-store' });
    if (response.status === 401) {
        token = null;
        transientPreferences.clear();
        window.dispatchEvent(new Event('api-mode-expired'));
    }
    return response;
}

// Existing preferences still persist in account mode, never in API mode.
export function getPreference(key) {
    if (isApiMode()) return transientPreferences.get(key) ?? null;
    try { return localStorage.getItem(key); } catch { return null; }
}

export function setPreference(key, value) {
    if (isApiMode()) transientPreferences.set(key, value);
    else { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
}

window.addEventListener('pagehide', () => { void endApiMode(); });
window.addEventListener('pageshow', (event) => {
    // Do not revive a canvas (or credentials) from the back/forward cache.
    if (event.persisted) window.location.reload();
});