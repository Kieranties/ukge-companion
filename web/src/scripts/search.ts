// Real search via MiniSearch — inverted index, ranking, prefix + fuzzy match.
// Index is built from every .card[data-slug] on the page. Each card carries
// the fields we want to search on as data-* attributes; the indexer reads
// those without needing the dashboard.json structure.
//
// Search facets (Exhibitor / Games / Publishers / Categories / Halls) let
// the user scope the query to specific fields. State lives in this module;
// the UI is a row of pills below the search input. "All" is implicit when
// no individual facets are active.
import MiniSearch from 'minisearch';
import { applyFilters } from './filters';

type FacetKey = 'exhibitor' | 'games' | 'publishers' | 'categories' | 'halls';

const FACET_FIELDS: Record<FacetKey, string[]> = {
  exhibitor: ['name', 'description'],
  games: ['games', 'ukgeGames'],
  publishers: ['publishers'],
  categories: ['categories', 'award'],
  halls: ['hall', 'stand'],
};

const ALL_FIELDS = Object.values(FACET_FIELDS).flat();

const FIELD_BOOSTS: Record<string, number> = {
  name: 4,
  games: 3,
  ukgeGames: 2.5,
  publishers: 2.5,
  award: 2,
  categories: 1.5,
  description: 1,
  hall: 1,
  stand: 1,
};

interface SearchDoc {
  id: string;
  slug: string;
  kind: 'recommendation' | 'discovery' | 'all-vendor' | 'hot-game';
  name: string;
  hall: string;
  stand: string;
  description: string;
  categories: string;
  games: string;
  ukgeGames: string;
  publishers: string;
  award: string;
  panel: string;
  cardSelector: string;
}

let index: MiniSearch<SearchDoc> | null = null;

// Set of *individual* facets the user has toggled on. Empty means "all".
const activeFacets = new Set<FacetKey>();
function isActiveFacet(f: FacetKey): boolean {
  return activeFacets.size === 0 || activeFacets.has(f);
}
function effectiveFields(): string[] {
  if (activeFacets.size === 0) return ALL_FIELDS;
  const out: string[] = [];
  for (const f of activeFacets) out.push(...FACET_FIELDS[f]);
  return out;
}

export function indexFromPage() {
  const docs: SearchDoc[] = [];
  for (const card of document.querySelectorAll<HTMLElement>('.card[data-slug]')) {
    const slug = card.dataset.slug!;
    const kind = (card.dataset.kind || 'all-vendor') as SearchDoc['kind'];
    const panel = card.closest<HTMLElement>('.panel')?.dataset.panel || 'browse';
    docs.push({
      id: `${kind}:${slug}`,
      slug,
      kind,
      name: card.dataset.name || '',
      hall: card.dataset.hall || '',
      stand: card.dataset.stand || '',
      description: card.dataset.description || '',
      categories: card.dataset.categories || '',
      games: card.dataset.games || '',
      ukgeGames: card.dataset.ukgeGames || '',
      publishers: card.dataset.publishers || '',
      award: card.dataset.award || '',
      panel,
      cardSelector: `.panel[data-panel="${panel}"] .card[data-slug="${slug}"][data-kind="${kind}"]`,
    });
  }

  index = new MiniSearch<SearchDoc>({
    fields: ALL_FIELDS,
    storeFields: ['kind', 'slug', 'name', 'hall', 'stand', 'cardSelector', 'panel'],
    searchOptions: {
      boost: FIELD_BOOSTS,
      prefix: true,
      fuzzy: 0.15,
      combineWith: 'AND',
    },
  });
  index.addAll(docs);
}

const KIND_LABELS: Record<SearchDoc['kind'], string> = {
  recommendation: 'Top recommendations',
  'hot-game': 'Games to look out for',
  discovery: 'Discovery',
  'all-vendor': 'All exhibitors',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function highlightMatch(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  let out = escapeHtml(text);
  for (const t of tokens) {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    out = out.replace(re, '<span class="hit">$1</span>');
  }
  return out;
}

function renderResults(q: string) {
  const container = document.getElementById('search-results');
  if (!container || !index) return;
  if (!q.trim()) {
    document.body.dataset.searching = '0';
    container.innerHTML = '';
    return;
  }
  document.body.dataset.searching = '1';
  const results = index.search(q.trim(), {
    fields: effectiveFields(),
  }) as unknown as Array<SearchDoc & { score: number }>;
  const groups: Record<string, Array<SearchDoc & { score: number }>> = {};
  for (const r of results.slice(0, 80)) (groups[r.kind] = groups[r.kind] || []).push(r);
  if (results.length === 0) {
    const facetNote = activeFacets.size > 0 ? ` in ${[...activeFacets].join(', ')}` : '';
    container.innerHTML = `<div class="search-summary">No results for <strong>${escapeHtml(q)}</strong>${facetNote}.</div>`;
    return;
  }
  let html = `<div class="search-summary"><strong>${results.length}</strong> result${results.length === 1 ? '' : 's'} for <strong>${escapeHtml(q)}</strong>${activeFacets.size > 0 ? ` <span class="facet-note">(${[...activeFacets].join(', ')})</span>` : ''}</div>`;
  const order: SearchDoc['kind'][] = ['recommendation', 'hot-game', 'discovery', 'all-vendor'];
  for (const kind of order) {
    const items = groups[kind];
    if (!items || items.length === 0) continue;
    html += `<div class="search-section"><h3>${KIND_LABELS[kind]} <span class="count">${items.length}</span></h3>`;
    html += '<div class="card-grid two-up">';
    for (const r of items.slice(0, 20)) {
      const original = document.querySelector(r.cardSelector);
      if (!original) continue;
      const clone = original.cloneNode(true) as HTMLElement;
      clone.removeAttribute('id');
      const titleA = clone.querySelector('.card-title h3 a, .card-title h4 a');
      if (titleA && q.trim()) titleA.innerHTML = highlightMatch(titleA.textContent || '', q);
      html += clone.outerHTML;
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
}

function wireFacetPills() {
  const pills = Array.from(document.querySelectorAll<HTMLButtonElement>('.facet-pill'));
  const updateUI = () => {
    for (const p of pills) {
      const f = p.dataset.facet;
      if (f === 'all') p.classList.toggle('active', activeFacets.size === 0);
      else p.classList.toggle('active', activeFacets.has(f as FacetKey));
    }
  };
  for (const pill of pills) {
    pill.addEventListener('click', () => {
      const f = pill.dataset.facet;
      if (f === 'all') {
        activeFacets.clear();
      } else if (f) {
        const key = f as FacetKey;
        if (activeFacets.has(key)) activeFacets.delete(key);
        else activeFacets.add(key);
      }
      updateUI();
      const input = document.getElementById('global-q') as HTMLInputElement | null;
      if (input?.value.trim()) renderResults(input.value);
    });
  }
  updateUI();
}

export function wireSearch() {
  indexFromPage();
  wireFacetPills();
  const input = document.getElementById('global-q') as HTMLInputElement | null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  input?.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => renderResults(input.value), 100);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      input?.focus();
      input?.select();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      if (input) {
        input.value = '';
        renderResults('');
        applyFilters();
      }
    }
  });
}
