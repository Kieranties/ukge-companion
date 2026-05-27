// Visibility filter: status pill + day pill + hide-skipped toggle + active tag.
// Works against any .card[data-slug] in the DOM, regardless of which tab.
import { store } from './state';
import { cardMatchesActiveTag, onTagChange } from './tags';

type StatusFilter = 'all' | 'unvisited' | 'visited' | 'revisit' | 'buy';
type DayFilter = 'any' | 'fri' | 'sat' | 'sun';

interface FilterState {
  status: StatusFilter;
  day: DayFilter;
  hideSkipped: boolean;
}

const filterState: FilterState = {
  status: 'all',
  day: 'any',
  hideSkipped: true,
};

function passes(card: HTMLElement): boolean {
  const e = store.get(card.dataset.slug!);
  if (filterState.hideSkipped && e.skipped) return false;
  if (filterState.status === 'unvisited' && (e.status || e.buy)) return false;
  if (filterState.status === 'visited' && e.status !== 'visited') return false;
  if (filterState.status === 'revisit' && e.status !== 'revisit') return false;
  if (filterState.status === 'buy' && !e.buy) return false;
  // Day filter on cards: 'any' shows everything; a specific day shows
  // only stands assigned to that day OR planned 'any day'.
  if (filterState.day !== 'any') {
    if (e.day !== filterState.day && e.day !== 'any') return false;
  }
  if (!cardMatchesActiveTag(card)) return false;
  return true;
}

export function applyFilters() {
  for (const card of document.querySelectorAll<HTMLElement>('.card[data-slug]')) {
    card.classList.toggle('hidden', !passes(card));
  }
}

export function wireFilters() {
  const statusPills = Array.from(document.querySelectorAll<HTMLButtonElement>('.status-pill'));
  for (const pill of statusPills) {
    pill.addEventListener('click', () => {
      filterState.status = (pill.dataset.status as StatusFilter) || 'all';
      for (const p of statusPills) p.classList.toggle('active', p === pill);
      applyFilters();
    });
  }
  const dayPills = Array.from(document.querySelectorAll<HTMLButtonElement>('.day-pill'));
  for (const pill of dayPills) {
    pill.addEventListener('click', () => {
      filterState.day = (pill.dataset.day as DayFilter) || 'any';
      for (const p of dayPills) p.classList.toggle('active', p === pill);
      applyFilters();
    });
  }
  const skip = document.getElementById('hide-skipped');
  skip?.addEventListener('click', () => {
    filterState.hideSkipped = !filterState.hideSkipped;
    skip.classList.toggle('active', filterState.hideSkipped);
    applyFilters();
  });
  skip?.classList.add('active'); // default on

  // Re-apply when state changes so visited/buy toggles update visibility.
  store.subscribe(applyFilters);
  onTagChange(applyFilters);
  applyFilters();
}
