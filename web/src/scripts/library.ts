// Library tab — a personal "games to play" list for the UKGE Board Game
// Library (1500+ titles, no public catalogue, so this is free-text only).
// Two states per entry: To play / Played, plus optional notes.
//
// Rendering mirrors shopping.ts: full re-render on every state change,
// cheap because the list is small (handful to a few dozen entries).
//
// One caveat carried over from the route panel: a wholesale innerHTML
// rebuild while the user is mid-keystroke in a notes textarea drops
// focus and Android dismisses the soft keyboard. We borrow the same
// defer-while-focused trick — skip the rebuild until blur.
import { store, type LibraryEntry } from './state';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderRow(g: LibraryEntry): string {
  const played = !!g.played;
  const hasNotes = !!(g.notes && g.notes.trim());
  return `<li class="lib-row${played ? ' played' : ''}" data-lib-id="${esc(g.id)}">
    <button class="shopping-check" data-action="toggle-played-lib" type="button" aria-label="${played ? 'Mark as not played' : 'Mark as played'}">${played ? '✓' : ''}</button>
    <span class="lib-name">${esc(g.name)}</span>
    <span class="lib-actions">
      <button class="booth-btn notes-toggle${hasNotes ? ' has-notes' : ''}" data-action="toggle-lib-notes" type="button" title="Notes">✎</button>
      <button class="shopping-remove" data-action="remove-lib" type="button" aria-label="Remove ${esc(g.name)}">×</button>
    </span>
    <div class="notes-area${hasNotes ? '' : ' hidden'}" data-role="lib-notes">
      <textarea data-role="lib-notes-text" placeholder="Notes — saved on this device only">${esc(g.notes || '')}</textarea>
    </div>
  </li>`;
}

let rebuildPending = false;

function isTypingInLibraryNotes(root: HTMLElement): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) return false;
  return a.getAttribute('data-role') === 'lib-notes-text';
}

export function buildLibrary() {
  const root = document.getElementById('library-list');
  const tabBadge = document.querySelector<HTMLElement>('.tab[data-tab="library"] .badge');
  if (!root) return;
  if (isTypingInLibraryNotes(root)) {
    rebuildPending = true;
    return;
  }
  rebuildPending = false;

  const all = store.library;
  const toPlay = all.filter((g) => !g.played);
  const played = all.filter((g) => g.played);

  if (tabBadge) {
    if (toPlay.length > 0) {
      tabBadge.textContent = String(toPlay.length);
      tabBadge.classList.remove('hidden');
    } else {
      tabBadge.classList.add('hidden');
    }
  }

  const addForm = `<form class="lib-add" data-action="add-lib-game">
    <input type="text" data-role="lib-add-input" placeholder="Add a game to look up in the library…" autocomplete="off" />
    <button type="submit" class="shopping-add-btn">+ Add</button>
  </form>`;

  if (all.length === 0) {
    root.innerHTML = `${addForm}<div class="route-empty">Your library list is empty. Add games you'd like to borrow — when you're at the library counter you can scan the list together.</div>`;
    return;
  }

  let html = `${addForm}<p class="shop-summary"><strong>${toPlay.length}</strong> to play · <strong>${played.length}</strong> played</p>`;
  if (toPlay.length > 0) {
    html += `<section class="lib-section"><h3 class="lib-section-head">To play</h3><ul class="lib-list">${toPlay.map(renderRow).join('')}</ul></section>`;
  }
  if (played.length > 0) {
    html += `<details class="lib-section lib-section-played"${toPlay.length === 0 ? ' open' : ''}><summary><span class="lib-section-head">Played (${played.length})</span></summary><ul class="lib-list">${played.map(renderRow).join('')}</ul></details>`;
  }
  root.innerHTML = html;
}

export function wireLibrary() {
  const panel = document.querySelector<HTMLElement>('.panel[data-panel="library"]');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'toggle-lib-notes') {
      const row = btn.closest<HTMLElement>('[data-lib-id]');
      const area = row?.querySelector<HTMLElement>('[data-role="lib-notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="lib-notes-text"]')?.focus();
      }
      return;
    }
    const id = btn.closest<HTMLElement>('[data-lib-id]')?.dataset.libId;
    if (!id) return;
    if (action === 'toggle-played-lib') store.togglePlayedLibrary(id);
    else if (action === 'remove-lib') store.removeLibraryGame(id);
  });

  panel.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!form?.dataset || form.dataset.action !== 'add-lib-game') return;
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('[data-role="lib-add-input"]');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    store.addLibraryGame(val);
    input.value = '';
    input.focus();
  });

  // Notes save on blur (`change`) so the re-render only fires once the
  // user has left the field — no focus-shift, no dismissed keyboard.
  panel.addEventListener('change', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta?.dataset || ta.dataset.role !== 'lib-notes-text') return;
    const id = ta.closest<HTMLElement>('[data-lib-id]')?.dataset.libId;
    if (!id) return;
    store.setLibraryNotes(id, ta.value);
  });

  // Defer-on-focus mirror of the route fix: if a sync arrived while the
  // user was typing, run it the moment they blur the field.
  panel.addEventListener(
    'blur',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.getAttribute('data-role') !== 'lib-notes-text') return;
      if (rebuildPending) buildLibrary();
    },
    true,
  );

  store.subscribe(buildLibrary);
  buildLibrary();
}
