/**
 * ui.js
 *
 * Renders the card grid and card-detail modal.
 * All dynamic DOM content uses textContent / setAttribute — never innerHTML
 * with untrusted data — to prevent XSS.
 */

import { getImageUri, getOracleText, isDoubleFaced } from './scryfallApi.js';

// ── Card Grid ────────────────────────────────────────────────────

/**
 * Render a list of deck entries into a grid element.
 *
 * @param {HTMLElement} gridEl          Target .card-grid element
 * @param {Array<{quantity:number, name:string}>} entries
 * @param {Map<string, object>} cardMap  name → Scryfall card object
 * @param {(card: object, quantity: number) => void} onCardClick
 */
export function renderCardGrid(gridEl, entries, cardMap, onCardClick) {
  gridEl.textContent = ''; // clear existing — safe, removes all children

  for (const { quantity, name } of entries) {
    const card = cardMap.get(name);
    const tile = buildCardTile(card, name, quantity, onCardClick);
    gridEl.appendChild(tile);
  }
}

function buildCardTile(card, name, quantity, onCardClick) {
  const tile = document.createElement('div');
  tile.className = 'card-tile';
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('role', 'button');
  tile.dataset.quantity = String(quantity);

  // ── Image wrapper
  const imgWrap = document.createElement('div');
  imgWrap.className = 'card-img-wrap';

  const placeholder = document.createElement('div');
  placeholder.className = 'card-img-placeholder';
  placeholder.textContent = '◈';
  imgWrap.appendChild(placeholder);

  if (card) {
    const imgUri = getImageUri(card, 'front');
    if (imgUri) {
      const img = document.createElement('img');
      img.className = 'loading';
      img.alt = card.name; // use canonical name from Scryfall
      // Lazy-load for performance; browsers supporting loading="lazy" defer offscreen cards
      img.loading = 'lazy';

      // Only set src after validating it's a scryfall.io URL (matches our CSP)
      if (isScryfallImageUrl(imgUri)) {
        img.src = imgUri;
      }

      img.addEventListener('load',  () => { img.classList.replace('loading', 'loaded'); });
      img.addEventListener('error', () => { img.remove(); }); // show placeholder on error
      imgWrap.appendChild(img);
    }
  }

  // Quantity badge (shown only when quantity > 1 via CSS)
  const badge = document.createElement('span');
  badge.className = 'card-quantity-badge';
  badge.textContent = `×${quantity}`;
  imgWrap.appendChild(badge);

  tile.appendChild(imgWrap);

  // ── Footer
  const footer = document.createElement('div');
  footer.className = 'card-tile-footer';

  const nameEl = document.createElement('div');
  nameEl.className = 'card-tile-name';
  nameEl.textContent = card?.name ?? name;
  footer.appendChild(nameEl);

  if (card?.type_line) {
    const typeEl = document.createElement('div');
    typeEl.className = 'card-tile-type';
    typeEl.textContent = card.type_line;
    footer.appendChild(typeEl);
  }

  tile.appendChild(footer);

  // ── Click / keyboard handlers
  const handler = () => card && onCardClick(card, quantity);
  tile.addEventListener('click', handler);
  tile.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  });

  return tile;
}

// ── Modal ────────────────────────────────────────────────────────

const modal         = document.getElementById('card-modal');
const modalClose    = document.getElementById('modal-close');
const modalCardImg  = document.getElementById('modal-card-img');
const modalFlipBtn  = document.getElementById('modal-flip-btn');
const modalName     = document.getElementById('modal-card-name');
const modalMana     = document.getElementById('modal-mana-cost');
const modalType     = document.getElementById('modal-type-line');
const modalOracle   = document.getElementById('modal-oracle-text');
const modalStats    = document.getElementById('modal-stats');
const modalFlavor   = document.getElementById('modal-flavor');
const modalSetInfo  = document.getElementById('modal-set-info');
const modalLegality = document.getElementById('modal-legality');

let _activeFace = 'front'; // track flip state

/** Open the card detail modal for a given card object. */
export function openCardModal(card) {
  _activeFace = 'front';
  populateModal(card, 'front');

  // Double-faced cards get a flip button
  if (isDoubleFaced(card)) {
    modalFlipBtn.hidden = false;
    modalFlipBtn.onclick = () => {
      _activeFace = _activeFace === 'front' ? 'back' : 'front';
      populateModal(card, _activeFace);
    };
  } else {
    modalFlipBtn.hidden = true;
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}

export function closeCardModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
}

function populateModal(card, face) {
  const isFront = face !== 'back';

  // Determine which face data to display
  let displayCard = card;
  if (card.card_faces?.length) {
    displayCard = isFront ? card.card_faces[0] : card.card_faces[1];
  }

  // Image
  const imgUri = getImageUri(card, face);
  if (imgUri && isScryfallImageUrl(imgUri)) {
    modalCardImg.src   = imgUri;
    modalCardImg.alt   = displayCard.name ?? card.name;
    modalCardImg.hidden = false;
  } else {
    modalCardImg.hidden = true;
  }

  // Name — always show top-level card name for DFCs, face name otherwise
  modalName.textContent = displayCard.name ?? card.name;

  // Mana cost
  const mana = displayCard.mana_cost ?? card.mana_cost ?? '';
  modalMana.textContent = mana ? formatManaCost(mana) : '';

  // Type line
  modalType.textContent = displayCard.type_line ?? card.type_line ?? '';

  // Oracle text — use pre-line whitespace in CSS; set as textContent for safety
  const oracle = displayCard.oracle_text ?? getOracleText(card);
  modalOracle.textContent = oracle;

  // Power / toughness / loyalty
  const stats = buildStats(displayCard);
  modalStats.textContent = stats;

  // Flavor text
  modalFlavor.textContent = displayCard.flavor_text ?? '';
  modalFlavor.hidden = !displayCard.flavor_text;

  // Set / rarity
  const set   = card.set_name ?? '';
  const rarity = card.rarity   ?? '';
  const num    = card.collector_number ?? '';
  modalSetInfo.textContent = [set, rarity, num && `#${num}`].filter(Boolean).join(' · ');

  // Legalities — only show relevant Commander legality prominently
  renderLegalities(card.legalities ?? {});
}

function buildStats(card) {
  const parts = [];
  if (card.power != null && card.toughness != null) {
    parts.push(`${card.power}/${card.toughness}`);
  }
  if (card.loyalty != null) {
    parts.push(`Loyalty: ${card.loyalty}`);
  }
  if (card.defense != null) {
    parts.push(`Defense: ${card.defense}`);
  }
  return parts.join('  ');
}

const FORMAT_LABELS = {
  commander:  'Commander',
  legacy:     'Legacy',
  modern:     'Modern',
  pioneer:    'Pioneer',
  standard:   'Standard',
  vintage:    'Vintage',
  pauper:     'Pauper',
};

function renderLegalities(legalities) {
  modalLegality.textContent = '';

  for (const [format, label] of Object.entries(FORMAT_LABELS)) {
    const status = legalities[format];
    if (!status) continue;

    const badge = document.createElement('span');
    badge.className = `legality-badge legality-${status}`;
    badge.textContent = `${label}: ${status.replace('_', ' ')}`;
    modalLegality.appendChild(badge);
  }
}

/**
 * Convert Scryfall mana cost notation like "{2}{W}{U}" to a readable string.
 * We keep it as plain text rather than rendering mana symbols as images,
 * so it's safe and works offline. Analytics features can build on top later.
 */
function formatManaCost(cost) {
  return cost
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/\//g, '/')  // split mana e.g. {W/U}
    .split('')
    .join(' ')
    .trim();
}

// ── Backdrop click to close ───────────────────────────────────────
modal?.addEventListener('click', e => {
  if (e.target === modal) closeCardModal();
});

modalClose?.addEventListener('click', closeCardModal);

// Escape key to close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal?.hidden) closeCardModal();
});

// ── Security helper ──────────────────────────────────────────────

/**
 * Validate that an image URL is from a known Scryfall CDN origin.
 * Prevents open-redirect or data-URI injection from a compromised API response.
 */
function isScryfallImageUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      (protocol === 'https:') &&
      (hostname === 'cards.scryfall.io' || hostname.endsWith('.scryfall.io') || hostname.endsWith('.scryfall.com'))
    );
  } catch {
    return false;
  }
}
