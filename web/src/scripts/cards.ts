// Wire up every card's booth-tools UI (visit / buy / skip / day / notes)
// to the central state store.
import { store, type BoothEntry } from './state';

function syncCard(card: HTMLElement, e: BoothEntry) {
  const status = e.status;
  card.classList.toggle('visited', status === 'visited');
  card.classList.toggle('revisit', status === 'revisit');
  card.classList.toggle('skipped', !!e.skipped);
  card.classList.toggle('buying', !!e.buy);
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
  for (const chip of card.querySelectorAll<HTMLButtonElement>('.day-chip')) {
    chip.classList.toggle('active', chip.dataset.day === e.day);
  }
  const notesBtn = card.querySelector<HTMLButtonElement>('[data-action="toggle-notes"]');
  if (notesBtn) notesBtn.classList.toggle('has-notes', !!(e.notes && e.notes.trim()));
  const notesText = card.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]');
  if (notesText && notesText.value !== (e.notes || '')) notesText.value = e.notes || '';
}

export function wireAllCards() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.card[data-slug]'));

  function syncAll() {
    for (const card of cards) syncCard(card, store.get(card.dataset.slug!));
  }

  for (const card of cards) {
    const slug = card.dataset.slug!;
    syncCard(card, store.get(slug));

    card.querySelector('[data-action="toggle-visit"]')?.addEventListener('click', () => {
      store.cycleVisit(slug);
    });
    card.querySelector('[data-action="toggle-buy"]')?.addEventListener('click', () => {
      store.toggleBuy(slug);
    });
    card.querySelector('[data-action="toggle-skip"]')?.addEventListener('click', () => {
      store.toggleSkip(slug);
    });
    card.querySelector('[data-action="toggle-notes"]')?.addEventListener('click', () => {
      const area = card.querySelector<HTMLElement>('[data-role="notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.focus();
      }
    });
    for (const chip of card.querySelectorAll<HTMLButtonElement>('.day-chip')) {
      chip.addEventListener('click', () => {
        const day = chip.dataset.day as 'fri' | 'sat' | 'sun';
        store.setDay(slug, day);
      });
    }
    let notesTimer: ReturnType<typeof setTimeout> | null = null;
    card.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.addEventListener('input', (e) => {
      const val = (e.target as HTMLTextAreaElement).value;
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(() => store.setNotes(slug, val), 250);
    });
  }

  store.subscribe(syncAll);
}
