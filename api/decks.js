/**
 * api/decks.js
 *
 * GET  /api/decks  — list the signed-in user's decks (metadata only)
 * POST /api/decks  — create a new deck
 *
 * Vercel Edge Runtime; uses Upstash Redis for storage.
 */

import { redis, userDecksKey, deckKey } from './_lib/redis.js';
import {
  requireSession,
  jsonOk, json400, json401, json500,
} from './_lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const token = await requireSession(req);
  if (!token) return json401();

  const userId = token.sub;

  if (req.method === 'GET') {
    return handleList(userId);
  }
  if (req.method === 'POST') {
    return handleCreate(req, userId);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

// ── GET: list deck metadata ───────────────────────────────────────
async function handleList(userId) {
  try {
    const index = await redis.get(userDecksKey(userId));
    // index is an array of { id, name, updatedAt } sorted newest-first
    return jsonOk(Array.isArray(index) ? index : []);
  } catch (err) {
    console.error('decks GET error:', err);
    return json500('Failed to load decks');
  }
}

// ── POST: create deck ─────────────────────────────────────────────
async function handleCreate(req, userId) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json400('Invalid JSON body');
  }

  const name = String(body.name ?? '').trim().slice(0, 200);
  const text = String(body.text ?? '').trim();

  if (!name) return json400('name is required');

  const id        = crypto.randomUUID();
  const now       = new Date().toISOString();
  const deckData  = { id, userId, name, text, createdAt: now, updatedAt: now };

  try {
    // Store full deck data
    await redis.set(deckKey(id), JSON.stringify(deckData));

    // Update the user's index (prepend newest)
    const existing = await redis.get(userDecksKey(userId));
    const index    = Array.isArray(existing) ? existing : [];
    index.unshift({ id, name, updatedAt: now });
    await redis.set(userDecksKey(userId), JSON.stringify(index));

    return jsonOk({ id, name, updatedAt: now });
  } catch (err) {
    console.error('decks POST error:', err);
    return json500('Failed to save deck');
  }
}
