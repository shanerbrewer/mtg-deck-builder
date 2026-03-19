/**
 * api/auth/[...all].js
 *
 * Catch-all Auth.js handler for all /api/auth/* routes:
 *   GET  /api/auth/session           → current session JSON
 *   GET  /api/auth/signin            → sign-in page redirect
 *   GET  /api/auth/signin/github     → initiate GitHub OAuth
 *   GET  /api/auth/callback/github   → OAuth callback
 *   POST /api/auth/signout           → sign out (clears cookie)
 *   GET  /api/auth/csrf              → CSRF token
 *   GET  /api/auth/providers         → list of configured providers
 *
 * Runs on Vercel Edge Runtime so it starts instantly and is
 * globally distributed. @auth/core's Auth() function accepts a
 * standard Web Fetch API Request and returns a Response — a
 * perfect match for the Edge Runtime.
 */

import { Auth } from '@auth/core';
import { getAuthConfig } from '../../auth.js';

export const config = { runtime: 'edge' };

export default function handler(req) {
  return Auth(req, getAuthConfig());
}
