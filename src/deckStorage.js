/**
 * deckStorage.js
 *
 * Persists the user's deck (raw text + name) to localStorage so it survives
 * page reloads — analogous to a shopping-cart pattern.
 *
 * Card data fetched from Scryfall is cached separately in sessionStorage so
 * that a full reload re-fetches only if the session is new, but navigating
 * within the app is instant.
 */

const DECK_TEXT_KEY  = 'mtg_deck_text';
const DECK_NAME_KEY  = 'mtg_deck_name';
const CARD_CACHE_KEY = 'mtg_card_cache';

// ── Deck text / name ────────────────────────────────────────────

/** Save the raw decklist string and an optional deck name. */
export function saveDeck(text, name = '') {
  try {
    localStorage.setItem(DECK_TEXT_KEY, text);
    localStorage.setItem(DECK_NAME_KEY, name);
  } catch (e) {
    // localStorage can throw when in private mode or when storage is full
    console.warn('deckStorage: could not save deck', e);
  }
}

/** Load the persisted decklist text. Returns '' if nothing saved. */
export function loadDeckText() {
  try {
    return localStorage.getItem(DECK_TEXT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Load the persisted deck name. Returns '' if nothing saved. */
export function loadDeckName() {
  try {
    return localStorage.getItem(DECK_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Wipe the stored deck and card cache entirely. */
export function clearDeck() {
  try {
    localStorage.removeItem(DECK_TEXT_KEY);
    localStorage.removeItem(DECK_NAME_KEY);
    sessionStorage.removeItem(CARD_CACHE_KEY);
  } catch {
    // ignore
  }
}

// ── Card data cache (sessionStorage) ────────────────────────────
// Scryfall card objects can be large; we keep them for the session to avoid
// re-fetching on soft navigations or re-renders, but let a full session reset
// pull fresh data (card text and legality can change with rule updates).

/** Persist a map of cardName → scryfallCardObject for this session. */
export function saveCardCache(cardMap) {
  try {
    // Convert Map to plain object for JSON serialisation
    const obj = {};
    for (const [name, card] of cardMap) {
      obj[name] = card;
    }
    sessionStorage.setItem(CARD_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('deckStorage: could not save card cache', e);
  }
}

/**
 * Load the session card cache.
 * @returns {Map<string, object>} name → card object (may be empty)
 */
export function loadCardCache() {
  try {
    const raw = sessionStorage.getItem(CARD_CACHE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}
