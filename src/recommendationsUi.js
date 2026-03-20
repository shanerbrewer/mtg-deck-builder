/**
 * recommendationsUi.js
 *
 * Renders AI-generated card recommendations in the #ai-panel.
 * Uses only createElement / textContent — no innerHTML with dynamic data.
 */

const ROLE_ICONS = {
  'ramp':         '🌿',
  'draw':         '📚',
  'removal':      '⚔️',
  'counterspell': '🌊',
  'board-wipe':   '💥',
  'tutor':        '🔍',
  'synergy':      '✨',
  'utility':      '🔧',
};

const ROLE_COLORS = {
  'ramp':         '#44aa55',
  'draw':         '#4a90d9',
  'removal':      '#d94a4a',
  'counterspell': '#5566cc',
  'board-wipe':   '#cc6644',
  'tutor':        '#8855cc',
  'synergy':      '#c9a84c',
  'utility':      '#887766',
};

// ── Floating card preview (singleton) ───────────────────────────────

let previewEl  = null;
let hideTimer  = null;

function getPreviewEl() {
  if (!previewEl) {
    previewEl = document.createElement('div');
    previewEl.className = 'ai-card-preview';
    previewEl.hidden = true;

    const img = document.createElement('img');
    img.className = 'ai-card-preview-img';
    img.alt = '';
    // Hide preview if the image fails to load (e.g. unknown card name)
    img.addEventListener('error', () => { previewEl.hidden = true; });

    previewEl.appendChild(img);
    document.body.appendChild(previewEl);
  }
  return previewEl;
}

function showPreview(cardName, anchorEl) {
  clearTimeout(hideTimer);

  const preview = getPreviewEl();
  const img     = preview.querySelector('img');

  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
  if (img.dataset.card !== cardName) {
    img.dataset.card = cardName;
    img.src = url;
  }

  // Position: prefer right of anchor; fall back to left if near right edge
  const rect       = anchorEl.getBoundingClientRect();
  const PAD        = 12;
  const PW         = 220; // preview width (matches CSS)

  let left = rect.right + PAD;
  let top  = rect.top;

  if (left + PW > window.innerWidth - PAD) {
    left = rect.left - PW - PAD;
  }
  // Keep inside vertical viewport
  const PH    = 308; // approx card height at normal size
  const maxTop = window.innerHeight - PH - PAD;
  top = Math.max(PAD, Math.min(top, maxTop));

  preview.style.left = `${left}px`;
  preview.style.top  = `${top}px`;
  preview.hidden = false;
}

function scheduleHidePreview() {
  hideTimer = setTimeout(() => {
    if (previewEl) previewEl.hidden = true;
  }, 120);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Show the initial "Get AI Picks" call-to-action.
 * @param {HTMLElement} panelEl
 * @param {() => void}  onFetch
 */
export function renderAiPrompt(panelEl, onFetch) {
  panelEl.textContent = '';

  const wrapper  = el('div', 'ai-prompt-wrapper');
  const icon     = el('div', 'ai-prompt-icon');
  icon.textContent = '✨';

  const heading  = el('h3', 'ai-prompt-heading');
  heading.textContent = 'AI Card Recommendations';

  const desc = el('p', 'ai-prompt-desc');
  desc.textContent =
    'Get personalised card suggestions powered by Claude AI. '
    + 'The AI will analyse your deck\'s strategy and recommend high-impact upgrades.';

  const btn = el('button', 'btn btn-primary ai-fetch-btn');
  btn.textContent = '✨ Get AI Picks';
  btn.addEventListener('click', onFetch);

  append(wrapper, [icon, heading, desc, btn]);
  panelEl.appendChild(wrapper);
}

/**
 * Show a loading spinner while waiting for the API.
 * @param {HTMLElement} panelEl
 */
export function renderAiLoading(panelEl, message = 'Claude is analysing your deck…') {
  // If already showing a loading state, just update the text in place
  const existing = panelEl.querySelector('.ai-loading-text');
  if (existing) {
    existing.textContent = message;
    return;
  }

  panelEl.textContent = '';

  const wrapper  = el('div', 'ai-loading-wrapper');
  const spinner  = el('div', 'spinner');
  const text     = el('p', 'ai-loading-text');
  text.textContent = message;

  append(wrapper, [spinner, text]);
  panelEl.appendChild(wrapper);
}

/**
 * Show an error message with a retry button.
 * @param {HTMLElement} panelEl
 * @param {string}      message
 * @param {() => void}  onRetry
 */
export function renderAiError(panelEl, message, onRetry) {
  panelEl.textContent = '';

  const wrapper = el('div', 'ai-error-wrapper');
  const icon    = el('div', 'ai-error-icon');
  icon.textContent = '⚠️';

  const msg = el('p', 'ai-error-msg');
  msg.textContent = message;

  const btn = el('button', 'btn btn-secondary');
  btn.textContent = 'Try Again';
  btn.addEventListener('click', onRetry);

  append(wrapper, [icon, msg, btn]);
  panelEl.appendChild(wrapper);
}

/**
 * Render AI recommendations.
 * @param {HTMLElement}          panelEl
 * @param {object}               data        — { theme, analysis, recommendations[] }
 * @param {() => void}           onRefetch   — called when user clicks "Refresh"
 * @param {(name: string) => void} onAccept  — called when user accepts a card
 */
export function renderRecommendations(panelEl, data, onRefetch, onAccept) {
  panelEl.textContent = '';

  // ── Header: theme + analysis ──────────────────────────────────
  const headerBox = el('div', 'ai-header');

  const themeBox   = el('div', 'ai-info-box');
  const themeLabel = el('span', 'ai-box-label');
  themeLabel.textContent = '🎯 Deck Theme';
  const themeText  = el('p', 'ai-box-text');
  themeText.textContent = data.theme ?? '';
  append(themeBox, [themeLabel, themeText]);

  const analysisBox   = el('div', 'ai-info-box');
  const analysisLabel = el('span', 'ai-box-label');
  analysisLabel.textContent = '🔬 Analysis';
  const analysisText  = el('p', 'ai-box-text');
  analysisText.textContent = data.analysis ?? '';
  append(analysisBox, [analysisLabel, analysisText]);

  append(headerBox, [themeBox, analysisBox]);
  panelEl.appendChild(headerBox);

  // ── Recommendations grid ───────────────────────────────────────
  const recsRow = el('div', 'ai-recs-row');

  const recsTitle = el('h3', 'ai-recs-title');
  recsTitle.textContent = '✨ Recommended Additions';

  const refreshBtn = el('button', 'btn btn-ghost btn-sm ai-refresh-btn');
  refreshBtn.textContent = '↺ Refresh';
  refreshBtn.title = 'Get new recommendations';
  refreshBtn.addEventListener('click', onRefetch);

  append(recsRow, [recsTitle, refreshBtn]);
  panelEl.appendChild(recsRow);

  const grid = el('div', 'ai-recs-grid');
  for (const rec of (data.recommendations ?? [])) {
    grid.appendChild(buildRecCard(rec, onAccept));
  }
  panelEl.appendChild(grid);
}

// ── Private helpers ──────────────────────────────────────────────────

function buildRecCard(rec, onAccept) {
  const card = el('div', 'ai-rec-card');

  // Role badge
  const role  = rec.role ?? 'utility';
  const badge = el('span', 'ai-role-badge');
  badge.textContent = `${ROLE_ICONS[role] ?? '🔧'} ${role}`;
  badge.style.setProperty('--role-color', ROLE_COLORS[role] ?? '#887766');
  card.appendChild(badge);

  // Card name — hovering shows the Scryfall card image
  const nameEl = el('h4', 'ai-rec-name');
  nameEl.textContent = rec.name ?? '';
  nameEl.title = 'Hover to preview card';
  card.appendChild(nameEl);

  // Hover preview on the whole card
  card.addEventListener('mouseenter', () => showPreview(rec.name, card));
  card.addEventListener('mouseleave', scheduleHidePreview);

  // Reason
  const reasonEl = el('p', 'ai-rec-reason');
  reasonEl.textContent = rec.reason ?? '';
  card.appendChild(reasonEl);

  // Replaces (optional)
  if (rec.replaces) {
    const replacesEl    = el('div', 'ai-rec-replaces');
    const replacesLabel = el('span', 'ai-replaces-label');
    replacesLabel.textContent = 'Replaces: ';
    const replacesName  = el('span', 'ai-replaces-name');
    replacesName.textContent = rec.replaces;
    append(replacesEl, [replacesLabel, replacesName]);
    card.appendChild(replacesEl);
  }

  // ── Accept button ──────────────────────────────────────────────
  const footer = el('div', 'ai-rec-footer');

  const acceptBtn = el('button', 'btn ai-accept-btn');
  acceptBtn.textContent = '+ Add to Deck';
  acceptBtn.addEventListener('click', () => {
    if (card.classList.contains('ai-rec-accepted')) return;

    // Mark as accepted
    card.classList.add('ai-rec-accepted');
    acceptBtn.textContent = '✓ Added';
    acceptBtn.disabled = true;

    // Hide preview for this card
    scheduleHidePreview();

    // Notify parent
    if (typeof onAccept === 'function') onAccept(rec.name, rec.replaces ?? null);
  });

  footer.appendChild(acceptBtn);
  card.appendChild(footer);

  return card;
}

/** Create element with class name(s). */
function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Append multiple children to a parent. */
function append(parent, children) {
  for (const child of children) parent.appendChild(child);
}
