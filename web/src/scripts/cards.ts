// Wire up every card's booth-tools UI (visit / buy / skip / day / notes)
// to the central state store.
import { store, type BoothEntry } from './state';

const PLAN_LABEL: Record<string, string> = {
  any: 'Planned · Any day',
  fri: '🗓 Friday',
  sat: '🗓 Saturday',
  sun: '🗓 Sunday',
};

function syncCard(card: HTMLElement, e: BoothEntry) {
  const status = e.status;
  card.classList.toggle('visited', status === 'visited');
  card.classList.toggle('revisit', status === 'revisit');
  card.classList.toggle('skipped', !!e.skipped);
  card.classList.toggle('buying', !!e.buy);
  card.classList.toggle('planned', !!e.day);
  card.dataset.status = status ?? '';
  card.dataset.skipped = e.skipped ? '1' : '0';
  card.dataset.buy = e.buy ? '1' : '0';
  card.dataset.day = e.day ?? '';

  const v = card.querySelector<HTMLButtonElement>('[data-action="toggle-visit"]');
  if (v) {
    v.textContent =
      status === 'revisit' ? '★ Visit again' : status === 'visited' ? '✓ Visited' : 'Mark as visited';
    v.classList.toggle('visited', status === 'visited');
    v.classList.toggle('revisit', status === 'revisit');
  }
  const b = card.querySelector<HTMLButtonElement>('[data-action="toggle-buy"]');
  if (b) {
    b.textContent = e.buy ? '🛒 Buying' : '🛒 Buy';
    b.classList.toggle('on', !!e.buy);
  }
  const s = card.querySelector<HTMLButtonElement>('[data-action="toggle-skip"]');
  if (s) {
    s.textContent = e.skipped ? 'Skipped' : 'Skip';
    s.classList.toggle('on', !!e.skipped);
  }
  const p = card.querySelector<HTMLButtonElement>('[data-action="cycle-plan"]');
  if (p) {
    p.textContent = e.day ? PLAN_LABEL[e.day] : '+ Add to plan';
    p.classList.toggle('on', !!e.day);
    p.classList.toggle('plan-any', e.day === 'any');
    p.classList.toggle('plan-fri', e.day === 'fri');
    p.classList.toggle('plan-sat', e.day === 'sat');
    p.classList.toggle('plan-sun', e.day === 'sun');
  }
  const notesBtn = card.querySelector<HTMLButtonElement>('[data-action="toggle-notes"]');
  if (notesBtn) notesBtn.classList.toggle('has-notes', !!(e.notes && e.notes.trim()));
  const notesText = card.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]');
  if (notesText && notesText.value !== (e.notes || '')) notesText.value = e.notes || '';
}

export function wireAllCards() {
  // Initial sync of every card already in the DOM.
  function syncAll() {
    for (const card of document.querySelectorAll<HTMLElement>('.card[data-slug]')) {
      syncCard(card, store.get(card.dataset.slug!));
    }
  }
  syncAll();
  store.subscribe(syncAll);

  // Event delegation — handles clicks on ANY card with [data-slug], including
  // cards cloned into the search-results panel. Listeners are attached once
  // to document, so clones work without re-wiring.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const card = btn.closest<HTMLElement>('.card[data-slug]');
    if (!card) return;
    // Don't intercept buttons inside the route plan — that view has its own
    // delegation (we don't want both to fire).
    if (btn.closest('#route-plan')) return;
    const slug = card.dataset.slug!;
    const action = btn.dataset.action;
    if (action === 'cycle-plan') store.cyclePlan(slug);
    else if (action === 'toggle-visit') store.cycleVisit(slug);
    else if (action === 'toggle-buy') store.toggleBuy(slug);
    else if (action === 'toggle-skip') store.toggleSkip(slug);
    else if (action === 'toggle-notes') {
      const area = card.querySelector<HTMLElement>('[data-role="notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.focus();
      }
    }
  });

  // Notes input delegation (also works on clones).
  const notesDebouncers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();
  document.addEventListener('input', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta?.dataset || ta.dataset.role !== 'notes-text') return;
    if (ta.closest('#route-plan')) return; // route has its own handler
    const card = ta.closest<HTMLElement>('.card[data-slug]');
    if (!card) return;
    const slug = card.dataset.slug!;
    const prev = notesDebouncers.get(ta);
    if (prev) clearTimeout(prev);
    notesDebouncers.set(
      ta,
      setTimeout(() => store.setNotes(slug, ta.value), 250)
    );
  });
}
