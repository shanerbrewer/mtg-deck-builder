/**
 * authClient.js
 *
 * Lightweight Auth.js session client for the browser.
 * Fetches /api/auth/session once on page load and caches the result.
 *
 * Exports:
 *   getSession()              — returns cached session or null
 *   signIn()                  — redirects to GitHub OAuth
 *   signOut()                 — POSTs to /api/auth/signout, then reloads
 *   onSessionChange(callback) — registers a listener called on load + changes
 */

let cachedSession = null;        // {user: {name, email, image, id}} | null
const listeners   = [];          // (session) => void

/**
 * Fetch the current session from the server.
 * Returns null if the user is signed out or the call fails.
 */
export async function fetchSession() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) { cachedSession = null; return null; }
    const data = await res.json();
    // Auth.js returns {} when signed out, or {user: {...}} when signed in
    cachedSession = data?.user ? data : null;
    return cachedSession;
  } catch {
    cachedSession = null;
    return null;
  }
}

/** Returns the in-memory cached session (may be null before fetchSession resolves). */
export function getSession() {
  return cachedSession;
}

/**
 * Register a callback that is called once immediately after the session loads,
 * and again if signIn/signOut changes the session.
 */
export function onSessionChange(cb) {
  listeners.push(cb);
}

function notifyListeners() {
  for (const cb of listeners) cb(cachedSession);
}

/** Redirect to GitHub OAuth sign-in. */
export function signIn() {
  window.location.href = '/api/auth/signin/github';
}

/** POST to /api/auth/signout, then reload the page. */
export async function signOut() {
  try {
    // Auth.js requires a POST with CSRF token; use the session endpoint to
    // get the CSRF token first, then POST to signout.
    const csrfRes  = await fetch('/api/auth/csrf', { credentials: 'include' });
    const { csrfToken } = await csrfRes.json();

    await fetch('/api/auth/signout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `csrfToken=${encodeURIComponent(csrfToken)}`,
      credentials: 'include',
    });
  } catch {
    // If something goes wrong, just clear the cookie by reloading
  } finally {
    cachedSession = null;
    notifyListeners();
    window.location.reload();
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────

// Fetch session immediately on module load and notify listeners
fetchSession().then(notifyListeners);
