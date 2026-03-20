/**
 * analyticsUi.js
 *
 * Renders all analytics charts and panels into the #analytics-panel container.
 *
 * Security: all dynamic data is set via textContent or numeric style.width/height.
 * No innerHTML with user/network data anywhere in this file.
 */

import { COLORS } from './analytics.js';

// MTG colour palette
const COLOR_META = {
  W: { label: 'White',     hex: '#f0e8d0' },
  U: { label: 'Blue',      hex: '#4a90d9' },
  B: { label: 'Black',     hex: '#9966cc' },
  R: { label: 'Red',       hex: '#e05a5a' },
  G: { label: 'Green',     hex: '#44aa55' },
  C: { label: 'Colorless', hex: '#aa9977' },
};

const TYPE_META = {
  creature:     { label: 'Creatures',     hex: '#44aa55' },
  instant:      { label: 'Instants',      hex: '#4a90d9' },
  sorcery:      { label: 'Sorceries',     hex: '#9966cc' },
  enchantment:  { label: 'Enchantments',  hex: '#e0a020' },
  artifact:     { label: 'Artifacts',     hex: '#aaaaaa' },
  planeswalker: { label: 'Planeswalkers', hex: '#e05a5a' },
  land:         { label: 'Lands',         hex: '#a07830' },
  other:        { label: 'Other',         hex: '#555566' },
};

const ROLE_META = {
  ramp:        { label: 'Ramp',          hex: '#44aa55', icon: '⬆' },
  draw:        { label: 'Card Draw',     hex: '#4a90d9', icon: '🃏' },
  removal:     { label: 'Removal',       hex: '#e05a5a', icon: '⚔' },
  boardWipe:   { label: 'Board Wipes',   hex: '#9966cc', icon: '💥' },
  counterspell: { label: 'Counterspells', hex: '#60b0e0', icon: '🛡' },
  tutor:       { label: 'Tutors',        hex: '#c9a84c', icon: '🔍' },
};

const POWER_LABELS = [
  '', 'Beginner', 'Beginner', 'Casual', 'Casual',
  'Focused', 'Focused', 'Optimized', 'Optimized', 'Competitive', 'Competitive',
];

/**
 * Clear and re-populate the analytics panel with all charts.
 * @param {HTMLElement} panelEl
 * @param {import('./analytics.js').AnalyticsResult} data
 */
export function renderAnalytics(panelEl, data) {
  panelEl.textContent = ''; // safe clear

  panelEl.appendChild(buildDeckSummary(data));
  panelEl.appendChild(buildTypeDistribution(data.typeDistribution));
  panelEl.appendChild(buildRoleBreakdown(data.roleBreakdown));
  panelEl.appendChild(buildManaCurve(data.curve));
  panelEl.appendChild(buildColorDemand(data.pipDemand));
  panelEl.appendChild(buildDemandByCmc(data.pipDemandByCmc));
  panelEl.appendChild(buildManaProduction(data.manaProduction));
  panelEl.appendChild(buildManaBase(data.componentBreakdown));
  panelEl.appendChild(buildInteractionSpeed(data.interactionBySpeed));
  if (data.creatureStats.count > 0) {
    panelEl.appendChild(buildCreatureStats(data.creatureStats));
  }
  panelEl.appendChild(buildColorIdentity(data.colorIdentityDist));
  if (data.tribalCounts.length > 0) {
    panelEl.appendChild(buildTribal(data.tribalCounts));
  }
  panelEl.appendChild(buildPriceBreakdown(data.estimatedPrice));
  panelEl.appendChild(buildPowerScore(data.powerScore));
}

// ── 0. Deck Summary ───────────────────────────────────────────────

function buildDeckSummary(data) {
  const section = makeSection('Deck Summary', 'deck-summary');

  const grid = el('div', 'summary-stat-grid');

  // Average MV
  grid.appendChild(makeSummaryStat(
    data.averageMv.toFixed(2),
    'Avg. Mana Value',
    data.averageMv <= 2.5 ? 'stat-good' : data.averageMv >= 3.5 ? 'stat-warn' : '',
  ));

  // Total lands
  const landStatus = data.landHealth.status;
  grid.appendChild(makeSummaryStat(
    String(data.landHealth.count),
    `Lands (target ${data.landHealth.target})`,
    landStatus === 'ok' ? 'stat-good' : 'stat-warn',
  ));

  // Estimated price
  const priceStr = data.estimatedPrice.total >= 1000
    ? `$${(data.estimatedPrice.total / 1000).toFixed(1)}k`
    : `$${data.estimatedPrice.total.toFixed(0)}`;
  grid.appendChild(makeSummaryStat(priceStr, 'Est. Price (USD)', ''));

  // Singleton check
  const violations = data.singletonViolations.length;
  grid.appendChild(makeSummaryStat(
    violations === 0 ? '✓' : String(violations),
    violations === 0 ? 'Singleton OK' : 'Duplicate Cards',
    violations === 0 ? 'stat-good' : 'stat-warn',
  ));

  section.appendChild(grid);

  // Violation list
  if (data.singletonViolations.length > 0) {
    const note = el('p', 'summary-violation-note');
    note.textContent = 'Duplicates (non-basics): ' +
      data.singletonViolations.map(v => `${v.name} ×${v.quantity}`).join(', ');
    section.appendChild(note);
  }

  return section;
}

function makeSummaryStat(value, label, modifier) {
  const card = el('div', `summary-stat${modifier ? ' ' + modifier : ''}`);
  const v = el('div', 'summary-stat-value');
  v.textContent = value;
  const l = el('div', 'summary-stat-label');
  l.textContent = label;
  card.appendChild(v);
  card.appendChild(l);
  return card;
}

// ── 1. Card Type Distribution ─────────────────────────────────────

function buildTypeDistribution(types) {
  const section  = makeSection('Card Types', 'type-distribution');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Cards by supertype (artifact creatures count in both)';
  section.appendChild(subtitle);

  const entries = Object.entries(types).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    section.appendChild(emptyNote('No cards loaded.'));
    return section;
  }

  const total = Math.max(...entries.map(([, v]) => v), 1);

  for (const [type, count] of entries) {
    const meta = TYPE_META[type] ?? { label: type, hex: '#888' };
    const row  = el('div', 'chart-row');

    const dot = el('span', 'color-dot');
    dot.style.background = meta.hex;
    row.appendChild(dot);

    const label = el('span', 'chart-label');
    label.textContent = meta.label;
    row.appendChild(label);

    const track = el('div', 'chart-bar-track');
    const fill  = el('div', 'chart-bar-fill');
    fill.style.background = meta.hex;
    fill.style.width = `${Math.round((count / total) * 100)}%`;
    fill.style.opacity = '0.85';
    track.appendChild(fill);
    row.appendChild(track);

    const val = el('span', 'chart-value');
    val.textContent = String(count);
    row.appendChild(val);

    section.appendChild(row);
  }

  return section;
}

// ── 2. Role Breakdown ─────────────────────────────────────────────

function buildRoleBreakdown(roles) {
  const section  = makeSection('Deck Roles', 'role-breakdown');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Functional categorization by oracle text';
  section.appendChild(subtitle);

  const entries = Object.entries(roles).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    section.appendChild(emptyNote('No roles detected.'));
    return section;
  }

  const total = Math.max(...entries.map(([, v]) => v), 1);

  for (const [role, count] of entries) {
    const meta = ROLE_META[role] ?? { label: role, hex: '#888', icon: '' };
    const row  = el('div', 'chart-row');

    const iconSpan = el('span', 'role-icon');
    iconSpan.textContent = meta.icon;
    row.appendChild(iconSpan);

    const label = el('span', 'chart-label');
    label.textContent = meta.label;
    row.appendChild(label);

    const track = el('div', 'chart-bar-track');
    const fill  = el('div', 'chart-bar-fill');
    fill.style.background = meta.hex;
    fill.style.width = `${Math.round((count / total) * 100)}%`;
    fill.style.opacity = '0.85';
    track.appendChild(fill);
    row.appendChild(track);

    const val = el('span', 'chart-value');
    val.textContent = `${count} cards`;
    row.appendChild(val);

    section.appendChild(row);
  }

  return section;
}

// ── 3. Mana Curve ─────────────────────────────────────────────────

function buildManaCurve(curve) {
  const section  = makeSection('Mana Curve', 'mana-curve');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Non-land cards by converted mana cost';
  section.appendChild(subtitle);

  const maxCount = Math.max(...curve.map(b => b.count), 1);
  const wrapper  = el('div', 'curve-chart');

  for (const bucket of curve) {
    if (bucket.count === 0 && bucket.cmc > 6) continue;

    const col = el('div', 'curve-col');

    const countLbl = el('div', 'curve-count');
    countLbl.textContent = bucket.count > 0 ? String(bucket.count) : '';
    col.appendChild(countLbl);

    const bar = el('div', 'curve-bar');
    bar.style.height = `${Math.round((bucket.count / maxCount) * 100)}%`;
    col.appendChild(bar);

    const cmcLbl = el('div', 'curve-cmc-label');
    cmcLbl.textContent = bucket.cmc === 7 ? '7+' : String(bucket.cmc);
    col.appendChild(cmcLbl);

    wrapper.appendChild(col);
  }

  section.appendChild(wrapper);
  return section;
}

// ── 4. Color Pip Demand ───────────────────────────────────────────

function buildColorDemand(pipDemand) {
  const section  = makeSection('Color Pip Demand', 'color-demand');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Total colored mana symbols required by non-land spells';
  section.appendChild(subtitle);

  const total = Math.max(totalPips(pipDemand), 1);
  let any = false;

  for (const color of COLORS) {
    const pips = pipDemand[color];
    if (pips === 0) continue;
    any = true;
    section.appendChild(buildHBar(color, pips, total));
  }

  if (!any) section.appendChild(emptyNote('No colored pips detected.'));
  return section;
}

// ── 5. Pip Demand by CMC ──────────────────────────────────────────

function buildDemandByCmc(rows) {
  const section  = makeSection('Color Demand by Drop', 'demand-by-cmc');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Color pips required at each mana cost';
  section.appendChild(subtitle);

  const active = rows.filter(r => r.count > 0);
  if (active.length === 0) {
    section.appendChild(emptyNote('No spells loaded.'));
    return section;
  }

  let maxPips = 1;
  for (const row of active) {
    for (const c of COLORS) maxPips = Math.max(maxPips, row[c]);
  }

  const table = el('table', 'cmc-pip-table');
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  for (const h of ['CMC', 'Cards', ...COLORS]) {
    const th = document.createElement('th');
    if (COLOR_META[h]) th.style.color = COLOR_META[h].hex;
    th.textContent = h;
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of active) {
    const tr = document.createElement('tr');
    const cmcTd = document.createElement('td');
    cmcTd.textContent = row.cmc === 7 ? '7+' : String(row.cmc);
    cmcTd.className = 'cmc-cell';
    tr.appendChild(cmcTd);

    const countTd = document.createElement('td');
    countTd.textContent = String(row.count);
    countTd.className = 'count-cell';
    tr.appendChild(countTd);

    for (const color of COLORS) {
      const td  = document.createElement('td');
      const pips = row[color];
      if (pips > 0) {
        const bar = el('div', `mini-bar bar-${color.toLowerCase()}`);
        bar.style.width = `${Math.round((pips / maxPips) * 100)}%`;
        td.appendChild(bar);
        const lbl = el('span', 'mini-bar-label');
        lbl.textContent = String(pips);
        td.appendChild(lbl);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

// ── 6. Mana Production ────────────────────────────────────────────

function buildManaProduction(production) {
  const section  = makeSection('Mana Production', 'mana-production');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Sources that can produce each color (lands + rocks + dorks)';
  section.appendChild(subtitle);

  const allColors = [...COLORS, 'C'];
  const total = Math.max(...allColors.map(c => production[c] ?? 0), 1);
  let any = false;

  for (const color of allColors) {
    const count = production[color] ?? 0;
    if (count === 0) continue;
    any = true;
    section.appendChild(buildHBar(color, count, total, 'sources'));
  }

  if (!any) section.appendChild(emptyNote('No mana sources detected.'));
  return section;
}

// ── 7. Mana Base Breakdown ────────────────────────────────────────

function buildManaBase(breakdown) {
  const section  = makeSection('Mana Base Breakdown', 'mana-base');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Lands and mana-producing permanents';
  section.appendChild(subtitle);

  const stats = [
    { label: 'Basic Lands',    value: breakdown.basicLands,    icon: '\uD83C\uDFD4' },
    { label: 'Nonbasic Lands', value: breakdown.nonbasicLands, icon: '\uD83D\uDDFA' },
    { label: 'Mana Rocks',     value: breakdown.manaRocks,     icon: '\uD83D\uDC8E' },
    { label: 'Mana Dorks',     value: breakdown.manaDorks,     icon: '\uD83C\uDF3F' },
  ];

  const grid = el('div', 'mana-base-grid');
  for (const { label, value, icon } of stats) {
    const card = el('div', 'mana-base-stat');
    const iconEl = el('span', 'mana-base-icon');
    iconEl.textContent = icon;
    const valueEl = el('div', 'mana-base-value');
    valueEl.textContent = String(value);
    const labelEl = el('div', 'mana-base-label');
    labelEl.textContent = label;
    card.appendChild(iconEl);
    card.appendChild(valueEl);
    card.appendChild(labelEl);
    grid.appendChild(card);
  }

  const totalLands   = breakdown.basicLands + breakdown.nonbasicLands;
  const totalSources = totalLands + breakdown.manaRocks + breakdown.manaDorks;
  const summary = el('p', 'mana-base-summary');
  summary.textContent = `${totalLands} lands \u00b7 ${totalSources} total mana sources`;
  section.appendChild(grid);
  section.appendChild(summary);
  return section;
}

// ── 8. Interaction by Speed ───────────────────────────────────────

function buildInteractionSpeed(bySpeed) {
  const section  = makeSection('Interaction by Speed', 'interaction-speed');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Removal, counterspells & board wipes — how many cost ≤2 mana';
  section.appendChild(subtitle);

  const total = bySpeed.fast + bySpeed.slow;
  if (total === 0) {
    section.appendChild(emptyNote('No interaction detected.'));
    return section;
  }

  const grid = el('div', 'speed-grid');

  const fastCard = el('div', 'speed-stat speed-fast');
  const fastVal  = el('div', 'speed-stat-value');
  fastVal.textContent = String(bySpeed.fast);
  const fastLbl  = el('div', 'speed-stat-label');
  fastLbl.textContent = 'Fast (≤2 mana)';
  fastCard.appendChild(fastVal);
  fastCard.appendChild(fastLbl);

  const slowCard = el('div', 'speed-stat speed-slow');
  const slowVal  = el('div', 'speed-stat-value');
  slowVal.textContent = String(bySpeed.slow);
  const slowLbl  = el('div', 'speed-stat-label');
  slowLbl.textContent = 'Slow (3+ mana)';
  slowCard.appendChild(slowVal);
  slowCard.appendChild(slowLbl);

  grid.appendChild(fastCard);
  grid.appendChild(slowCard);
  section.appendChild(grid);

  // Split bar
  const track = el('div', 'chart-bar-track');
  track.style.height = '14px';
  track.style.marginTop = '0.75rem';
  const fastFill = el('div', 'chart-bar-fill');
  fastFill.style.width = `${Math.round((bySpeed.fast / total) * 100)}%`;
  fastFill.style.background = '#44aa55';
  track.appendChild(fastFill);
  section.appendChild(track);

  const legend = el('p', 'speed-legend');
  legend.textContent = `${bySpeed.fast} fast / ${bySpeed.slow} slow out of ${total} total interaction pieces`;
  section.appendChild(legend);

  return section;
}

// ── 9. Creature Stats ─────────────────────────────────────────────

function buildCreatureStats(stats) {
  const section  = makeSection('Creature Stats', 'creature-stats');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Average power/toughness and evasion across all creatures';
  section.appendChild(subtitle);

  const grid = el('div', 'mana-base-grid');

  const items = [
    { icon: '\u2694\uFE0F', value: stats.avgPower.toFixed(1),     label: 'Avg Power' },
    { icon: '\uD83D\uDEE1\uFE0F', value: stats.avgToughness.toFixed(1), label: 'Avg Toughness' },
    { icon: '\uD83D\uDC41\uFE0F', value: String(stats.evasionCount),     label: 'Has Evasion' },
    { icon: '%',           value: `${stats.evasionPct}%`,          label: 'Evasion Rate' },
  ];

  for (const { icon, value, label } of items) {
    const card = el('div', 'mana-base-stat');
    const iconEl  = el('span', 'mana-base-icon');
    iconEl.textContent = icon;
    const valueEl = el('div', 'mana-base-value');
    valueEl.textContent = value;
    const labelEl = el('div', 'mana-base-label');
    labelEl.textContent = label;
    card.appendChild(iconEl);
    card.appendChild(valueEl);
    card.appendChild(labelEl);
    grid.appendChild(card);
  }

  const summary = el('p', 'mana-base-summary');
  summary.textContent = `${stats.count} total creatures`;
  section.appendChild(grid);
  section.appendChild(summary);
  return section;
}

// ── 10. Color Identity Distribution ──────────────────────────────

function buildColorIdentity(dist) {
  const section  = makeSection('Color Identity', 'color-identity');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Cards by color used in casting cost';
  section.appendChild(subtitle);

  const allColors = [...COLORS, 'C'];
  const total = Math.max(...allColors.map(c => dist[c] ?? 0), 1);
  let any = false;

  for (const color of allColors) {
    const count = dist[color] ?? 0;
    if (count === 0) continue;
    any = true;
    section.appendChild(buildHBar(color, count, total, 'cards'));
  }

  if (!any) section.appendChild(emptyNote('No color data available.'));
  return section;
}

// ── 11. Tribal ────────────────────────────────────────────────────

function buildTribal(tribalCounts) {
  const section  = makeSection('Tribal Synergies', 'tribal');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Creature subtypes with 3+ members';
  section.appendChild(subtitle);

  const maxCount = Math.max(...tribalCounts.map(([, n]) => n), 1);

  for (const [subtype, count] of tribalCounts) {
    const row = el('div', 'chart-row');

    const label = el('span', 'chart-label');
    label.textContent = subtype;
    row.appendChild(label);

    const track = el('div', 'chart-bar-track');
    const fill  = el('div', 'chart-bar-fill');
    fill.style.background = '#c9a84c';
    fill.style.width = `${Math.round((count / maxCount) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);

    const val = el('span', 'chart-value');
    val.textContent = `${count} creatures`;
    row.appendChild(val);

    section.appendChild(row);
  }

  return section;
}

// ── 12. Price Breakdown ───────────────────────────────────────────

function buildPriceBreakdown(price) {
  const section  = makeSection('Estimated Price', 'price-breakdown');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Based on Scryfall market prices (USD)';
  section.appendChild(subtitle);

  const totalEl = el('div', 'price-total');
  totalEl.textContent = `$${price.total.toFixed(2)}`;
  section.appendChild(totalEl);

  if (price.unknown > 0) {
    const note = el('p', 'analytics-subtitle');
    note.textContent = `${price.unknown} card${price.unknown > 1 ? 's' : ''} without price data`;
    section.appendChild(note);
  }

  if (price.expensive.length > 0) {
    const header = el('p', 'price-list-header');
    header.textContent = 'Most expensive cards:';
    section.appendChild(header);

    const list = el('div', 'price-list');
    for (const { name, price: p, quantity } of price.expensive) {
      const row = el('div', 'price-row');
      const nameEl = el('span', 'price-card-name');
      nameEl.textContent = quantity > 1 ? `${name} ×${quantity}` : name;
      const priceEl = el('span', 'price-value');
      priceEl.textContent = `$${p.toFixed(2)}`;
      row.appendChild(nameEl);
      row.appendChild(priceEl);
      list.appendChild(row);
    }
    section.appendChild(list);
  }

  return section;
}

// ── 13. Power Score ───────────────────────────────────────────────

function buildPowerScore(score) {
  const section  = makeSection('Power Level', 'power-score');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Estimated from fast mana, tutors, interaction density, and avg CMC';
  section.appendChild(subtitle);

  const display = el('div', 'power-score-display');

  const numEl = el('div', 'power-score-number');
  numEl.textContent = score.toFixed(1);
  const tier = Math.round(score);
  const hue  = Math.round((score / 10) * 120); // green (120) → red (0) reversed
  numEl.style.color = `hsl(${120 - hue}, 70%, 55%)`;
  display.appendChild(numEl);

  const right = el('div', 'power-score-right');

  const meterTrack = el('div', 'power-score-meter');
  const meterFill  = el('div', 'power-score-fill');
  meterFill.style.width   = `${(score / 10) * 100}%`;
  meterFill.style.background = `hsl(${120 - hue}, 70%, 45%)`;
  meterTrack.appendChild(meterFill);
  right.appendChild(meterTrack);

  const labelEl = el('div', 'power-score-label');
  labelEl.textContent = POWER_LABELS[tier] ?? 'Unknown';
  right.appendChild(labelEl);

  const scaleEl = el('div', 'power-score-scale');
  scaleEl.textContent = '1 = Beginner  ·  5–6 = Focused  ·  9–10 = cEDH';
  right.appendChild(scaleEl);

  display.appendChild(right);
  section.appendChild(display);
  return section;
}

// ── Shared chart components ───────────────────────────────────────

function buildHBar(color, value, total, unit = 'pips') {
  const meta = COLOR_META[color] ?? { label: color, hex: '#888' };
  const pct  = Math.round((value / total) * 100);
  const row  = el('div', 'chart-row');

  const dot = el('span', 'color-dot');
  dot.style.background = meta.hex;
  row.appendChild(dot);

  const label = el('span', 'chart-label');
  label.textContent = meta.label;
  row.appendChild(label);

  const track = el('div', 'chart-bar-track');
  const fill  = el('div', `chart-bar-fill bar-${color.toLowerCase()}`);
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  row.appendChild(track);

  const valLbl = el('span', 'chart-value');
  valLbl.textContent = `${value} ${unit}`;
  row.appendChild(valLbl);

  return row;
}

function makeSection(title, id) {
  const section = el('div', 'analytics-section');
  section.id = `analytics-${id}`;
  const h3 = document.createElement('h3');
  h3.className = 'analytics-title';
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function emptyNote(text) {
  const p = el('p', 'analytics-empty');
  p.textContent = text;
  return p;
}

function totalPips(counts) {
  return COLORS.reduce((sum, c) => sum + (counts[c] ?? 0), 0);
}
