/**
 * api/_lib/redis.js
 *
 * Shared Upstash Redis client for deck API routes.
 * Files inside api/_lib/ are NOT exposed as HTTP endpoints
 * (Vercel ignores paths that start with _).
 */

import { Redis } from '@upstash/redis';

// Redis is lazily instantiated — this module is safe to import even when
// env vars are absent (the client will simply throw on first use).
export const redis = new Redis({
  url:   process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL   ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

// ── Key helpers ──────────────────────────────────────────────────
export const userDecksKey = (userId) => `user:${userId}:decks`;
export const deckKey      = (deckId)  => `deck:${deckId}`;
