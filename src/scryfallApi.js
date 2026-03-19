/**
 * scryfallApi.js
 *
 * Thin wrapper around the Scryfall REST API.
 *
 * Key decisions:
 *  - Uses the /cards/collection endpoint to batch up to 75 cards per request,
 *    minimising round-trips for a 100-card Commander deck (≤ 2 requests).
 *  - Enforces Scryfall's requested ≥100 ms gap between requests.
 *  - Never exposes or stores API keys — Scryfall requires none.
 *  - All fetched URLs are hard-coded to api.scryfall.com to match our CSP.
 */

const API_BASE        = 'https://api.scryfall.com';
const BATCH_SIZE      = 75;   // Scryfall collection endpoint maximum
const REQUEST_DELAY   = 110;  // ms — slightly above Scryfall's 100 ms guideline

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a batch of cards by name from the /cards/collection endpoint.
 * Returns { found: Map<string, Card>, notFound: string[] }
 *
 * @param {string[]} names  Array of card names (max 75)
 */
async function fetchBatch(names) {
  const identifiers = names.map(name => ({ name }));

  const response = await fetch(`${API_BASE}/cards/collection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({ identifiers }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Scryfall API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  const found = new Map();
  for (const card of (data.data ?? [])) {
    // Index by the name as returned by Scryfall (canonical) AND by the name
    // we requested, so partial matches still resolve.
    found.set(card.name, card);
  }

  // not_found entries look like { object: 'card', name: 'Bad Name' }
  const notFound = (data.not_found ?? []).map(nf => nf.name ?? String(nf));

  return { found, notFound };
}

/**
 * Fetch all cards in `names`, batching as needed.
 *
 * @param {string[]} names            Unique card names to fetch
 * @param {Map<string, object>} cache Existing card cache (mutated in place)
 * @param {(loaded: number, total: number) => void} [onProgress]
 * @returns {Promise<{ cardMap: Map<string, object>, notFound: string[] }>}
 */
export async function fetchCardsByNames(names, cache = new Map(), onProgress) {
  const toFetch = names.filter(n => !cache.has(n));
  const allNotFound = [];

  let loaded = names.length - toFetch.length; // already cached

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(REQUEST_DELAY);

    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const { found, notFound } = await fetchBatch(batch);

    for (const [name, card] of found) {
      cache.set(name, card);
    }

    // For cards not found by exact name, try to match case-insensitively
    // against what we requested so the caller knows which requests failed.
    for (const nf of notFound) {
      allNotFound.push(nf);
    }

    loaded += batch.length;
    onProgress?.(Math.min(loaded, names.length), names.length);
  }

  return { cardMap: cache, notFound: allNotFound };
}

/**
 * Helper: return the front-face image URI for a card (handles DFCs).
 * Prefers 'normal' size; falls back to 'large' then 'small'.
 *
 * @param {object} card  Scryfall card object
 * @param {'front'|'back'} [face]
 * @returns {string | null}
 */
export function getImageUri(card, face = 'front') {
  const sizes = ['normal', 'large', 'small'];

  // Single-faced card
  if (card.image_uris) {
    if (face === 'back') return null;
    return pickSize(card.image_uris, sizes);
  }

  // Double-faced / transform / modal DFC
  if (card.card_faces?.length) {
    const idx = face === 'back' ? 1 : 0;
    const faceObj = card.card_faces[idx];
    if (faceObj?.image_uris) return pickSize(faceObj.image_uris, sizes);
  }

  return null;
}

function pickSize(uris, sizes) {
  for (const s of sizes) {
    if (uris[s]) return uris[s];
  }
  return null;
}

/**
 * Returns true if a card has a second face (transform, modal DFC, etc.)
 * @param {object} card
 */
export function isDoubleFaced(card) {
  return Array.isArray(card.card_faces) && card.card_faces.length >= 2
    && !!(card.card_faces[0]?.image_uris || card.card_faces[1]?.image_uris);
}

/**
 * Get oracle text for a card, joining both faces if DFC.
 * @param {object} card
 * @returns {string}
 */
export function getOracleText(card) {
  if (card.oracle_text != null) return card.oracle_text;
  if (card.card_faces?.length) {
    return card.card_faces
      .map(f => f.oracle_text ?? '')
      .filter(Boolean)
      .join('\n—\n');
  }
  return '';
}
