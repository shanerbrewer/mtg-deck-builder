/**
 * authClient.js
 *
 * Thin client-side wrapper for Auth.js session management.
 *
 * Auth.js handles the full OAuth flow server-side via /api/auth/*.
 * The browser never needs to talk directly to GitHub — it just:
 *   1. Redirects to /api/auth/signin/github to start the OAuth flow.
 *   2. Auth.js handles the callback and sets a signed httpOnly cookie.
 *   3. We call GET /api/auth/session to find out who is signed in.
 *
 * Graceful degradation: if /api/auth/session returns a non-2xx status
 * (e.g., running locally without Vercel Functions), we treat the user
 * as unauthenticated and all auth UI stays hidden.
 */

let _session = null;               // cached session (null = not signed in)
let _listeners = [];               // onSessionChange callbacks
let _initialised = false;

// ── Public API ────────────────────────────────────────────────────

/** Returns the cached session object or null if not signed in. */
export function getSession() {
  return _session;
}

/**
 * Fetch the current session from Auth.js and notify listeners.
 * Called once on app start and implicitly after sign-out.
 */
export async function initSession() {
  if (_initialised) return _session;
  _initialised = true;
  await _fetchSession();
  return _session;
}

/**
 * Register a callback that fires immediately with the current session
 * and again whenever auth state changes.
 * @param {(session: object|null) => void} cb
 */
export function onSessionChange(cb) {
  _listeners.push(cb);
  // Fire immediately so the caller gets the current state
  cb(_session);
}

/** Redirect to the GitHub OAuth sign-in flow. */
export function signIn() {
  // Pass the current page as the callbackUrl so the user returns here.
  const callbackUrl = encodeURIComponent(window.location.href);
  window.location.href = `/api/auth/signin/github?callbackUrl=${callbackUrl}`;
}

/** Sign out by POSTing to the Auth.js signout endpoint, then reload. */
export async function signOut() {
  // Auth.js signout requires a CSRF token
  const csrfRes  = await safeFetch('/api/auth/csrf');
  const csrfJson = csrfRes ? await csrfRes.json().catch(() => ({})) : {};
  const csrfToken = csrfJson.csrfToken ?? '';

  await safeFetch('/api/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `csrfToken=${encodeURIComponent(csrfToken)}&callbackUrl=${encodeURIComponent(window.location.href)}`,
  });

  _session = null;
  _listeners.forEach(cb => cb(null));
  // Reload so the UI is fully reset (avoids stale card caches etc.)
  window.location.reload();
}

// ── Internal helpers ──────────────────────────────────────────────

async function _fetchSession() {
  const res = await safeFetch('/api/auth/session');
  if (!res) {
    _session = null;
    return;
  }

  try {
    const data = await res.json();
    // Auth.js returns {} (empty object) when not signed in
    _session = (data?.user?.name || data?.user?.email) ? data : null;
  } catch {
    _session = null;
  }

  _listeners.forEach(cb => cb(_session));
}

/**
 * fetch() wrapper that swallows network errors instead of throwing.
 * Returns null on failure so callers can treat it as "unavailable".
 */
async function safeFetch(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 200) return null;
    return res;
  } catch {
    return null;
  }
}
