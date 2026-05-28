// Events tab — filters the server-rendered event-card list by category
// (panel-local pill row) and day (the existing global day pill in the
// sticky filter bar). All cards are present in the DOM; we just toggle
// .hidden based on the active filters.
//
// Also owns the "Going" toggle + notes per event. Clicks delegated from
// document so any cloned event card (search results, future modal) keeps
// working. Notes input is debounced.
import { store } from './state';
import { openPopover, closePopover } from './popover';

type DayCode = 'any' | 'fri' | 'sat' | 'sun';

const DAY_FULL: Record<string, string> = { fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DAY_SHORT: Record<string, string> = { fri: 'Fri', sat: 'Sat', sun: 'Sun' };

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

function eventDaysOf(card: HTMLElement): string[] {
  return (card.dataset.days || '').split(/\s+/).filter(Boolean);
}

function goingLabel(id: string, allDays: string[]): { text: string; on: boolean } {
  const going = allDays.filter((d) => store.isAttendingDay(id, d));
  if (going.length === 0) return { text: 'Going', on: false };
  if (allDays.length === 1) return { text: '✓ Going', on: true };
  if (going.length === allDays.length) return { text: `✓ Going (${going.length} days)`, on: true };
  return { text: `✓ ${going.map((d) => DAY_SHORT[d] || d).join(', ')}`, on: true };
}

function syncEventCard(card: HTMLElement) {
  const id = card.dataset.eventId;
  if (!id) return;
  // The route panel renders its own pinned-event rows with different
  // controls — let it own its DOM end-to-end.
  if (card.closest('#route-plan')) return;
  const e = store.getEvent(id);
  const allDays = eventDaysOf(card);
  const { text, on } = goingLabel(id, allDays);
  card.classList.toggle('attending', on);
  const btn = card.querySelector<HTMLButtonElement>('[data-action="open-going-picker"]');
  if (btn) {
    btn.textContent = text;
    btn.classList.toggle('on', on);
  }
  const notesBtn = card.querySelector<HTMLButtonElement>('[data-action="toggle-event-notes"]');
  if (notesBtn) notesBtn.classList.toggle('has-notes', !!(e.notes && e.notes.trim()));
  const ta = card.querySelector<HTMLTextAreaElement>('[data-role="event-notes-text"]');
  if (ta && ta.value !== (e.notes || '')) ta.value = e.notes || '';
}

/** Open the day-picker popover for an event. Reused from EventCard and
 *  the route's pinned-event row, so the same control is reachable in both
 *  places. */
function openGoingPicker(trigger: HTMLElement, id: string, allDays: string[]) {
  const anyAttending = store.isAttendingAny(id);
  openPopover({
    trigger,
    title: allDays.length > 1 ? 'Going on…' : undefined,
    mode: 'multi',
    options: allDays.map((d) => ({
      label: DAY_FULL[d] || d,
      value: d,
      selected: store.isAttendingDay(id, d),
    })),
    removeLabel: anyAttending ? 'Not going' : undefined,
    onSelect: (val) => {
      if (val === null) {
        for (const d of allDays) {
          if (store.isAttendingDay(id, d)) store.toggleAttendingDay(id, d, allDays);
        }
      } else {
        store.toggleAttendingDay(id, val, allDays);
      }
    },
  });
}

export { openGoingPicker };

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
    if (action === 'open-going-picker') {
      const allDays = eventDaysOf(card);
      if (allDays.length === 0) return;
      openGoingPicker(btn, id, allDays);
    } else if (action === 'toggle-attending-day') {
      // Used by the route's per-day ✕ button — flip just that day directly.
      const day = btn.dataset.day || '';
      const allDays = eventDaysOf(card);
      if (day) store.toggleAttendingDay(id, day, allDays);
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
