/**
 * savedDecksUi.js
 *
 * Renders the signed-in user's saved decks list in the sidebar.
 * All content is set via textContent — no innerHTML with dynamic data.
 */

/**
 * @param {HTMLElement} listEl         The #saved-decks-list container
 * @param {Array<{id,name,updatedAt}>} decks
 * @param {(id: string) => void}        onLoad
 * @param {(id: string) => void}        onDelete
 */
export function renderSavedDecks(listEl, decks, onLoad, onDelete) {
  listEl.textContent = ''; // clear existing children

  if (decks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-decks-empty';
    empty.textContent = 'No saved decks yet.';
    listEl.appendChild(empty);
    return;
  }

  for (const deck of decks) {
    const item = buildDeckItem(deck, onLoad, onDelete);
    listEl.appendChild(item);
  }
}

function buildDeckItem(deck, onLoad, onDelete) {
  const item = document.createElement('div');
  item.className = 'saved-deck-item';
  item.dataset.deckId = deck.id;

  const nameEl = document.createElement('span');
  nameEl.className = 'saved-deck-name';
  nameEl.textContent = deck.name;
  nameEl.title       = deck.name;
  item.appendChild(nameEl);

  const loadBtn = document.createElement('button');
  loadBtn.className   = 'btn btn-ghost btn-sm saved-deck-load';
  loadBtn.textContent = 'Load';
  loadBtn.title       = `Load "${deck.name}"`;
  loadBtn.addEventListener('click', () => onLoad(deck.id));
  item.appendChild(loadBtn);

  const delBtn = document.createElement('button');
  delBtn.className   = 'btn btn-ghost btn-sm saved-deck-delete';
  delBtn.textContent = '✕';
  delBtn.title       = `Delete "${deck.name}"`;
  delBtn.addEventListener('click', () => onDelete(deck.id));
  item.appendChild(delBtn);

  return item;
}
