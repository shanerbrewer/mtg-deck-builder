/**
 * api/auth/[...all].js
 *
 * Catch-all Auth.js edge handler.
 * Handles: /api/auth/signin, /api/auth/callback/github,
 *          /api/auth/session, /api/auth/signout, etc.
 */

import { Auth }        from '@auth/core';
import { getAuthConfig } from '../../auth.js';

export const config = { runtime: 'edge' };

export default (req) => Auth(req, getAuthConfig());
