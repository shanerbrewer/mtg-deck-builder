/**
 * cloudStorage.js
 *
 * Thin fetch wrappers around the /api/decks/* endpoints.
 * All functions return plain objects or throw on HTTP errors.
 */

/** @returns {Promise<{id:string, name:string, updatedAt:string}[]>} */
export async function listDecks() {
  const res = await fetch('/api/decks', { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to list decks (${res.status})`);
  return res.json();
}

/**
 * Load a single deck's full text.
 * @param {string} id
 * @returns {Promise<{id:string, name:string, text:string, updatedAt:string}>}
 */
export async function loadCloudDeck(id) {
  const res = await fetch(`/api/decks/${id}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to load deck (${res.status})`);
  return res.json();
}

/**
 * Create a new cloud deck.
 * @param {string} name
 * @param {string} text
 * @returns {Promise<{id:string, name:string, updatedAt:string}>}
 */
export async function createCloudDeck(name, text) {
  const res = await fetch('/api/decks', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, text }),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to save deck (${res.status})`);
  }
  return res.json();
}

/**
 * Update an existing cloud deck.
 * @param {string} id
 * @param {{ name?: string, text?: string }} updates
 * @returns {Promise<{id:string, name:string, updatedAt:string}>}
 */
export async function updateCloudDeck(id, updates) {
  const res = await fetch(`/api/decks/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(updates),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to update deck (${res.status})`);
  }
  return res.json();
}

/**
 * Delete a cloud deck.
 * @param {string} id
 */
export async function deleteCloudDeck(id) {
  const res = await fetch(`/api/decks/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to delete deck (${res.status})`);
}
