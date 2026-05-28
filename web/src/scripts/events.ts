// Events tab — filters the server-rendered event-card list by category
// (panel-local pill row) and day (the existing global day pill in the
// sticky filter bar). All cards are present in the DOM; we just toggle
// .hidden based on the active filters.

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

  state.day = readGlobalDay();
  apply();
}
