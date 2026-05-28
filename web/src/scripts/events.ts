// Events tab — filters the server-rendered event-card list by category
// (panel-local pill row) and day (the existing global day pill in the
// sticky filter bar). All cards are present in the DOM; we just toggle
// .hidden based on the active filters.
//
// Also owns the "Going" toggle + notes per event. Clicks delegated from
// document so any cloned event card (search results, future modal) keeps
// working. Notes input is debounced.
import { store } from './state';

type DayCode = 'any' | 'fri' | 'sat' | 'sun';

const state = {
  category: 'all' as string,
  day: 'any' as DayCode,
};

function readGlobalDay(): DayCode {
  return ((document.querySelector<HTMLButtonElement>('.day-pill.active')?.dataset.day) || 'any') as DayCode;
}

function passes(card: HTMLElement): boolean {
  if (state.category !== 'all' && card.dataset.category !== state.category) return false;
  if (state.day !== 'any') {
    const days = (card.dataset.days || '').split(/\s+/);
    if (!days.includes(state.day)) return false;
  }
  return true;
}

function apply() {
  const grid = document.getElementById('event-grid');
  const empty = document.getElementById('event-empty');
  if (!grid) return;
  let shown = 0;
  for (const card of grid.querySelectorAll<HTMLElement>('.event-card')) {
    const ok = passes(card);
    card.classList.toggle('hidden', !ok);
    if (ok) shown++;
  }
  empty?.classList.toggle('hidden', shown > 0);

  // Reflect per-pill counts for the active day so the user sees how many
  // events each category has under the current day filter.
  const counts: Record<string, number> = {};
  let total = 0;
  for (const card of grid.querySelectorAll<HTMLElement>('.event-card')) {
    const days = (card.dataset.days || '').split(/\s+/);
    if (state.day !== 'any' && !days.includes(state.day)) continue;
    const c = card.dataset.category || 'Other';
    counts[c] = (counts[c] || 0) + 1;
    total++;
  }
  const row = document.getElementById('event-cat-row');
  if (!row) return;
  for (const pill of row.querySelectorAll<HTMLElement>('.cat-pill')) {
    const cat = pill.dataset.cat;
    const countEl = pill.querySelector<HTMLElement>('.event-cat-count');
    if (!countEl) continue;
    if (cat === 'all') countEl.textContent = String(total);
    else countEl.textContent = String(counts[cat!] || 0);
  }
}

function syncEventCard(card: HTMLElement) {
  const id = card.dataset.eventId;
  if (!id) return;
  // The route panel renders its own pinned-event rows with different
  // controls — let it own its DOM end-to-end.
  if (card.closest('#route-plan')) return;
  const e = store.getEvent(id);
  card.classList.toggle('attending', !!e.attending);
  const btn = card.querySelector<HTMLButtonElement>('[data-action="toggle-attending"]');
  if (btn) {
    btn.textContent = e.attending ? '✓ Going' : 'Going';
    btn.classList.toggle('on', !!e.attending);
  }
  const notesBtn = card.querySelector<HTMLButtonElement>('[data-action="toggle-event-notes"]');
  if (notesBtn) notesBtn.classList.toggle('has-notes', !!(e.notes && e.notes.trim()));
  const ta = card.querySelector<HTMLTextAreaElement>('[data-role="event-notes-text"]');
  if (ta && ta.value !== (e.notes || '')) ta.value = e.notes || '';
}

function syncAllEventCards() {
  for (const card of document.querySelectorAll<HTMLElement>('[data-event-id]')) {
    syncEventCard(card);
  }
}

export function wireEvents() {
  const row = document.getElementById('event-cat-row');
  if (!row) return;

  row.addEventListener('click', (e) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>('.cat-pill');
    if (!pill) return;
    state.category = pill.dataset.cat || 'all';
    for (const p of row.querySelectorAll<HTMLElement>('.cat-pill')) {
      p.classList.toggle('active', p === pill);
    }
    apply();
  });

  // Mirror the global day filter — re-read after each click; pill state has
  // already updated by the time the handler fires.
  for (const pill of document.querySelectorAll<HTMLButtonElement>('.day-pill')) {
    pill.addEventListener('click', () => {
      state.day = readGlobalDay();
      apply();
    });
  }

  // Per-event actions: Going toggle + Notes toggle, delegated from document
  // so cloned cards (search results, route render) also work.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const card = btn.closest<HTMLElement>('[data-event-id]');
    if (!card) return;
    const id = card.dataset.eventId!;
    const action = btn.dataset.action;
    if (action === 'toggle-attending') {
      store.toggleAttending(id);
    } else if (action === 'toggle-event-notes') {
      const area = card.querySelector<HTMLElement>('[data-role="event-notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="event-notes-text"]')?.focus();
      }
    }
  });

  const notesTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();
  document.addEventListener('input', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta?.dataset || ta.dataset.role !== 'event-notes-text') return;
    const card = ta.closest<HTMLElement>('[data-event-id]');
    if (!card) return;
    const id = card.dataset.eventId!;
    const prev = notesTimers.get(ta);
    if (prev) clearTimeout(prev);
    notesTimers.set(
      ta,
      setTimeout(() => store.setEventNotes(id, ta.value), 250)
    );
  });

  syncAllEventCards();
  store.subscribe(syncAllEventCards);

  state.day = readGlobalDay();
  apply();
}
