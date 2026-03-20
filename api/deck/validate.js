/**
 * POST /api/deck/validate
 *
 * Parses a Commander decklist and runs full rules validation.
 * Does not call Scryfall — validates structure and counts only.
 *
 * Request body:  { "text": "..." }
 * Response:
 *   {
 *     valid: boolean,
 *     commander: string | null,
 *     cardCount: number,
 *     issues: [{ severity: 'error'|'warning', message: string }],
 *     breakdown: { commander: number, deck: number, sideboard: number, ... },
 *     singletonViolations: [{ name: string, quantity: number }],
 *     parseErrors: [{ line: number, text: string, message: string }],
 *   }
 */

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BODY_BYTES = 64_000;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return error(405, 'Method not allowed. Use POST.');
  }

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

  const parsed  = parseDeckList(text);
  const report  = validate(parsed);

  return Response.json(report, {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Validation ────────────────────────────────────────────────────

function validate(parsed) {
  const issues = [];

  // Parse errors → errors
  for (const e of parsed.parseErrors) {
    issues.push({ severity: 'error', message: `Line ${e.line}: ${e.message} ("${e.text}")` });
  }

  // Commander detection
  if (!parsed.commander) {
    issues.push({
      severity: 'warning',
      message:  'No commander detected. Add a "Commander (1)" section or label your commander.',
    });
  }

  // Card count
  const mainCount = parsed.deckEntries.reduce((s, e) => s + e.quantity, 0);
  const cmdCount  = parsed.commanderEntries.reduce((s, e) => s + e.quantity, 0);
  const total     = mainCount + cmdCount;

  if (total < 100) {
    issues.push({ severity: 'error', message: `Deck has ${total} cards. Commander requires exactly 100.` });
  } else if (total > 100) {
    issues.push({ severity: 'error', message: `Deck has ${total} cards. Commander requires exactly 100. Remove ${total - 100} card(s).` });
  }

  if (cmdCount > 1) {
    issues.push({ severity: 'error', message: `Commander section has ${cmdCount} cards. Only 1 (or 2 for partner commanders) is allowed.` });
  }

  // Singleton violations (non-basic lands)
  const nameCounts = new Map();
  for (const { name, quantity } of parsed.allEntries) {
    if (!BASIC_LAND_NAMES.has(name)) {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + quantity);
    }
  }

  const violations = [];
  for (const [name, qty] of nameCounts) {
    if (qty > 1) {
      violations.push({ name, quantity: qty });
      issues.push({ severity: 'error', message: `Singleton violation: "${name}" appears ${qty} times.` });
    }
  }

  // Land count warning
  const landCount = parsed.landCount;
  if (landCount < 33) {
    issues.push({ severity: 'warning', message: `Only ${landCount} lands detected. Commander decks typically run 36–38.` });
  } else if (landCount > 42) {
    issues.push({ severity: 'warning', message: `${landCount} lands detected. This is higher than usual — target is 36–38.` });
  }

  return {
    valid:               issues.filter(i => i.severity === 'error').length === 0,
    commander:           parsed.commander,
    cardCount:           total,
    issues,
    breakdown:           parsed.sections,
    singletonViolations: violations,
    parseErrors:         parsed.parseErrors,
    stats: {
      totalCards:  total,
      commander:   cmdCount,
      mainDeck:    mainCount,
      lands:       landCount,
      uniqueNames: parsed.uniqueNames.length,
    },
  };
}

// ── Parser ────────────────────────────────────────────────────────

const SECTION_HEADERS = new Set([
  'commander', 'deck', 'sideboard', 'maybeboard', 'companion', 'mainboard',
]);

const ENTRY_RE   = /^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]{2,5}\)\s+\d+)?$/;
const SECTION_RE = /^([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s*\(\d+\))?$/;

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

const LAND_KEYWORDS = ['land', 'plains', 'island', 'swamp', 'mountain', 'forest'];

function parseDeckList(text) {
  const lines            = text.split('\n');
  const allEntries       = [];
  const commanderEntries = [];
  const deckEntries      = [];
  const parseErrors      = [];
  const sections         = {};
  let commander          = null;
  let currentSection     = 'Deck';
  let landCount          = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const secMatch = line.match(SECTION_RE);
    if (secMatch && SECTION_HEADERS.has(secMatch[1].toLowerCase())) {
      currentSection = normalizeSection(secMatch[1]);
      continue;
    }

    const m = line.match(ENTRY_RE);
    if (!m) {
      parseErrors.push({ line: i + 1, text: line, message: 'Could not parse line.' });
      continue;
    }

    const quantity = parseInt(m[1], 10);
    const name     = m[2].trim();

    if (quantity < 1 || quantity > 99) {
      parseErrors.push({ line: i + 1, text: line, message: `Invalid quantity: ${quantity}.` });
      continue;
    }

    const entry = { quantity, name, section: currentSection };
    allEntries.push(entry);
    sections[currentSection] = (sections[currentSection] ?? 0) + quantity;

    if (currentSection === 'Commander') {
      commanderEntries.push(entry);
      if (!commander) commander = name;
    } else if (currentSection === 'Deck' || currentSection === 'Mainboard') {
      deckEntries.push(entry);
    }

    // Heuristic land count (by name — not type_line, since we have no Scryfall data)
    const nameLower = name.toLowerCase();
    if (LAND_KEYWORDS.some(k => nameLower.includes(k)) || BASIC_LAND_NAMES.has(name)) {
      landCount += quantity;
    }
  }

  return {
    commander,
    allEntries,
    commanderEntries,
    deckEntries,
    sections,
    parseErrors,
    landCount,
    uniqueNames: [...new Set(allEntries.map(e => e.name))],
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
