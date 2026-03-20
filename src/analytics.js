/**
 * analytics.js
 *
 * Pure analytics computation — no DOM access, fully unit-testable.
 * Reuses getOracleText() from scryfallApi.js for consistent DFC handling.
 */

import { getOracleText } from './scryfallApi.js';

// ── Constants ─────────────────────────────────────────────────────

export const COLORS = /** @type {const} */ (['W', 'U', 'B', 'R', 'G']);

const COLOR_PIP_RE  = /\{([WUBRGC])\}/g;
const HYBRID_RE     = /\{([WUBRG])\/([WUBRGCP])\}/g;
const PHYREXIAN_RE  = /\{([WUBRG])\/P\}/g;
const MAX_CMC_BUCKET = 7;

const ANY_COLOR_RE  = /add (?:one )?mana of any(?: one)? color/i;
const ADD_BLOCK_RE  = /add\s+((?:\{[^}]+\}\s*(?:and|or)?\s*)+)/gi;

// Role detection patterns
const DRAW_RE        = /\bdraw (?:a|two|three|\d+|x) cards?/i;
const REMOVAL_RE     = /(?:destroy|exile) target (?:\w+ )*(?:creature|permanent|artifact|enchantment|planeswalker)|return target .+ to (?:its owner's|your) hand|deals? (?:\d+|x) damage to (?:target|any target)/i;
const BOARDWIPE_RE   = /(?:destroy|exile|return) all (?:creatures?|permanents?|nonland)|each creature (?:gets?|has|loses?)|all creatures (?:get|have|lose)|deals? .+ damage to each creature|each player (?:sacrifices?|discards?)/i;
const COUNTER_RE     = /counter target (?:\w+ )*(?:spell|ability)/i;
const LAND_SEARCH_RE = /search your library for .{0,30}(?:land|plains|island|swamp|mountain|forest)/i;
const EVASION_RE     = /\b(?:flying|trample|menace|shadow|fear|intimidate|can't be blocked)\b/i;

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

// ── Public API ────────────────────────────────────────────────────

/**
 * @param {{ commander: string|null, entries: Array<{quantity:number, name:string}> }} parsed
 * @param {Map<string, object>} cardMap  name → Scryfall card object
 * @returns {AnalyticsResult}
 */
export function computeAnalytics(parsed, cardMap) {

  // === Existing accumulators ===
  const pipDemand          = zero();
  const pipByCmc           = Array.from({ length: MAX_CMC_BUCKET + 1 }, (_, i) => ({ cmc: i, count: 0, ...zero() }));
  const manaProduction     = { ...zero(), C: 0 };
  const componentBreakdown = { basicLands: 0, nonbasicLands: 0, manaRocks: 0, manaDorks: 0 };
  const curve              = Array.from({ length: MAX_CMC_BUCKET + 1 }, (_, i) => ({ cmc: i, count: 0 }));

  // === New accumulators ===
  const typeDistribution   = { creature: 0, instant: 0, sorcery: 0, enchantment: 0, artifact: 0, planeswalker: 0, land: 0, other: 0 };
  const roleBreakdown      = { ramp: 0, draw: 0, removal: 0, boardWipe: 0, counterspell: 0, tutor: 0 };
  const colorIdentityDist  = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const subtypeCounts      = new Map();
  const singletonViolations = [];

  let totalMv = 0, nonLandCount = 0;
  let priceTotalCents = 0, priceUnknown = 0;
  const expensiveCards = [];

  const creatureAccum = { totalPower: 0, totalToughness: 0, count: 0, evasionCount: 0 };
  let interactionFast = 0, interactionSlow = 0;
  let tutorCount = 0, fastManaCount = 0, boardWipeCount = 0, interactionTotal = 0;

  for (const { quantity, name } of parsed.entries) {
    const card = cardMap.get(name);
    if (!card) continue;

    const typeLine   = card.type_line ?? '';
    const tlLower    = typeLine.toLowerCase();
    const isLand     = tlLower.includes('land');
    const isBasic    = tlLower.includes('basic land') || BASIC_LAND_NAMES.has(name);
    const isCreature = tlLower.includes('creature');
    const isArtifact = tlLower.includes('artifact');
    const oracle     = getOracleText(card);
    const producesMana = /\badd\s+\{/i.test(oracle) || ANY_COLOR_RE.test(oracle);

    // ── Singleton violations ──────────────────────────────────────
    if (quantity > 1 && !isBasic) {
      singletonViolations.push({ name, quantity });
    }

    // ── Component classification (existing) ───────────────────────
    if (isLand) {
      if (isBasic) componentBreakdown.basicLands    += quantity;
      else         componentBreakdown.nonbasicLands += quantity;
    } else {
      if (isArtifact && producesMana) componentBreakdown.manaRocks += quantity;
      if (isCreature && producesMana) componentBreakdown.manaDorks += quantity;
    }

    // ── Mana production (existing) ────────────────────────────────
    if (isLand || producesMana) {
      const produced = detectProduction(oracle);
      for (const c of [...COLORS, 'C']) {
        if (produced.has(c)) manaProduction[c] += quantity;
      }
    }

    // ── Pip demand (existing, non-land only) ──────────────────────
    if (!isLand) {
      const cost = getManaCost(card);
      if (cost) {
        const pips = parsePips(cost);
        for (const c of COLORS) pipDemand[c] += pips[c] * quantity;
        const cmcBucket = Math.min(Math.round(card.cmc ?? 0), MAX_CMC_BUCKET);
        pipByCmc[cmcBucket].count += quantity;
        for (const c of COLORS) pipByCmc[cmcBucket][c] += pips[c] * quantity;
        curve[cmcBucket].count += quantity;
      }
    }

    // ── Type distribution (multi-type) ────────────────────────────
    const types = getCardTypes(tlLower);
    for (const t of types) typeDistribution[t] += quantity;

    // ── Color identity ────────────────────────────────────────────
    const cardColors = card.colors ?? card.card_faces?.[0]?.colors ?? [];
    if (cardColors.length === 0 && !isLand) colorIdentityDist.C += quantity;
    for (const c of cardColors) {
      if (c in colorIdentityDist) colorIdentityDist[c] += quantity;
    }

    // ── Creature stats & tribal subtypes ──────────────────────────
    if (isCreature) {
      const pw = parseFloat(card.power);
      const tg = parseFloat(card.toughness);
      creatureAccum.count += quantity;
      if (!isNaN(pw)) creatureAccum.totalPower    += pw * quantity;
      if (!isNaN(tg)) creatureAccum.totalToughness += tg * quantity;
      if (EVASION_RE.test(oracle)) creatureAccum.evasionCount += quantity;

      // Extract subtypes (everything after the em dash)
      const dashIdx = typeLine.indexOf('\u2014');
      if (dashIdx !== -1) {
        for (const sub of typeLine.slice(dashIdx + 1).trim().split(/\s+/)) {
          if (sub) subtypeCounts.set(sub, (subtypeCounts.get(sub) ?? 0) + quantity);
        }
      }
    }

    // ── Role breakdown (non-land only) ────────────────────────────
    if (!isLand) {
      const roles = detectRoles(oracle, producesMana);
      for (const role of roles) roleBreakdown[role] += quantity;

      const isInteraction = roles.has('removal') || roles.has('counterspell') || roles.has('boardWipe');
      if (isInteraction) {
        interactionTotal += quantity;
        if ((card.cmc ?? 0) <= 2) interactionFast += quantity;
        else interactionSlow += quantity;
      }
      if (roles.has('tutor'))    tutorCount    += quantity;
      if (roles.has('boardWipe')) boardWipeCount += quantity;

      // Fast mana: CMC 0–1 non-land mana producer
      if (producesMana && (card.cmc ?? 0) <= 1) fastManaCount += quantity;
    }

    // ── Average mana value ────────────────────────────────────────
    if (!isLand) {
      totalMv += (card.cmc ?? 0) * quantity;
      nonLandCount += quantity;
    }

    // ── Estimated price ───────────────────────────────────────────
    const priceStr = card.prices?.usd ?? card.prices?.usd_foil ?? null;
    if (priceStr != null) {
      const p = parseFloat(priceStr);
      if (!isNaN(p)) {
        priceTotalCents += Math.round(p * 100) * quantity;
        if (p >= 5) expensiveCards.push({ name, price: p, quantity });
      } else {
        priceUnknown += quantity;
      }
    } else {
      priceUnknown += quantity;
    }
  }

  // ── Derived values ────────────────────────────────────────────
  const averageMv  = nonLandCount > 0 ? Math.round((totalMv / nonLandCount) * 100) / 100 : 0;
  const totalLands = componentBreakdown.basicLands + componentBreakdown.nonbasicLands;
  const landHealth = {
    count:  totalLands,
    status: totalLands < 33 ? 'low' : totalLands > 40 ? 'high' : 'ok',
    target: '36\u201338',
  };

  expensiveCards.sort((a, b) => b.price - a.price);

  // Top tribes: subtypes appearing on 3+ creatures
  const tribalCounts = [...subtypeCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const powerScore = computePowerScore({
    tutorCount, fastManaCount, interactionTotal, boardWipeCount, averageMv, nonLandCount,
  });

  return {
    // Existing
    pipDemand,
    pipDemandByCmc:  pipByCmc,
    manaProduction,
    componentBreakdown,
    curve,
    // New
    typeDistribution,
    roleBreakdown,
    averageMv,
    singletonViolations,
    estimatedPrice: {
      total:     priceTotalCents / 100,
      expensive: expensiveCards.slice(0, 10),
      unknown:   priceUnknown,
    },
    landHealth,
    interactionBySpeed: { fast: interactionFast, slow: interactionSlow },
    creatureStats: {
      count:        creatureAccum.count,
      avgPower:     creatureAccum.count > 0 ? Math.round(creatureAccum.totalPower    / creatureAccum.count * 10) / 10 : 0,
      avgToughness: creatureAccum.count > 0 ? Math.round(creatureAccum.totalToughness / creatureAccum.count * 10) / 10 : 0,
      evasionCount: creatureAccum.evasionCount,
      evasionPct:   creatureAccum.count > 0 ? Math.round(creatureAccum.evasionCount / creatureAccum.count * 100) : 0,
    },
    colorIdentityDist,
    tribalCounts,
    powerScore,
  };
}

// ── Role detection ────────────────────────────────────────────────

function detectRoles(oracle, producesMana) {
  const roles = new Set();
  const o = oracle ?? '';
  if (producesMana || LAND_SEARCH_RE.test(o))             roles.add('ramp');
  if (DRAW_RE.test(o))                                     roles.add('draw');
  if (REMOVAL_RE.test(o))                                  roles.add('removal');
  if (BOARDWIPE_RE.test(o))                                roles.add('boardWipe');
  if (COUNTER_RE.test(o))                                  roles.add('counterspell');
  if (!LAND_SEARCH_RE.test(o) && /search your library for/i.test(o)) roles.add('tutor');
  return roles;
}

// ── Card type classification ──────────────────────────────────────

function getCardTypes(tlLower) {
  const t = [];
  if (tlLower.includes('land'))         t.push('land');
  if (tlLower.includes('creature'))     t.push('creature');
  if (tlLower.includes('artifact'))     t.push('artifact');
  if (tlLower.includes('enchantment'))  t.push('enchantment');
  if (tlLower.includes('instant'))      t.push('instant');
  if (tlLower.includes('sorcery'))      t.push('sorcery');
  if (tlLower.includes('planeswalker')) t.push('planeswalker');
  if (t.length === 0)                   t.push('other');
  return t;
}

// ── Power score (0–10) ────────────────────────────────────────────

function computePowerScore({ tutorCount, fastManaCount, interactionTotal, boardWipeCount, averageMv, nonLandCount }) {
  let s = 0;
  s += Math.min(fastManaCount * 1.5, 3);                                    // fast mana: up to 3 pts
  s += Math.min(tutorCount * 0.8, 2.5);                                     // tutors: up to 2.5 pts
  const intPct = nonLandCount > 0 ? interactionTotal / nonLandCount : 0;
  s += Math.min(intPct * 15, 2);                                             // interaction density: up to 2 pts
  s += Math.max(0, Math.min((4 - averageMv), 2));                           // low avg CMC: up to 2 pts
  s += Math.min(boardWipeCount * 0.3, 0.5);                                 // board wipes: up to 0.5 pts
  return Math.min(10, Math.max(1, Math.round(s * 10) / 10));
}

// ── Pip parsing ───────────────────────────────────────────────────

export function parsePips(manaCost) {
  const counts = zero();
  if (!manaCost) return counts;

  let remaining = manaCost;

  remaining = remaining.replace(HYBRID_RE, (_, a, b) => {
    if (COLORS.includes(a)) counts[a] += 1;
    if (COLORS.includes(b)) counts[b] += 1;
    return '';
  });

  remaining = remaining.replace(PHYREXIAN_RE, (_, c) => {
    if (COLORS.includes(c)) counts[c] += 1;
    return '';
  });

  for (const [, sym] of remaining.matchAll(COLOR_PIP_RE)) {
    if (COLORS.includes(sym)) counts[sym] += 1;
  }

  return counts;
}

// ── Mana production detection ─────────────────────────────────────

function detectProduction(oracleText) {
  const produced = new Set();
  if (!oracleText) return produced;

  if (ANY_COLOR_RE.test(oracleText)) {
    for (const c of COLORS) produced.add(c);
    return produced;
  }

  for (const [, block] of oracleText.matchAll(ADD_BLOCK_RE)) {
    for (const [, sym] of block.matchAll(COLOR_PIP_RE)) {
      if (COLORS.includes(sym)) produced.add(sym);
      if (sym === 'C')          produced.add('C');
    }
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

function getManaCost(card) {
  if (card.mana_cost) return card.mana_cost;
  return card.card_faces?.[0]?.mana_cost ?? '';
}
