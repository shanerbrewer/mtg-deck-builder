/**
 * api/decks.js
 *
 * GET  /api/decks  — list decks for the authenticated user
 * POST /api/decks  — create a new deck
 *
 * Auth: reads the Auth.js JWT from the session cookie.
 * Storage: Vercel KV
 *   user:{userId}:decks  →  [{id, name, updatedAt}]   (index, max ~50)
 *   deck:{deckId}        →  {id, userId, name, text, createdAt, updatedAt}
 */

import { getToken } from '@auth/core/jwt';
import { Redis }    from '@upstash/redis';

// Supports both legacy Vercel KV env vars and new Upstash integration env vars
const kv = new Redis({
  url:   process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL   ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

export const config = { runtime: 'edge' };

// ── Helpers ──────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(data)       { return Response.json(data, { headers: CORS }); }
function err(status, m) { return Response.json({ error: m }, { status, headers: CORS }); }

async function getUserId(req) {
  const token = await getToken({
    req,
    secret:     process.env.AUTH_SECRET,
    cookieName: process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token',
    secureCookie: process.env.NODE_ENV === 'production',
  });
  return token?.sub ?? null;
}

function generateId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

// ── Handler ──────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return err(401, 'Unauthorized');

  // ── GET: list user decks ────────────────────────────────────────
  if (req.method === 'GET') {
    const index = await kv.get(`user:${userId}:decks`);
    return ok(Array.isArray(index) ? index : []);
  }

  // ── POST: create a new deck ─────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Invalid JSON'); }

    const name = (body.name ?? '').trim().slice(0, 120);
    const text = (body.text ?? '').slice(0, 200_000);  // ~200 KB limit
    if (!text) return err(400, 'Deck text is required');

    const now    = new Date().toISOString();
    const deckId = generateId();
    const deck   = { id: deckId, userId, name, text, createdAt: now, updatedAt: now };

    // Store full deck object
    await kv.set(`deck:${deckId}`, deck);

    // Update user index — keep most-recent 50
    const index = await kv.get(`user:${userId}:decks`) ?? [];
    const entry = { id: deckId, name, updatedAt: now };
    const updated = [entry, ...index.filter(d => d.id !== deckId)].slice(0, 50);
    await kv.set(`user:${userId}:decks`, updated);

    return ok({ id: deckId, name, updatedAt: now });
  }

  return err(405, 'Method not allowed');
}
