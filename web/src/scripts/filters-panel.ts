// Filters panel — browseable facet picker. Opens as a bottom sheet on mobile
// and a popover on desktop. Lists every facet (Category / Publisher / Hall /
// Award) with its values + live counts, multi-selectable via checkboxes.
//
// Live counts answer "if I tick this, how many cards will match?" — each
// value's count reflects cards that pass every OTHER active filter and hold
// that value in the candidate facet. Without this, the panel is just a list
// of strings; with it, the user sees the cost of every choice.
import {
  type FacetKey,
  addFilter,
  removeFilter,
  hasFilter,
  clearFilters,
  onTagChange,
  totalActiveFilters,
  getActiveFilters,
} from './tags';

interface CardSnapshot {
  values: Partial<Record<FacetKey, string[]>>;
}

// Award is intentionally absent — awards are per-game, not per-vendor, so
// they don't make sense as a vendor-listing filter. (If we ever build a
// "filter Hot games" panel, that's the place for an Award facet.)
const BROWSABLE_FACETS: { key: FacetKey; label: string; attr: keyof DOMStringMap; multi: boolean }[] = [
  { key: 'category', label: 'Category', attr: 'tagCategories', multi: true },
  { key: 'publisher', label: 'Publisher', attr: 'tagPublishers', multi: true },
  { key: 'hall', label: 'Hall', attr: 'hall', multi: false },
];

let cardSnapshots: CardSnapshot[] = [];
const valueSearch: Map<FacetKey, string> = new Map();
const expanded: Set<FacetKey> = new Set(['category']);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function snapshotCards(): CardSnapshot[] {
  // One snapshot per exhibitor slug, with values merged across card kinds.
  // The Browse-all card has the canonical category + hall info but no
  // publisher matches; the For-you card carries data-tag-publishers but
  // only for booths that matched the user's collection. We merge so the
  // publisher facet has values (drawn from For-you) and the category facet
  // covers every vendor (drawn from Browse).
  const all = document.querySelectorAll<HTMLElement>(
    '.panel[data-panel="browse"] .card[data-slug], .panel[data-panel="for-you"] .card[data-slug]'
  );
  const list = all.length > 0 ? all : document.querySelectorAll<HTMLElement>('.card[data-slug]');
  const bySlug = new Map<string, Partial<Record<FacetKey, string[]>>>();
  for (const card of list) {
    const slug = card.dataset.slug || '';
    if (!slug) continue;
    const merged = bySlug.get(slug) || {};
    for (const f of BROWSABLE_FACETS) {
      const raw = (card.dataset[f.attr as string] as string) || '';
      const next = f.multi ? raw.split('|').filter(Boolean) : raw ? [raw] : [];
      // Prefer non-empty values — Browse cards have categories but no
      // publishers, For-you cards have both. Take the longer list per facet.
      const cur = merged[f.key] || [];
      merged[f.key] = next.length > cur.length ? next : cur;
    }
    bySlug.set(slug, merged);
  }
  return [...bySlug.values()].map((values) => ({ values }));
}

function cardPassesAllExcept(card: CardSnapshot, exceptFacet: FacetKey): boolean {
  for (const [facet, selected] of getActiveFilters()) {
    if (facet === exceptFacet) continue;
    const v = card.values[facet] || [];
    let hit = false;
    for (const value of selected) {
      if (v.includes(value)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

function valuesWithCounts(facet: FacetKey): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cardSnapshots) {
    if (!cardPassesAllExcept(card, facet)) continue;
    for (const v of card.values[facet] || []) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function render() {
  const body = document.getElementById('filters-panel-body');
  if (!body) return;
  const total = totalActiveFilters();
  const totalLabel = total === 0 ? '' : ` <span class="filters-panel-count">${total}</span>`;
  let html = '';
  for (const facet of BROWSABLE_FACETS) {
    const all = valuesWithCounts(facet.key);
    const selectedCount = getActiveFilters().get(facet.key)?.size || 0;
    const open = expanded.has(facet.key);
    const filterStr = (valueSearch.get(facet.key) || '').toLowerCase();
    const shown = filterStr
      ? all.filter((v) => v.value.toLowerCase().includes(filterStr))
      : all;
    html += `<section class="facet-group${open ? ' open' : ''}" data-facet="${facet.key}">`;
    html += `<button class="facet-head" type="button" data-action="toggle-facet" data-facet="${facet.key}" aria-expanded="${open}">`;
    html += `<span class="facet-caret" aria-hidden="true">▸</span>`;
    html += `<span class="facet-title">${facet.label}</span>`;
    html += `<span class="facet-meta">`;
    if (selectedCount > 0) html += `<span class="facet-selected">${selectedCount} selected</span>`;
    html += `<span class="facet-total">${all.length} option${all.length === 1 ? '' : 's'}</span>`;
    html += `</span></button>`;
    if (open) {
      html += `<div class="facet-body">`;
      if (all.length >= 12) {
        html += `<input class="facet-filter-input" type="search" placeholder="Filter ${facet.label.toLowerCase()}…" value="${escapeAttr(filterStr)}" data-facet-filter="${facet.key}" autocomplete="off" />`;
      }
      if (shown.length === 0) {
        html += `<p class="facet-empty">No ${facet.label.toLowerCase()} values match.</p>`;
      } else {
        html += `<ul class="facet-values">`;
        for (const { value, count } of shown.slice(0, 200)) {
          const checked = hasFilter(facet.key, value);
          html += `<li><label class="facet-value${checked ? ' checked' : ''}">`;
          html += `<input type="checkbox" ${checked ? 'checked' : ''} data-facet-value="${facet.key}|${escapeAttr(value)}" />`;
          html += `<span class="facet-value-name">${escapeHtml(value)}</span>`;
          html += `<span class="facet-value-count">${count}</span>`;
          html += `</label></li>`;
        }
        html += `</ul>`;
        if (shown.length > 200) {
          html += `<p class="facet-empty">Showing first 200 of ${shown.length} — refine with the search box above.</p>`;
        }
      }
      html += `</div>`;
    }
    html += `</section>`;
  }
  body.innerHTML =
    `<div class="filters-panel-summary">${total === 0 ? 'No filters active.' : `${total} filter${total === 1 ? '' : 's'} active${totalLabel}`}</div>` +
    html;
}

function open() {
  const panel = document.getElementById('filters-panel');
  if (!panel) return;
  cardSnapshots = snapshotCards();
  render();
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('filters-panel-open');
}

function close() {
  const panel = document.getElementById('filters-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('filters-panel-open');
}

export function wireFiltersPanel() {
  const openBtn = document.getElementById('open-filters-panel');
  openBtn?.addEventListener('click', open);

  const panel = document.getElementById('filters-panel');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close-filters-panel') close();
    else if (action === 'clear-all-filters') {
      clearFilters();
      render();
    } else if (action === 'toggle-facet') {
      const facet = target.closest<HTMLElement>('[data-facet]')?.dataset.facet as FacetKey | undefined;
      if (!facet) return;
      if (expanded.has(facet)) expanded.delete(facet);
      else expanded.add(facet);
      render();
    }
  });

  panel.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    const data = cb.dataset.facetValue;
    if (!data) return;
    const [facet, ...rest] = data.split('|');
    const value = rest.join('|');
    if (cb.checked) addFilter(facet as FacetKey, value);
    else removeFilter(facet as FacetKey, value);
    // Re-render so counts update for every other facet (filters are AND
    // across, so changing one shrinks/grows the candidate pool elsewhere).
    render();
  });

  panel.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const facet = inp.dataset.facetFilter as FacetKey | undefined;
    if (!facet) return;
    valueSearch.set(facet, inp.value);
    // Re-render only the matching section. Simplest correct approach is
    // full re-render — the panel is small (~4 sections) so cost is fine.
    render();
    // Restore focus + cursor (innerHTML replaces the input element).
    const fresh = panel.querySelector<HTMLInputElement>(`[data-facet-filter="${facet}"]`);
    if (fresh) {
      fresh.focus();
      const len = fresh.value.length;
      fresh.setSelectionRange(len, len);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  });

  // Re-render when filters change from elsewhere (chip removal, card chips).
  onTagChange(() => {
    if (panel.classList.contains('open')) render();
  });
}
