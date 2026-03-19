/**
 * auth.js (project root)
 *
 * Shared Auth.js configuration imported by api/auth/[...all].js.
 * Uses @auth/core with GitHub OAuth and stateless JWT sessions
 * (no session database required).
 */

import GitHub from '@auth/core/providers/github';

/**
 * Returns the Auth.js config object.
 * All values come from environment variables so this file never
 * contains secrets and is safe to commit.
 */
export function getAuthConfig() {
  return {
    providers: [
      GitHub({
        clientId:     process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
      }),
    ],

    secret:    process.env.AUTH_SECRET,
    trustHost: true,
    basePath:  '/api/auth',

    // JWT strategy: session is encoded in a signed httpOnly cookie.
    // No session table or Redis needed for the auth layer itself.
    session: { strategy: 'jwt' },

    callbacks: {
      // Persist the OAuth provider's user id in the JWT so API routes
      // can retrieve it without a round-trip to a user table.
      jwt({ token, user }) {
        if (user?.id) token.userId = user.id;
        return token;
      },
      session({ session, token }) {
        if (token.userId) session.user.id = String(token.userId);
        return session;
      },
    },

    pages: {
      // After sign-in, redirect back to the app root.
      // Auth.js will use the `callbackUrl` query param when provided.
    },
  };
}
