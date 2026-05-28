// Multi-facet filter state. Each facet (category / publisher / game / hall /
// award) can have any number of selected values:
//
//   - within a facet: OR  (Fantasy OR Co-op)
//   - across facets:  AND (Category AND Publisher AND Hall …)
//
// Filters can be added from three places:
//   1. Tag chips on cards — additive: click adds, click same chip again removes
//   2. The Filters panel (filters-panel.ts) — checkbox per value
//   3. Search autocomplete suggestions — "+ FILTER" rows
//
// Cards expose the values they hold as pipe-separated data-* attributes:
//   category  → card.dataset.tagCategories
//   publisher → card.dataset.tagPublishers
//   game      → card.dataset.tagGames        (user's collection)
//   ukge-game → card.dataset.tagUkgeGames    (games the exhibitor lists)
//   hall      → card.dataset.hall            (single value, not pipe-separated)
//   award     → card.dataset.award           (single value, normalized)
import { applyFilters } from './filters';

export type FacetKey = 'category' | 'publisher' | 'game' | 'ukge-game' | 'hall' | 'award';

const FACET_LABELS: Record<FacetKey, string> = {
  category: 'Category',
  publisher: 'Publisher',
  game: 'Game',
  'ukge-game': 'UKGE-listed game',
  hall: 'Hall',
  award: 'Award',
};

const FACET_ATTRS: Record<FacetKey, string> = {
  category: 'tagCategories',
  publisher: 'tagPublishers',
  game: 'tagGames',
  'ukge-game': 'tagUkgeGames',
  hall: 'hall',
  award: 'award',
};

// Each facet → set of selected values. An empty set is removed entirely so
// `.size` accurately reflects "any active facets at all".
const filters: Map<FacetKey, Set<string>> = new Map();
const listeners = new Set<() => void>();

export function getActiveFilters(): Map<FacetKey, Set<string>> {
  return filters;
}

export function hasFilter(facet: FacetKey, value: string): boolean {
  return filters.get(facet)?.has(value) ?? false;
}

export function totalActiveFilters(): number {
  let n = 0;
  for (const set of filters.values()) n += set.size;
  return n;
}

export function addFilter(facet: FacetKey, value: string): void {
  if (!filters.has(facet)) filters.set(facet, new Set());
  filters.get(facet)!.add(value);
  notify();
}

export function removeFilter(facet: FacetKey, value: string): void {
  const set = filters.get(facet);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) filters.delete(facet);
  notify();
}

export function toggleFilter(facet: FacetKey, value: string): void {
  if (hasFilter(facet, value)) removeFilter(facet, value);
  else addFilter(facet, value);
}

export function clearFilters(): void {
  filters.clear();
  notify();
}

export function onTagChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  renderActiveBar();
  for (const fn of listeners) fn();
  applyFilters();
}

function renderActiveBar() {
  const bar = document.getElementById('active-tag-bar');
  if (!bar) return;
  if (filters.size === 0) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  const chips: string[] = [];
  for (const [facet, values] of filters) {
    for (const value of values) {
      chips.push(
        `<button class="active-chip" type="button" data-facet="${facet}" data-value="${escapeAttr(value)}" aria-label="Remove filter ${FACET_LABELS[facet]}: ${escapeAttr(value)}">` +
          `<span class="active-chip-facet">${FACET_LABELS[facet]}:</span> ` +
          `<span class="active-chip-value">${escapeHtml(value)}</span>` +
          `<span class="active-chip-x" aria-hidden="true">×</span>` +
          `</button>`
      );
    }
  }
  bar.innerHTML =
    chips.join('') +
    `<button class="active-tag-clear" type="button" aria-label="Clear all filters">Clear all</button>`;
  for (const btn of bar.querySelectorAll<HTMLButtonElement>('.active-chip')) {
    btn.addEventListener('click', () => {
      const facet = btn.dataset.facet as FacetKey;
      const value = btn.dataset.value!;
      removeFilter(facet, value);
    });
  }
  bar.querySelector('.active-tag-clear')?.addEventListener('click', () => clearFilters());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

/**
 * Does this card satisfy all active filters?
 *   - AND across facets: every selected facet must have a matching value
 *   - OR within facet:   at least one selected value must match
 *   - No filters active → all cards pass through.
 */
export function cardMatchesActiveTag(card: HTMLElement): boolean {
  if (filters.size === 0) return true;
  for (const [facet, values] of filters) {
    const raw = card.dataset[FACET_ATTRS[facet] as keyof DOMStringMap] || '';
    // hall/award are single-value attrs; others are pipe-separated.
    const cardValues =
      facet === 'hall' || facet === 'award' ? (raw ? [raw] : []) : raw.split('|').filter(Boolean);
    let hit = false;
    for (const v of values) {
      if (cardValues.includes(v)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

/**
 * Wire global click handler — any element with data-tag-kind + data-tag-value
 * toggles a filter chip. UKGE-listed games are NOT tag chips (they're links
 * to BoardGameGeek) so this only fires for category / publisher / collection
 * game chips on cards.
 */
export function wireTagClicks(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tag-kind][data-tag-value]');
    if (!el) return;
    if (el.style.cursor === 'default' || el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    const kind = el.dataset.tagKind as FacetKey;
    const value = el.dataset.tagValue!;
    toggleFilter(kind, value);
    // Scroll the search bar back into view so the user sees the chip strip
    // update (only when adding — removing in-place shouldn't yank the page).
    if (hasFilter(kind, value)) {
      document.getElementById('search-bar')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
}
