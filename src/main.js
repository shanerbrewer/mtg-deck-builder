/**
 * main.js
 *
 * Application entry point — wires together parsing, storage, API, UI,
 * authentication, cloud storage, and analytics.
 */

import { parseDeckList, uniqueNames } from './deckParser.js';
import { saveDeck, loadDeckText, loadDeckName, clearDeck, saveCardCache, loadCardCache } from './deckStorage.js';
import { fetchCardsByNames } from './scryfallApi.js';
import { renderCardGrid, openCardModal, closeCardModal } from './ui.js';
import { initSession, onSessionChange, signIn, signOut } from './authClient.js';
import { listDecks, loadCloudDeck, createCloudDeck, updateCloudDeck, deleteCloudDeck } from './cloudStorage.js';
import { renderSavedDecks } from './savedDecksUi.js';
import { computeAnalytics } from './analytics.js';
import { renderAnalytics } from './analyticsUi.js';

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

// Auth DOM refs
const authSigninBtn    = document.getElementById('auth-signin-btn');
const authUserEmail    = document.getElementById('auth-user-email');
const authSignoutBtn   = document.getElementById('auth-signout-btn');

// Cloud save DOM refs
const cloudSaveRow     = document.getElementById('cloud-save-row');
const saveDeckBtn      = document.getElementById('save-deck-btn');
const saveStatus       = document.getElementById('save-status');

// Saved decks DOM refs
const savedDecksSection = document.getElementById('saved-decks-section');
const savedDecksList    = document.getElementById('saved-decks-list');

// Tab DOM refs
const mainTabs         = document.getElementById('main-tabs');
const tabCards         = document.getElementById('tab-cards');
const tabAnalytics     = document.getElementById('tab-analytics');
const cardsPanel       = document.getElementById('cards-panel');
const analyticsPanel   = document.getElementById('analytics-panel');

// ── State ────────────────────────────────────────────────────────
let cardCache          = loadCardCache(); // Map<name, scryfallCard>
let currentParsed      = null;            // last successfully loaded parsed deck
let currentCloudDeckId = null;            // id of the currently loaded cloud deck
let activeTab          = 'cards';

// ── Auth initialisation ───────────────────────────────────────────
authSigninBtn?.addEventListener('click', () => signIn());
authSignoutBtn?.addEventListener('click', () => signOut());

onSessionChange(handleAuthStateChange);
initSession(); // async — fires onSessionChange when complete

async function handleAuthStateChange(session) {
  if (session?.user) {
    // Signed in
    if (authSigninBtn)  authSigninBtn.hidden  = true;
    if (authUserEmail) {
      authUserEmail.textContent = session.user.email ?? session.user.name ?? '';
      authUserEmail.hidden      = false;
    }
    if (authSignoutBtn) authSignoutBtn.hidden = false;
    if (cloudSaveRow)   cloudSaveRow.hidden   = false;
    if (savedDecksSection) savedDecksSection.hidden = false;
    await refreshSavedDecks();
  } else {
    // Signed out
    if (authSigninBtn)  authSigninBtn.hidden  = false;
    if (authUserEmail) {
      authUserEmail.textContent = '';
      authUserEmail.hidden      = true;
    }
    if (authSignoutBtn) authSignoutBtn.hidden = true;
    if (cloudSaveRow)   cloudSaveRow.hidden   = true;
    if (savedDecksSection) savedDecksSection.hidden = true;
    if (savedDecksList)  savedDecksList.textContent = '';
  }
}

async function refreshSavedDecks() {
  const decks = await listDecks();
  if (!decks || !savedDecksList) return;
  renderSavedDecks(savedDecksList, decks, handleLoadCloudDeck, handleDeleteCloudDeck);
}

async function handleLoadCloudDeck(deckId) {
  const deck = await loadCloudDeck(deckId);
  if (!deck) return;
  currentCloudDeckId = deckId;
  deckNameInput.value = deck.name ?? '';
  decklistTextarea.value = deck.text ?? '';
  deckNameDisplay.textContent = deck.name ?? '';
  saveDeck(deck.text ?? '', deck.name ?? '');
  await loadDeck();
}

async function handleDeleteCloudDeck(deckId) {
  if (!confirm('Delete this saved deck from the cloud?')) return;
  const ok = await deleteCloudDeck(deckId);
  if (ok) {
    if (currentCloudDeckId === deckId) currentCloudDeckId = null;
    await refreshSavedDecks();
  }
}

// ── Cloud save ────────────────────────────────────────────────────
saveDeckBtn?.addEventListener('click', async () => {
  const text = decklistTextarea.value.trim();
  const name = (deckNameInput.value.trim() || 'Untitled Deck');
  if (!text) {
    showSaveStatus('Nothing to save.', false);
    return;
  }

  saveDeckBtn.disabled = true;
  showSaveStatus('Saving…', null);

  try {
    if (currentCloudDeckId) {
      const updated = await updateCloudDeck(currentCloudDeckId, { name, text });
      if (updated) {
        showSaveStatus('Saved!', true);
      } else {
        // Deck may have been deleted — create a new one
        const created = await createCloudDeck(name, text);
        if (created) {
          currentCloudDeckId = created.id;
          showSaveStatus('Saved!', true);
        } else {
          showSaveStatus('Save failed.', false);
        }
      }
    } else {
      const created = await createCloudDeck(name, text);
      if (created) {
        currentCloudDeckId = created.id;
        showSaveStatus('Saved!', true);
      } else {
        showSaveStatus('Save failed.', false);
      }
    }
    await refreshSavedDecks();
  } finally {
    saveDeckBtn.disabled = false;
  }
});

function showSaveStatus(msg, ok) {
  if (!saveStatus) return;
  saveStatus.textContent = msg;
  saveStatus.className = ok === true  ? 'save-status save-status--ok'
                       : ok === false ? 'save-status save-status--err'
                       :                'save-status';
  saveStatus.hidden = false;
  if (ok !== null) {
    setTimeout(() => { saveStatus.hidden = true; }, 3000);
  }
}

// ── Tab switching ─────────────────────────────────────────────────
tabCards?.addEventListener('click', () => switchTab('cards'));
tabAnalytics?.addEventListener('click', () => switchTab('analytics'));

function switchTab(tab) {
  activeTab = tab;
  if (cardsPanel)    cardsPanel.hidden    = (tab !== 'cards');
  if (analyticsPanel) analyticsPanel.hidden = (tab !== 'analytics');
  tabCards?.classList.toggle('main-tab--active', tab === 'cards');
  tabAnalytics?.classList.toggle('main-tab--active', tab === 'analytics');
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

  // Save to localStorage immediately (deck text was already auto-saved, but
  // ensure name is persisted before the async work starts)
  saveDeck(text, deckNameInput.value);

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
  currentCloudDeckId = null;
  setUIState('empty');
  notFoundBanner.hidden = true;
  hideParseErrors();
  if (analyticsPanel) analyticsPanel.textContent = '';
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
