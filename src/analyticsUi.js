/**
 * analyticsUi.js
 *
 * Renders all mana analytics charts into the #analytics-panel container.
 *
 * Security: all dynamic data is set via textContent or numeric style.width.
 * No innerHTML with user/network data anywhere in this file.
 */

import { COLORS } from './analytics.js';

// MTG colour palette — used for pip demand and production bars
const COLOR_META = {
  W: { label: 'White',     hex: '#f0e8d0' },
  U: { label: 'Blue',      hex: '#4a90d9' },
  B: { label: 'Black',     hex: '#9966cc' },
  R: { label: 'Red',       hex: '#e05a5a' },
  G: { label: 'Green',     hex: '#44aa55' },
  C: { label: 'Colorless', hex: '#aa9977' },
};

/**
 * Clear and re-populate the analytics panel with all five charts.
 * @param {HTMLElement} panelEl         The #analytics-panel element
 * @param {import('./analytics.js').AnalyticsResult} data
 */
export function renderAnalytics(panelEl, data) {
  panelEl.textContent = ''; // safe clear

  panelEl.appendChild(buildManaCurve(data.curve));
  panelEl.appendChild(buildColorDemand(data.pipDemand));
  panelEl.appendChild(buildDemandByCmc(data.pipDemandByCmc));
  panelEl.appendChild(buildManaProduction(data.manaProduction));
  panelEl.appendChild(buildManaBase(data.componentBreakdown));
}

// ── 1. Mana Curve ─────────────────────────────────────────────────

function buildManaCurve(curve) {
  const section = makeSection('Mana Curve', 'mana-curve');
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

// ── 2. Color Pip Demand ───────────────────────────────────────────

function buildColorDemand(pipDemand) {
  const section  = makeSection('Color Pip Demand', 'color-demand');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Total colored mana symbols required by non-land spells';
  section.appendChild(subtitle);

  const total = Math.max(totalPips(pipDemand), 1);

  for (const color of COLORS) {
    const pips = pipDemand[color];
    if (pips === 0) continue;
    section.appendChild(buildHBar(color, pips, total));
  }

  return section;
}

// ── 3. Pip Demand by CMC ──────────────────────────────────────────

function buildDemandByCmc(rows) {
  const section  = makeSection('Color Demand by Drop', 'demand-by-cmc');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Color pips required at each mana cost';
  section.appendChild(subtitle);

  // Filter to CMC rows that have cards
  const active = rows.filter(r => r.count > 0);
  if (active.length === 0) {
    const note = el('p', 'analytics-empty');
    note.textContent = 'No spells loaded.';
    section.appendChild(note);
    return section;
  }

  // Find the max pip value across all CMC/color combos for normalisation
  let maxPips = 1;
  for (const row of active) {
    for (const c of COLORS) maxPips = Math.max(maxPips, row[c]);
  }

  const table = el('table', 'cmc-pip-table');

  // Header
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  for (const h of ['CMC', 'Cards', ...COLORS]) {
    const th = document.createElement('th');
    if (COLOR_META[h]) {
      th.style.color = COLOR_META[h].hex;
    }
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

// ── 4. Mana Production ───────────────────────────────────────────

function buildManaProduction(production) {
  const section  = makeSection('Mana Production', 'mana-production');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Sources that can produce each color (lands + rocks + dorks)';
  section.appendChild(subtitle);

  const allColors = [...COLORS, 'C'];
  const total = Math.max(...allColors.map(c => production[c] ?? 0), 1);
  let anyProducers = false;

  for (const color of allColors) {
    const count = production[color] ?? 0;
    if (count === 0) continue;
    anyProducers = true;
    section.appendChild(buildHBar(color, count, total, 'sources'));
  }

  if (!anyProducers) {
    const note = el('p', 'analytics-empty');
    note.textContent = 'No mana sources detected.';
    section.appendChild(note);
  }

  return section;
}

// ── 5. Mana Base Breakdown ────────────────────────────────────────

function buildManaBase(breakdown) {
  const section  = makeSection('Mana Base Breakdown', 'mana-base');
  const subtitle = el('p', 'analytics-subtitle');
  subtitle.textContent = 'Lands and mana-producing permanents';
  section.appendChild(subtitle);

  const stats = [
    { label: 'Basic Lands',    value: breakdown.basicLands,    icon: '🏔' },
    { label: 'Nonbasic Lands', value: breakdown.nonbasicLands, icon: '🗺' },
    { label: 'Mana Rocks',     value: breakdown.manaRocks,     icon: '💎' },
    { label: 'Mana Dorks',     value: breakdown.manaDorks,     icon: '🌿' },
  ];

  const grid = el('div', 'mana-base-grid');
  for (const { label, value, icon } of stats) {
    const card = el('div', 'mana-base-stat');

    const iconEl = el('span', 'mana-base-icon');
    iconEl.textContent = icon;
    card.appendChild(iconEl);

    const valueEl = el('div', 'mana-base-value');
    valueEl.textContent = String(value);
    card.appendChild(valueEl);

    const labelEl = el('div', 'mana-base-label');
    labelEl.textContent = label;
    card.appendChild(labelEl);

    grid.appendChild(card);
  }

  const totalLands = breakdown.basicLands + breakdown.nonbasicLands;
  const totalSources = totalLands + breakdown.manaRocks + breakdown.manaDorks;
  const summary = el('p', 'mana-base-summary');
  summary.textContent = `${totalLands} lands · ${totalSources} total mana sources`;
  section.appendChild(grid);
  section.appendChild(summary);

  return section;
}

// ── Shared chart components ───────────────────────────────────────

/**
 * Build a labelled horizontal bar for a single colour / value.
 * @param {string} color  One of W U B R G C
 * @param {number} value
 * @param {number} total  Maximum value (used to scale width to 100%)
 * @param {string} [unit] Label suffix (default 'pips')
 */
function buildHBar(color, value, total, unit = 'pips') {
  const meta  = COLOR_META[color] ?? { label: color, hex: '#888' };
  const pct   = Math.round((value / total) * 100);

  const row   = el('div', 'chart-row');

  const dot   = el('span', 'color-dot');
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

/**
 * Create an analytics section card with a title.
 * @returns {HTMLElement}
 */
function makeSection(title, id) {
  const section  = el('div', 'analytics-section');
  section.id     = `analytics-${id}`;
  const h3       = document.createElement('h3');
  h3.className   = 'analytics-title';
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

/** Create an element with a given tag and className. */
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Sum all WUBRG pips in a ColorCounts object. */
function totalPips(counts) {
  return COLORS.reduce((sum, c) => sum + (counts[c] ?? 0), 0);
}
