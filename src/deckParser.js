/**
 * deckParser.js
 *
 * Parses plain-text decklists into a structured format.
 *
 * Supported formats:
 *   - Plain:   "1 Card Name"  or  "1x Card Name"
 *   - MTGO:    "1 Card Name (SET) 123"
 *   - Moxfield/Archidekt section headers:
 *       "Commander (1)", "Deck (99)", "Sideboard (15)", etc.
 *   - Companion / Maybeboard sections (treated as sideboard)
 *   - Comment lines starting with "//" are skipped
 */

const SECTION_PATTERNS = [
  { pattern: /^commander\s*(\(\d+\))?$/i,                section: 'commander'  },
  { pattern: /^(deck|main(deck)?|main board)\s*(\(\d+\))?$/i, section: 'deck' },
  { pattern: /^(sideboard|side\s*board)\s*(\(\d+\))?$/i, section: 'sideboard' },
  { pattern: /^(maybeboard|maybe\s*board)\s*(\(\d+\))?$/i, section: 'maybe'  },
  { pattern: /^companion\s*(\(\d+\))?$/i,                section: 'companion'  },
];

// Matches: "1 Card Name", "1x Card Name", "1 Card Name (SET) 123", "1 Card Name *F*"
const CARD_LINE = /^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]{2,6}\)(?:\s+\d+)?)?(?:\s+\*[A-Za-z]\*)*$/;

/**
 * @param {string} text  Raw decklist text
 * @returns {{
 *   commander: string | null,
 *   entries: Array<{quantity: number, name: string}>,
 *   sideboard: Array<{quantity: number, name: string}>,
 *   errors: string[]
 * }}
 */
export function parseDeckList(text) {
  const lines = text.split(/\r?\n/);

  const buckets = {
    commander: [],
    deck:      [],
    sideboard: [],
    maybe:     [],
    companion: [],
  };

  let currentSection = 'deck';
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // Section header?
    const sectionMatch = SECTION_PATTERNS.find(({ pattern }) => pattern.test(line));
    if (sectionMatch) {
      currentSection = sectionMatch.section;
      continue;
    }

    // Card entry?
    const m = CARD_LINE.exec(line);
    if (m) {
      const quantity = parseInt(m[1], 10);
      const name = m[2].trim();

      if (quantity < 1 || quantity > 99) {
        errors.push(`Line ${i + 1}: unusual quantity (${quantity}) for "${name}"`);
      }

      buckets[currentSection].push({ quantity, name });
      continue;
    }

    // Unrecognised line — warn but don't hard-fail
    errors.push(`Line ${i + 1}: could not parse "${line.slice(0, 60)}"`);
  }

  // Commander: first card in commander bucket, or companion bucket
  const commanderEntry =
    buckets.commander[0] ?? buckets.companion[0] ?? null;

  const commander = commanderEntry?.name ?? null;

  // Deck entries: commander bucket + deck bucket (deduplicate by name isn't needed
  // — some 100-card lists put the commander in "Deck" rather than "Commander")
  const entries = [
    ...buckets.commander,
    ...buckets.deck,
  ];

  const sideboard = [...buckets.sideboard, ...buckets.maybe];

  return { commander, entries, sideboard, errors };
}

/**
 * Returns all unique card names from a parsed decklist,
 * deduplicated (needed for batching Scryfall requests).
 * @param {ReturnType<typeof parseDeckList>} parsed
 * @returns {string[]}
 */
export function uniqueNames(parsed) {
  const names = new Set();
  for (const { name } of parsed.entries) names.add(name);
  for (const { name } of parsed.sideboard) names.add(name);
  return [...names];
}
