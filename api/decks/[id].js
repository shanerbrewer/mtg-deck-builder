/**
 * api/decks/[id].js
 *
 * GET    /api/decks/:id  — fetch a single deck's full data
 * PUT    /api/decks/:id  — update deck name and/or text
 * DELETE /api/decks/:id  — delete a deck
 *
 * Vercel Edge Runtime; uses Upstash Redis for storage.
 */

import { redis, userDecksKey, deckKey } from '../_lib/redis.js';
import {
  requireSession,
  jsonOk, json400, json401, json403, json404, json500,
} from '../_lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const token = await requireSession(req);
  if (!token) return json401();

  const userId = token.sub;

  // Extract deck id from URL path: /api/decks/{id}
  const url      = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const id       = segments[segments.length - 1];

  if (!id || id === 'decks') return json400('Missing deck ID');

  if (req.method === 'GET') {
    return handleGet(id, userId);
  }
  if (req.method === 'PUT') {
    return handleUpdate(req, id, userId);
  }
  if (req.method === 'DELETE') {
    return handleDelete(id, userId);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

// ── GET: fetch single deck ────────────────────────────────────────
async function handleGet(id, userId) {
  try {
    const raw = await redis.get(deckKey(id));
    if (!raw) return json404();
    const deck = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (deck.userId !== userId) return json403();
    return jsonOk({ id: deck.id, name: deck.name, text: deck.text, updatedAt: deck.updatedAt });
  } catch (err) {
    console.error('decks GET/:id error:', err);
    return json500('Failed to load deck');
  }
}

// ── PUT: update name and/or text ─────────────────────────────────
async function handleUpdate(req, id, userId) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json400('Invalid JSON body');
  }

  try {
    const raw = await redis.get(deckKey(id));
    if (!raw) return json404();

    const deck = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (deck.userId !== userId) return json403();

    const now = new Date().toISOString();
    if (body.name !== undefined) deck.name = String(body.name).trim().slice(0, 200);
    if (body.text !== undefined) deck.text = String(body.text).trim();
    deck.updatedAt = now;

    // Update deck data
    await redis.set(deckKey(id), JSON.stringify(deck));

    // Update name in the user index if it changed
    const indexRaw = await redis.get(userDecksKey(userId));
    const index    = Array.isArray(indexRaw) ? indexRaw : [];
    const entry    = index.find(d => d.id === id);
    if (entry) {
      entry.name      = deck.name;
      entry.updatedAt = now;
      // Re-sort newest first
      index.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      await redis.set(userDecksKey(userId), JSON.stringify(index));
    }

    return jsonOk({ id, name: deck.name, text: deck.text, updatedAt: now });
  } catch (err) {
    console.error('decks PUT error:', err);
    return json500('Failed to update deck');
  }
}

// ── DELETE ────────────────────────────────────────────────────────
async function handleDelete(id, userId) {
  try {
    const raw = await redis.get(deckKey(id));
    if (!raw) return json404();

    const deck = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (deck.userId !== userId) return json403();

    // Remove deck data
    await redis.del(deckKey(id));

    // Remove from user index
    const indexRaw = await redis.get(userDecksKey(userId));
    if (Array.isArray(indexRaw)) {
      const updated = indexRaw.filter(d => d.id !== id);
      await redis.set(userDecksKey(userId), JSON.stringify(updated));
    }

    return jsonOk({ deleted: id });
  } catch (err) {
    console.error('decks DELETE error:', err);
    return json500('Failed to delete deck');
  }
}
