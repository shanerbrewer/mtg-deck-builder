/**
 * cloudStorage.js
 *
 * Client-side wrapper for the /api/decks/* endpoints.
 * All functions return null / empty array on failure rather than throwing,
 * so callers can fall back gracefully.
 */

/** @returns {Promise<Array<{id, name, updatedAt}>>} */
export async function listDecks() {
  try {
    const res = await fetch('/api/decks');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Fetch a single deck's full text.
 * @returns {Promise<{id, name, text, updatedAt}|null>}
 */
export async function loadCloudDeck(id) {
  try {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Create a new cloud deck.
 * @param {string} name
 * @param {string} text
 * @returns {Promise<{id, name, updatedAt}|null>}
 */
export async function createCloudDeck(name, text) {
  try {
    const res = await fetch('/api/decks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, text }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Update an existing cloud deck.
 * @param {string} id
 * @param {{ name?: string, text?: string }} updates
 * @returns {Promise<{id, name, text, updatedAt}|null>}
 */
export async function updateCloudDeck(id, updates) {
  try {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Delete a cloud deck.
 * @param {string} id
 * @returns {Promise<boolean>} true on success
 */
export async function deleteCloudDeck(id) {
  try {
    const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}
