/**
 * api/decks/[id].js
 *
 * GET    /api/decks/:id  — load a specific deck (returns full text)
 * PUT    /api/decks/:id  — update name and/or text
 * DELETE /api/decks/:id  — delete deck
 *
 * Auth + ownership enforced on every request.
 */

import { getToken } from '@auth/core/jwt';
import { Redis }    from '@upstash/redis';

const kv = new Redis({
  url:   process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL   ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
});

export const config = { runtime: 'edge' };

// ── Helpers ──────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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

// ── Handler ──────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const userId = await getUserId(req);
  if (!userId) return err(401, 'Unauthorized');

  // Extract :id from the URL — Vercel provides it in the path
  const url    = new URL(req.url);
  const parts  = url.pathname.split('/');
  const deckId = parts[parts.length - 1];
  if (!deckId) return err(400, 'Missing deck id');

  const deck = await kv.get(`deck:${deckId}`);
  if (!deck)              return err(404, 'Deck not found');
  if (deck.userId !== userId) return err(403, 'Forbidden');

  // ── GET: return full deck ───────────────────────────────────────
  if (req.method === 'GET') {
    return ok(deck);
  }

  // ── PUT: update name / text ─────────────────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return err(400, 'Invalid JSON'); }

    const now     = new Date().toISOString();
    const name    = body.name !== undefined ? String(body.name).trim().slice(0, 120)   : deck.name;
    const text    = body.text !== undefined ? String(body.text).slice(0, 200_000)      : deck.text;
    const updated = { ...deck, name, text, updatedAt: now };

    await kv.set(`deck:${deckId}`, updated);

    // Update index entry
    const index     = await kv.get(`user:${userId}:decks`) ?? [];
    const newIndex  = index.map(d => d.id === deckId ? { id: deckId, name, updatedAt: now } : d);
    await kv.set(`user:${userId}:decks`, newIndex);

    return ok({ id: deckId, name, updatedAt: now });
  }

  // ── DELETE ──────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await kv.del(`deck:${deckId}`);

    const index    = await kv.get(`user:${userId}:decks`) ?? [];
    const newIndex = index.filter(d => d.id !== deckId);
    await kv.set(`user:${userId}:decks`, newIndex);

    return ok({ deleted: true });
  }

  return err(405, 'Method not allowed');
}
