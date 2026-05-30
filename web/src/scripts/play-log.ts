// Played tab — chronological log of every game session at the show.
// Library entries flow in here automatically when marked Played; the user
// can also log plays directly (games from home, open gaming, etc).
//
// Same full-rebuild + defer-on-typing pattern as the Library tab.
import { store, type PlaySession } from './state';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayChip(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = DAY_LABEL[d.getDay()] || '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<span class="play-day">${day} ${time}</span>`;
}

function renderStars(rating: number | undefined): string {
  const r = rating || 0;
  let out = '<span class="play-stars" role="radiogroup" aria-label="Rating">';
  for (let i = 1; i <= 5; i++) {
    const on = i <= r;
    out += `<button type="button" class="play-star${on ? ' on' : ''}" data-action="set-rating" data-rating="${i}" role="radio" aria-checked="${on ? 'true' : 'false'}" aria-label="${i} star${i === 1 ? '' : 's'}" title="${i} / 5">${on ? '★' : '☆'}</button>`;
  }
  out += '</span>';
  return out;
}

function renderRow(s: PlaySession): string {
  const fromLib = s.libraryId
    ? `<span class="play-from-lib" title="Logged from your library list">from library</span>`
    : '';
  return `<li class="play-row" data-play-id="${esc(s.id)}">
    <div class="play-head">
      <input class="play-name" type="text" data-role="play-name" value="${esc(s.gameName)}" aria-label="Game name" />
      ${dayChip(s.playedAt)}
      ${fromLib}
      <button class="shopping-remove" data-action="remove-play" type="button" aria-label="Remove ${esc(s.gameName)}">×</button>
    </div>
    ${renderStars(s.rating)}
    <label class="play-field">
      <span class="play-field-label">Notes</span>
      <textarea data-role="play-notes" placeholder="Quick impressions, scores, would we buy it…">${esc(s.notes || '')}</textarea>
    </label>
  </li>`;
}

let rebuildPending = false;
function isTypingInPlayLog(root: HTMLElement): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !root.contains(a)) return false;
  const role = a.getAttribute('data-role');
  return role === 'play-name' || role === 'play-notes' || role === 'play-add-input';
}

export function buildPlayLog() {
  const root = document.getElementById('play-log');
  const tabBadge = document.querySelector<HTMLElement>('.tab[data-tab="played"] .badge');
  if (!root) return;
  if (isTypingInPlayLog(root)) {
    rebuildPending = true;
    return;
  }
  rebuildPending = false;

  const sessions = [...store.playLog].sort((a, b) => (b.playedAt || '').localeCompare(a.playedAt || ''));

  if (tabBadge) {
    if (sessions.length > 0) {
      tabBadge.textContent = String(sessions.length);
      tabBadge.classList.remove('hidden');
    } else {
      tabBadge.classList.add('hidden');
    }
  }

  const addForm = `<form class="lib-add" data-action="add-play">
    <input type="text" data-role="play-add-input" placeholder="Log a game you just played…" autocomplete="off" />
    <button type="submit" class="shopping-add-btn">+ Log</button>
  </form>`;

  if (sessions.length === 0) {
    root.innerHTML = `${addForm}<div class="route-empty">No plays logged yet. Tick a game off in the <strong>Library</strong> tab, or add one here directly.</div>`;
    return;
  }

  root.innerHTML = `${addForm}<p class="shop-summary"><strong>${sessions.length}</strong> session${sessions.length === 1 ? '' : 's'} logged</p><ul class="play-list">${sessions.map(renderRow).join('')}</ul>`;
}

export function wirePlayLog() {
  const panel = document.querySelector<HTMLElement>('.panel[data-panel="played"]');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.closest<HTMLElement>('[data-play-id]')?.dataset.playId;
    if (action === 'remove-play' && id) {
      store.removePlaySession(id);
    } else if (action === 'set-rating' && id) {
      // Re-tapping the current rating clears it back to unrated — same as the
      // booth visit-status cycle, lets the user undo without a separate button.
      const next = parseInt(btn.dataset.rating || '0', 10);
      const cur = store.playLog.find((s) => s.id === id)?.rating || 0;
      store.updatePlaySession(id, { rating: next === cur ? undefined : next });
    }
  });

  panel.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!form?.dataset || form.dataset.action !== 'add-play') return;
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('[data-role="play-add-input"]');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    store.addPlaySession(val);
    input.value = '';
    input.focus();
  });

  // Save the editable fields on blur so the re-render doesn't drop focus.
  // play-name renames the session in-place; empty input is treated as a
  // remove so the user can clear a stray entry without hunting for the × .
  panel.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    const role = t?.dataset?.role;
    if (role !== 'play-name' && role !== 'play-notes') return;
    const id = t.closest<HTMLElement>('[data-play-id]')?.dataset.playId;
    if (!id) return;
    if (role === 'play-name') {
      const next = t.value.trim();
      if (!next) {
        store.removePlaySession(id);
        return;
      }
      store.updatePlaySession(id, { gameName: next });
    } else {
      store.updatePlaySession(id, { notes: t.value });
    }
  });

  // Mirror of the route/library defer fix.
  panel.addEventListener(
    'blur',
    (e) => {
      const t = e.target as HTMLElement | null;
      const role = t?.getAttribute('data-role');
      if (role !== 'play-name' && role !== 'play-notes' && role !== 'play-add-input') return;
      if (rebuildPending) buildPlayLog();
    },
    true,
  );

  store.subscribe(buildPlayLog);
  buildPlayLog();
}
