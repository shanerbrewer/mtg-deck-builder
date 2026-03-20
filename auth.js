/**
 * auth.js
 *
 * Auth.js (NextAuth v5 / @auth/core) configuration.
 * Imported by api/auth/[...all].js — not executed directly in the browser.
 *
 * Strategy: stateless JWT sessions stored in an httpOnly cookie.
 * No database adapter required for auth; decks live in Vercel KV.
 */

import GitHub from '@auth/core/providers/github';

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
    session:   { strategy: 'jwt' },
    callbacks: {
      // Embed the GitHub user id into the JWT so we can use it as a KV key
      jwt({ token, profile }) {
        if (profile?.id) token.githubId = String(profile.id);
        return token;
      },
      session({ session, token }) {
        if (token.githubId) session.user.id = token.githubId;
        return session;
      },
    },
  };
}
