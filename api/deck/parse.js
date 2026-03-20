/**
 * POST /api/deck/parse
 *
 * Parses a raw decklist string into structured JSON.
 * Does not call Scryfall — purely lexical parsing.
 *
 * Request body:  { "text": "1 Sol Ring\n1 Command Tower\n..." }
 * Response:      { commander, entries, errors, sections }
 *
 * Supported formats:
 *   Plain:      "1 Sol Ring"  or  "1x Sol Ring"
 *   MTGO:       "1 Sol Ring (CMD) 472"
 *   Moxfield:   Section headers like "Commander (1)", "Deck (99)"
 */

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BODY_BYTES = 64_000; // 64 KB — a decklist is never larger than this

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return error(405, 'Method not allowed. Use POST.');
  }

  // Guard against oversized bodies
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return error(413, 'Request body too large. Max 64 KB.');
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return error(400, 'Invalid JSON body.');
  }

  const { text } = body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return error(400, '`text` field is required and must be a non-empty string.');
  }

  if (text.length > MAX_BODY_BYTES) {
    return error(413, '`text` is too long. Max 64 000 characters.');
  }

  const result = parseDeckList(text);

  return Response.json(result, {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Parser ────────────────────────────────────────────────────────

const SECTION_HEADERS = new Set([
  'commander', 'deck', 'sideboard', 'maybeboard', 'companion', 'mainboard',
]);

// Matches:  "1 Card Name"  "1x Card Name"  "1 Card Name (SET) 123"
const ENTRY_RE = /^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]{2,5}\)\s+\d+)?$/;

// Section header like "Commander (1)", "Deck (99)", "Sideboard"
const SECTION_RE = /^([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s*\(\d+\))?$/;

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

function parseDeckList(text) {
  const lines      = text.split('\n');
  const entries    = [];
  const errors     = [];
  const sections   = {};   // section name → count
  let commander    = null;
  let currentSection = 'Deck';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip blanks and comments
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // Section header?
    const secMatch = line.match(SECTION_RE);
    if (secMatch && SECTION_HEADERS.has(secMatch[1].toLowerCase())) {
      currentSection = normalizeSection(secMatch[1]);
      continue;
    }

    // Card entry
    const m = line.match(ENTRY_RE);
    if (!m) {
      errors.push({ line: i + 1, text: line, message: 'Could not parse line.' });
      continue;
    }

    const quantity = parseInt(m[1], 10);
    const name     = m[2].trim();

    if (quantity < 1 || quantity > 99) {
      errors.push({ line: i + 1, text: line, message: `Invalid quantity: ${quantity}.` });
      continue;
    }

    entries.push({ quantity, name, section: currentSection });
    sections[currentSection] = (sections[currentSection] ?? 0) + quantity;

    // First card in Commander section (or named "Commander") becomes the commander
    if (currentSection === 'Commander' && !commander) {
      commander = name;
    }
  }

  return {
    commander,
    entries,
    sections,
    errors,
    totalCards:    entries.reduce((s, e) => s + e.quantity, 0),
    uniqueNames:   [...new Set(entries.map(e => e.name))],
  };
}

function normalizeSection(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ── Helpers ───────────────────────────────────────────────────────

function error(status, message) {
  return Response.json(
    { error: message },
    { status, headers: { 'Content-Type': 'application/json', ...CORS } },
  );
}
