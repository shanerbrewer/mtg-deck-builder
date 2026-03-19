/**
 * analytics.js
 *
 * Pure mana analytics computation — no DOM access, fully unit-testable.
 * Reuses getOracleText() from scryfallApi.js for consistent DFC handling.
 */

import { getOracleText } from './scryfallApi.js';

// ── Constants ─────────────────────────────────────────────────────

export const COLORS = /** @type {const} */ (['W', 'U', 'B', 'R', 'G']);

const COLOR_PIP_RE   = /\{([WUBRGC])\}/g;
const HYBRID_RE      = /\{([WUBRG])\/([WUBRGCP])\}/g;   // e.g. {W/U}, {W/P}
const PHYREXIAN_RE   = /\{([WUBRG])\/P\}/g;              // {W/P}, {U/P} …
const MAX_CMC_BUCKET = 7; // 7 = "7+"

// Mana-production indicator patterns
const ANY_COLOR_RE   = /add (?:one )?mana of any(?: one)? color/i;
const ADD_BLOCK_RE   = /add\s+((?:\{[^}]+\}\s*(?:and|or)?\s*)+)/gi;

// ── Public API ────────────────────────────────────────────────────

/**
 * @param {{ commander: string|null, entries: Array<{quantity:number, name:string}> }} parsed
 * @param {Map<string, object>} cardMap  name → Scryfall card object
 * @returns {AnalyticsResult}
 */
export function computeAnalytics(parsed, cardMap) {
  // Initialise accumulators
  const pipDemand       = zero();
  const pipByCmc        = Array.from({ length: MAX_CMC_BUCKET + 1 }, (_, i) => ({ cmc: i, count: 0, ...zero() }));
  const manaProduction  = { ...zero(), C: 0 };
  const componentBreakdown = { basicLands: 0, nonbasicLands: 0, manaRocks: 0, manaDorks: 0 };
  const curve           = Array.from({ length: MAX_CMC_BUCKET + 1 }, (_, i) => ({ cmc: i, count: 0 }));

  for (const { quantity, name } of parsed.entries) {
    const card = cardMap.get(name);
    if (!card) continue;

    const typeLine   = (card.type_line ?? '').toLowerCase();
    const isLand     = typeLine.includes('land');
    const isBasic    = typeLine.includes('basic land');
    const isArtifact = typeLine.includes('artifact');
    const isCreature = typeLine.includes('creature');
    const oracle     = getOracleText(card);
    const producesMana = /\badd\s+\{/i.test(oracle) || ANY_COLOR_RE.test(oracle);

    // ── Component classification ──────────────────────────────────
    if (isLand) {
      if (isBasic) componentBreakdown.basicLands    += quantity;
      else         componentBreakdown.nonbasicLands += quantity;
    } else {
      if (isArtifact && producesMana) componentBreakdown.manaRocks += quantity;
      if (isCreature && producesMana) componentBreakdown.manaDorks += quantity;
    }

    // ── Mana production ───────────────────────────────────────────
    if (isLand || producesMana) {
      const produced = detectProduction(oracle);
      for (const color of [...COLORS, 'C']) {
        if (produced.has(color)) manaProduction[color] += quantity;
      }
    }

    // ── Pip demand (non-land spells only) ─────────────────────────
    if (!isLand) {
      const cost = getManaCost(card);
      if (cost) {
        const pips = parsePips(cost);
        for (const color of COLORS) {
          pipDemand[color] += pips[color] * quantity;
        }

        // CMC bucket
        const cmc    = Math.min(Math.round(card.cmc ?? 0), MAX_CMC_BUCKET);
        const bucket = pipByCmc[cmc];
        bucket.count += quantity;
        for (const color of COLORS) {
          bucket[color] += pips[color] * quantity;
        }

        // Curve
        curve[cmc].count += quantity;
      }
    }
  }

  return {
    pipDemand,
    pipDemandByCmc: pipByCmc,
    manaProduction,
    componentBreakdown,
    curve,
  };
}

// ── Pip parsing ───────────────────────────────────────────────────

/**
 * Count coloured mana symbols in a mana cost string.
 * Hybrid {W/U} → +1 W +1 U (conservative: can require either colour)
 * Phyrexian {W/P} → +1 W (represents a coloured cost option)
 */
export function parsePips(manaCost) {
  const counts = zero();
  if (!manaCost) return counts;

  // Strip hybrids and phyrexians first to avoid double-counting with the
  // simple COLOR_PIP_RE pass.
  let remaining = manaCost;

  // Hybrid non-phyrexian: {W/U} → add both
  remaining = remaining.replace(HYBRID_RE, (_, a, b) => {
    if (COLORS.includes(a)) counts[a] += 1;
    if (COLORS.includes(b)) counts[b] += 1;
    return '';
  });

  // Phyrexian: {W/P} → add the colour
  remaining = remaining.replace(PHYREXIAN_RE, (_, c) => {
    if (COLORS.includes(c)) counts[c] += 1;
    return '';
  });

  // Plain coloured pips
  for (const [, sym] of remaining.matchAll(COLOR_PIP_RE)) {
    if (COLORS.includes(sym)) counts[sym] += 1;
  }

  return counts;
}

// ── Mana production detection ─────────────────────────────────────

/**
 * Detect which colours a card can produce from its oracle text.
 * Returns a Set<'W'|'U'|'B'|'R'|'G'|'C'>.
 *
 * "Add one mana of any color" → all five colours
 * "{T}: Add {G}."            → G
 * "{T}: Add {W} or {U}."    → W, U
 * "{T}: Add {C}{C}."        → C (colourless)
 */
function detectProduction(oracleText) {
  const produced = new Set();
  if (!oracleText) return produced;

  // "any color" shortcut
  if (ANY_COLOR_RE.test(oracleText)) {
    for (const c of COLORS) produced.add(c);
    return produced;
  }

  // Find "Add {…}" sections and extract colour symbols
  for (const [, block] of oracleText.matchAll(ADD_BLOCK_RE)) {
    for (const [, sym] of block.matchAll(COLOR_PIP_RE)) {
      if (COLORS.includes(sym)) produced.add(sym);
      if (sym === 'C')          produced.add('C');
    }
    // Hybrid inside production block: {W/U} → both
    for (const [, a, b] of block.matchAll(HYBRID_RE)) {
      if (COLORS.includes(a)) produced.add(a);
      if (COLORS.includes(b)) produced.add(b);
    }
  }

  return produced;
}

// ── Helpers ───────────────────────────────────────────────────────

function zero() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0 };
}

/**
 * Return the relevant mana cost for pip counting.
 * For DFCs, use the front face's mana cost (the back face usually has none).
 */
function getManaCost(card) {
  if (card.mana_cost) return card.mana_cost;
  // DFC: front face is card_faces[0]
  return card.card_faces?.[0]?.mana_cost ?? '';
}

/**
 * @typedef {{ W:number, U:number, B:number, R:number, G:number }} ColorCounts
 * @typedef {{
 *   pipDemand:        ColorCounts,
 *   pipDemandByCmc:   Array<{cmc:number, count:number} & ColorCounts>,
 *   manaProduction:   ColorCounts & { C:number },
 *   componentBreakdown: { basicLands:number, nonbasicLands:number, manaRocks:number, manaDorks:number },
 *   curve:            Array<{cmc:number, count:number}>,
 * }} AnalyticsResult
 */
