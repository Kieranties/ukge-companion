// Tag filter — clicking a tag chip filters cards by exact tag match (NOT a
// substring search). Different tag kinds match against different card data
// attributes:
//
//   kind="category"  → card.dataset.tagCategories
//   kind="publisher" → card.dataset.tagPublishers
//   kind="game"      → card.dataset.tagGames        (games in the user's collection)
//   kind="ukge-game" → look up which exhibitors list this game on UKGE
//
// One active tag at a time. A bar at the top of the content area shows the
// active tag and lets the user clear it.
import { applyFilters } from './filters';

export interface ActiveTag {
  kind: 'category' | 'publisher' | 'game' | 'ukge-game';
  value: string;
}

let active: ActiveTag | null = null;
const listeners = new Set<() => void>();

export function getActiveTag(): ActiveTag | null {
  return active;
}

export function setActiveTag(t: ActiveTag | null): void {
  active = t;
  renderActiveBar();
  for (const fn of listeners) fn();
  applyFilters();
}

export function onTagChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const KIND_LABELS: Record<ActiveTag['kind'], string> = {
  category: 'Category',
  publisher: 'Publisher',
  game: 'Game',
  'ukge-game': 'UKGE-listed game',
};

function renderActiveBar() {
  const bar = document.getElementById('active-tag-bar');
  if (!bar) return;
  if (!active) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span class="active-tag-label">${KIND_LABELS[active.kind]}:</span>
    <span class="active-tag-value">${escapeHtml(active.value)}</span>
    <button class="active-tag-clear" type="button" aria-label="Clear tag filter">×</button>
  `;
  bar.querySelector('.active-tag-clear')?.addEventListener('click', () => setActiveTag(null));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Does this card match the currently-active tag (or pass through if no tag)?
 * Returns true when the tag is null or the card has the value in the right
 * data attribute (pipe-separated, whole-value match).
 */
export function cardMatchesActiveTag(card: HTMLElement): boolean {
  if (!active) return true;
  let attr: string | undefined;
  switch (active.kind) {
    case 'category':
      attr = card.dataset.tagCategories;
      break;
    case 'publisher':
      attr = card.dataset.tagPublishers;
      break;
    case 'game':
      attr = card.dataset.tagGames;
      break;
    case 'ukge-game':
      attr = card.dataset.tagUkgeGames;
      break;
  }
  if (!attr) return false;
  return attr.split('|').some((t) => t === active!.value);
}

/**
 * Wire global click handler — any element with data-tag-kind + data-tag-value
 * sets the active tag. UKGE-listed games are NOT tag chips (they're links to
 * BoardGameGeek) so this only fires for category / publisher / collection-game
 * chips.
 */
export function wireTagClicks(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tag-kind][data-tag-value]');
    if (!el) return;
    // Don't fire when the chip is a non-interactive label
    if (el.style.cursor === 'default' || el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    const kind = el.dataset.tagKind as ActiveTag['kind'];
    const value = el.dataset.tagValue!;
    if (active && active.kind === kind && active.value === value) {
      setActiveTag(null);
    } else {
      setActiveTag({ kind, value });
      // Scroll to top of content so user sees the filtered view
      document.getElementById('search-bar')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
}
