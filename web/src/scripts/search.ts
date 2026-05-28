// Real search via MiniSearch — inverted index, ranking, prefix + fuzzy match.
// Index is built from every .card[data-slug] on the page. Each card carries
// the fields we want to search on as data-* attributes; the indexer reads
// those without needing the dashboard.json structure.
//
// Free-text search always queries every field. Precise filtering is handled
// by the structured filter system (filters.ts + tags.ts + filters-panel.ts).
import MiniSearch from 'minisearch';
import { applyFilters } from './filters';

const ALL_FIELDS = ['name', 'description', 'games', 'ukgeGames', 'publishers', 'categories', 'award', 'hall', 'stand'];

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
  const results = index.search(q.trim()) as unknown as Array<SearchDoc & { score: number }>;
  const groups: Record<string, Array<SearchDoc & { score: number }>> = {};
  for (const r of results.slice(0, 80)) (groups[r.kind] = groups[r.kind] || []).push(r);
  if (results.length === 0) {
    container.innerHTML = `<div class="search-summary">No results for <strong>${escapeHtml(q)}</strong>.</div>`;
    return;
  }
  let html = `<div class="search-summary"><strong>${results.length}</strong> result${results.length === 1 ? '' : 's'} for <strong>${escapeHtml(q)}</strong></div>`;
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

export function wireSearch() {
  indexFromPage();
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
