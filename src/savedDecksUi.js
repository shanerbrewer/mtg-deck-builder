/**
 * savedDecksUi.js
 *
 * Renders the list of saved cloud decks in the sidebar.
 * Security: all dynamic data set via textContent — no innerHTML with user data.
 */

/**
 * Render the saved decks list into containerEl.
 *
 * @param {HTMLElement} containerEl     — the #saved-decks-list element
 * @param {Array<{id:string, name:string, updatedAt:string}>} decks
 * @param {(id: string) => void} onLoad   — called when user clicks Load
 * @param {(id: string) => void} onDelete — called when user clicks Delete
 */
export function renderSavedDecks(containerEl, decks, onLoad, onDelete) {
  containerEl.textContent = ''; // safe clear

  if (decks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'saved-decks-empty';
    empty.textContent = 'No saved decks yet.';
    containerEl.appendChild(empty);
    return;
  }

  for (const deck of decks) {
    const item = document.createElement('div');
    item.className = 'saved-deck-item';
    item.dataset.id = deck.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'saved-deck-name';
    nameEl.textContent = deck.name || 'Untitled';
    nameEl.title = formatDate(deck.updatedAt);
    item.appendChild(nameEl);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn saved-deck-load';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => onLoad(deck.id));
    item.appendChild(loadBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost saved-deck-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete from cloud';
    delBtn.addEventListener('click', () => onDelete(deck.id));
    item.appendChild(delBtn);

    containerEl.appendChild(item);
  }
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}
