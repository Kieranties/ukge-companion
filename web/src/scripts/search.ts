// Real search via MiniSearch — inverted index, ranking, prefix + fuzzy match.
// Indexes everything once on load; query updates render results panel.
import MiniSearch from 'minisearch';
import { applyFilters } from './filters';

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
  publishers: string;
  award: string;
  panel: string;       // tab the card lives in
  cardSelector: string; // CSS to find the rendered card
}

let index: MiniSearch<SearchDoc> | null = null;
let docs: SearchDoc[] = [];

export function indexFromPage() {
  docs = [];
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
      publishers: card.dataset.publishers || '',
      award: card.dataset.award || '',
      panel,
      cardSelector: `.panel[data-panel="${panel}"] .card[data-slug="${slug}"][data-kind="${kind}"]`,
    });
  }

  index = new MiniSearch<SearchDoc>({
    fields: ['name', 'games', 'publishers', 'description', 'categories', 'hall', 'stand', 'award'],
    storeFields: ['kind', 'slug', 'name', 'hall', 'stand', 'cardSelector', 'panel'],
    searchOptions: {
      boost: { name: 4, games: 3, publishers: 2.5, award: 2, categories: 1.5 },
      prefix: true,
      fuzzy: 0.15,
      combineWith: 'AND',
    },
  });
  index.addAll(docs);
}

const KIND_LABELS: Record<SearchDoc['kind'], string> = {
  recommendation: 'Top recommendations',
  hot: 'Games to look out for' as any, // legacy
  'hot-game': 'Games to look out for',
  discovery: 'Discovery',
  'all-vendor': 'All exhibitors',
};

function highlightMatch(text: string, q: string): string {
  if (!q) return text;
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  let out = text;
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
  // Group by kind
  const groups: Record<string, Array<SearchDoc & { score: number }>> = {};
  for (const r of results.slice(0, 60)) {
    (groups[r.kind] = groups[r.kind] || []).push(r);
  }
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
    for (const r of items.slice(0, 18)) {
      const original = document.querySelector(r.cardSelector);
      if (!original) continue;
      // Clone the actual card; highlight the title within the clone.
      const clone = original.cloneNode(true) as HTMLElement;
      clone.removeAttribute('id');
      const titleA = clone.querySelector('.card-title h3 a, .card-title h4 a');
      if (titleA && q.trim()) {
        titleA.innerHTML = highlightMatch(titleA.textContent || '', q);
      }
      html += clone.outerHTML;
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
  // Re-wire any cloned cards so their booth-tool buttons still work.
  // (We'd need to re-import cards.ts wiring here, but for simplicity the
  //  clone is read-only display.)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
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
