/**
 * api/_lib/auth.js
 *
 * Shared session-verification helper for deck API routes.
 * Returns the decoded JWT token (with .userId) or null.
 */

import { getToken } from '@auth/core/jwt';

/**
 * Extracts and verifies the Auth.js JWT session cookie from the request.
 *
 * Auth.js uses different cookie names depending on whether the request
 * arrived over HTTPS:
 *   production:  __Secure-authjs.session-token  (Secure flag)
 *   development: authjs.session-token
 *
 * @param {Request} req
 * @returns {Promise<object|null>} Decoded token payload or null if unauthenticated
 */
export async function requireSession(req) {
  const isSecure = new URL(req.url).protocol === 'https:';
  const cookieName = isSecure
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  try {
    const token = await getToken({
      req,
      secret:     process.env.AUTH_SECRET ?? '',
      secureCookie: isSecure,
      salt:       cookieName,
    });

    // token.sub is the GitHub user ID (set by Auth.js automatically).
    // token.userId is our callback addition — both refer to the same user.
    if (!token?.sub) return null;
    return token;
  } catch {
    return null;
  }
}

/** Standard JSON response helpers */
export const jsonOk  = (data)  => json(data, 200);
export const json401 = ()      => json({ error: 'Unauthorized' }, 401);
export const json403 = ()      => json({ error: 'Forbidden' },    403);
export const json404 = ()      => json({ error: 'Not found' },    404);
export const json400 = (msg)   => json({ error: msg },            400);
export const json500 = (msg)   => json({ error: msg },            500);

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
