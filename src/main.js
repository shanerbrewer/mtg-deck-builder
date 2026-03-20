/**
 * main.js
 *
 * Application entry point — wires together parsing, storage, API, UI,
 * and analytics.
 */

import { parseDeckList, uniqueNames } from './deckParser.js';
import { saveDeck, loadDeckText, loadDeckName, clearDeck, saveCardCache, loadCardCache } from './deckStorage.js';
import { fetchCardsByNames } from './scryfallApi.js';
import { renderCardGrid, openCardModal, closeCardModal } from './ui.js';
import { computeAnalytics } from './analytics.js';
import { renderAnalytics } from './analyticsUi.js';
import {
  renderAiPrompt,
  renderAiLoading,
  renderAiError,
  renderRecommendations,
} from './recommendationsUi.js';

// ── DOM refs ─────────────────────────────────────────────────────
const deckNameInput    = document.getElementById('deck-name-input');
const decklistTextarea = document.getElementById('decklist-textarea');
const fileUpload       = document.getElementById('file-upload');
const loadDeckBtn      = document.getElementById('load-deck-btn');
const clearDeckBtn     = document.getElementById('clear-deck-btn');
const parseErrors      = document.getElementById('parse-errors');

const emptyState       = document.getElementById('empty-state');
const loadingState     = document.getElementById('loading-state');
const loadingText      = document.getElementById('loading-text');
const notFoundBanner   = document.getElementById('not-found-banner');

const commanderSection = document.getElementById('commander-section');
const commanderGrid    = document.getElementById('commander-grid');
const deckSection      = document.getElementById('deck-section');
const deckGrid         = document.getElementById('deck-grid');
const deckSectionCount = document.getElementById('deck-section-count');

const deckNameDisplay  = document.getElementById('deck-name-display');
const cardCountDisplay = document.getElementById('card-count');

const sidebar          = document.getElementById('sidebar');
const toggleSidebar    = document.getElementById('toggle-sidebar');
const sidebarTab       = document.getElementById('sidebar-tab');


// Tab DOM refs
const mainTabs         = document.getElementById('main-tabs');
const tabCards         = document.getElementById('tab-cards');
const tabAnalytics     = document.getElementById('tab-analytics');
const tabAi            = document.getElementById('tab-ai');
const cardsPanel       = document.getElementById('cards-panel');
const analyticsPanel   = document.getElementById('analytics-panel');
const aiPanel          = document.getElementById('ai-panel');

// ── State ────────────────────────────────────────────────────────
let cardCache          = loadCardCache(); // Map<name, scryfallCard>
let currentParsed      = null;            // last successfully loaded parsed deck
let activeTab          = 'cards';
let aiRecommendations  = null;            // cached AI result for current deck
let aiFetching         = false;           // prevent duplicate in-flight requests

// ── Tab switching ─────────────────────────────────────────────────
tabCards?.addEventListener('click', () => switchTab('cards'));
tabAnalytics?.addEventListener('click', () => switchTab('analytics'));
tabAi?.addEventListener('click', () => switchTab('ai'));

function switchTab(tab) {
  activeTab = tab;
  if (cardsPanel)     cardsPanel.hidden     = (tab !== 'cards');
  if (analyticsPanel) analyticsPanel.hidden = (tab !== 'analytics');
  if (aiPanel)        aiPanel.hidden        = (tab !== 'ai');
  tabCards?.classList.toggle('main-tab--active', tab === 'cards');
  tabAnalytics?.classList.toggle('main-tab--active', tab === 'analytics');
  tabAi?.classList.toggle('main-tab--active', tab === 'ai');

  // When switching to AI tab, show cached result or prompt
  if (tab === 'ai' && aiPanel) {
    if (aiRecommendations) {
      renderRecommendations(aiPanel, aiRecommendations, fetchAiRecommendations, handleAcceptRecommendation);
    } else if (currentParsed) {
      renderAiPrompt(aiPanel, fetchAiRecommendations);
    }
  }
}

// ── Initialise from storage ───────────────────────────────────────
(function init() {
  const savedText = loadDeckText();
  const savedName = loadDeckName();

  if (savedText) {
    decklistTextarea.value = savedText;
  }
  if (savedName) {
    deckNameInput.value = savedName;
    deckNameDisplay.textContent = savedName;
  }

  // Auto-load if there's a previously saved deck
  if (savedText.trim()) {
    loadDeck();
  }
})();

// ── Auto-save textarea & name on change ──────────────────────────
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDeck(decklistTextarea.value, deckNameInput.value);
  }, 500);
}

decklistTextarea.addEventListener('input', scheduleSave);
deckNameInput.addEventListener('input', () => {
  deckNameDisplay.textContent = deckNameInput.value;
  scheduleSave();
});

// ── File upload ───────────────────────────────────────────────────
fileUpload.addEventListener('change', () => {
  const file = fileUpload.files?.[0];
  if (!file) return;

  // Validate file type by MIME and extension (belt-and-suspenders)
  const allowedExts = ['.txt', '.dec', '.mwdeck'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowedExts.includes(ext)) {
    showParseErrors([`Unsupported file type: ${file.name}`]);
    fileUpload.value = '';
    return;
  }

  // Sanity-check file size (10 MB max — a decklist should be kilobytes)
  if (file.size > 10 * 1024 * 1024) {
    showParseErrors(['File is too large. Please upload a plain-text decklist.']);
    fileUpload.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    decklistTextarea.value = e.target.result;
    scheduleSave();
  };
  reader.onerror = () => showParseErrors(['Could not read file.']);
  reader.readAsText(file);

  // Reset so re-uploading the same file triggers 'change' again
  fileUpload.value = '';
});

// ── Load Deck ─────────────────────────────────────────────────────
loadDeckBtn.addEventListener('click', loadDeck);

async function loadDeck() {
  const text = decklistTextarea.value.trim();
  if (!text) return;

  hideParseErrors();
  setUIState('loading');

  const parsed = parseDeckList(text);

  if (parsed.errors.length) {
    showParseErrors(parsed.errors);
  }

  if (parsed.entries.length === 0) {
    setUIState('empty');
    showParseErrors(['No cards found. Check your decklist format.']);
    return;
  }

  // Save to localStorage immediately
  saveDeck(text, deckNameInput.value);

  // Invalidate cached AI recommendations when deck changes
  aiRecommendations = null;
  if (aiPanel) aiPanel.textContent = '';

  const names = uniqueNames(parsed);

  try {
    const { cardMap, notFound } = await fetchCardsByNames(
      names,
      cardCache,
      (loaded, total) => {
        loadingText.textContent = `Fetching cards from Scryfall… (${loaded}/${total})`;
      }
    );

    cardCache = cardMap;
    saveCardCache(cardCache);

    // Render cards
    renderDeck(parsed, cardCache);

    // Compute and render analytics
    currentParsed = parsed;
    renderAnalyticsPanelIfLoaded(parsed, cardCache);

    if (notFound.length) {
      showNotFoundBanner(notFound);
    } else {
      notFoundBanner.hidden = true;
    }

    setUIState('loaded');
    updateHeaderCounts(parsed);

  } catch (err) {
    console.error('Failed to fetch cards:', err);
    showParseErrors([`Failed to load cards: ${err.message}`]);
    setUIState('empty');
  }
}

function renderDeck(parsed, cardMap) {
  // Commander section
  if (parsed.commander) {
    const commanderEntries = parsed.entries.filter(
      e => e.name === parsed.commander
    );
    renderCardGrid(commanderGrid, commanderEntries, cardMap, openCardModal);
    commanderSection.hidden = false;
  } else {
    commanderSection.hidden = true;
  }

  // Main deck (exclude commander entry to avoid duplication)
  const mainEntries = parsed.commander
    ? parsed.entries.filter(e => e.name !== parsed.commander)
    : parsed.entries;

  const totalMainCards = mainEntries.reduce((sum, e) => sum + e.quantity, 0);
  deckSectionCount.textContent = totalMainCards;

  renderCardGrid(deckGrid, mainEntries, cardMap, openCardModal);
  deckSection.hidden = mainEntries.length === 0;
}

function renderAnalyticsPanelIfLoaded(parsed, cardMap) {
  if (!analyticsPanel || !parsed) return;
  const data = computeAnalytics(parsed, cardMap);
  renderAnalytics(analyticsPanel, data);
}

// ── AI Recommendations ────────────────────────────────────────────

/**
 * Fetch AI card recommendations from /api/deck/recommend and
 * update the AI panel accordingly.
 */
async function fetchAiRecommendations() {
  if (aiFetching || !currentParsed || !aiPanel) return;

  const text     = decklistTextarea.value.trim();
  const deckName = deckNameInput.value.trim();

  aiFetching = true;
  renderAiLoading(aiPanel);

  try {
    const res = await fetch('/api/deck/recommend', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, deckName }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error ?? `Server error (${res.status}).`;
      renderAiError(aiPanel, msg, fetchAiRecommendations);
      return;
    }

    aiRecommendations = data;
    renderRecommendations(aiPanel, data, fetchAiRecommendations, handleAcceptRecommendation);

  } catch (err) {
    renderAiError(
      aiPanel,
      'Could not reach the recommendations service. Check your network and try again.',
      fetchAiRecommendations,
    );
  } finally {
    aiFetching = false;
  }
}

/**
 * Called when the user accepts an AI recommendation.
 * Appends the card to the decklist textarea and saves.
 * If a "replaces" card was given, removes it from the list first.
 *
 * @param {string}      cardName   — card to add
 * @param {string|null} replaces   — card to remove (optional)
 */
function handleAcceptRecommendation(cardName, replaces) {
  let text = decklistTextarea.value;

  // Remove the "replaces" card if specified and it exists in the list
  if (replaces) {
    // Match lines like "1 Card Name", "1x Card Name", "1 Card Name (SET) 123"
    const escapedName = replaces.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`^\\d+[xX]?\\s+${escapedName}(?:\\s+\\([A-Z0-9]{2,5}\\)\\s+\\d+)?\\s*$`, 'im');
    if (lineRe.test(text)) {
      text = text.replace(lineRe, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
  }

  // Append the new card
  text = text.trimEnd() + '\n1 ' + cardName;
  decklistTextarea.value = text;

  saveDeck(text, deckNameInput.value);

  // Show a brief toast notification
  showAcceptToast(cardName);
}

/** Show a brief "Card added" toast message. */
function showAcceptToast(cardName) {
  const existing = document.getElementById('accept-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'accept-toast';
  toast.className = 'accept-toast';

  const check = document.createElement('span');
  check.textContent = '✓ ';
  check.className = 'accept-toast-check';

  const name = document.createElement('span');
  name.textContent = cardName + ' added to deck';

  toast.appendChild(check);
  toast.appendChild(name);
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('accept-toast--visible'));

  // Remove after 2.5 s
  setTimeout(() => {
    toast.classList.remove('accept-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 2500);
}

// ── Clear Deck ────────────────────────────────────────────────────
clearDeckBtn.addEventListener('click', () => {
  if (!confirm('Clear your deck? This will remove the saved decklist.')) return;
  clearDeck();
  decklistTextarea.value = '';
  deckNameInput.value    = '';
  deckNameDisplay.textContent = '';
  cardCountDisplay.textContent = '';
  cardCache = new Map();
  currentParsed = null;
  setUIState('empty');
  notFoundBanner.hidden = true;
  hideParseErrors();
  if (analyticsPanel) analyticsPanel.textContent = '';
  aiRecommendations = null;
  if (aiPanel) aiPanel.textContent = '';
});

// ── Sidebar toggle ────────────────────────────────────────────────
toggleSidebar.addEventListener('click', () => {
  const isCollapsed = sidebar.classList.toggle('collapsed');
  sidebarTab.hidden = !isCollapsed;
  toggleSidebar.textContent = isCollapsed ? '›' : '‹';
  toggleSidebar.title = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
});

sidebarTab.addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  sidebarTab.hidden = true;
  toggleSidebar.textContent = '‹';
});

// ── UI state helpers ──────────────────────────────────────────────
function setUIState(state) {
  emptyState.hidden   = state !== 'empty';
  loadingState.hidden = state !== 'loading';
  // 'loaded' — both hidden; sections shown by renderDeck
  if (state !== 'loaded') {
    commanderSection.hidden = true;
    deckSection.hidden      = true;
  }

  // Show/hide tab bar
  if (mainTabs) {
    mainTabs.hidden = (state !== 'loaded');
  }

  // Reset to cards tab on new load
  if (state === 'loading') {
    switchTab('cards');
  }
}

function updateHeaderCounts(parsed) {
  const total = parsed.entries.reduce((sum, e) => sum + e.quantity, 0);
  cardCountDisplay.textContent = `${total} cards`;
}

function showParseErrors(errors) {
  parseErrors.textContent = '';
  for (const msg of errors) {
    const p = document.createElement('p');
    p.textContent = msg; // textContent — no XSS risk
    parseErrors.appendChild(p);
  }
  parseErrors.hidden = false;
}

function hideParseErrors() {
  parseErrors.textContent = '';
  parseErrors.hidden = true;
}

function showNotFoundBanner(notFound) {
  notFoundBanner.textContent = '';

  const intro = document.createTextNode(
    `${notFound.length} card${notFound.length > 1 ? 's' : ''} not found on Scryfall: `
  );
  notFoundBanner.appendChild(intro);

  const list = document.createElement('strong');
  list.textContent = notFound.join(', ');
  notFoundBanner.appendChild(list);

  notFoundBanner.hidden = false;
}
