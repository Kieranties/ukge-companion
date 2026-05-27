// Build the route plan view from the rendered recommendation cards. Groups
// by hall, sorts by stand number, and reflects current state (visited/skip/
// buy/day) live.
import { store } from './state';

const HALL_ORDER = [
  'Hall One',
  'Hall Two',
  'Hall Three',
  'Hall Three A',
  'Hall Four',
  'Hall Five',
  'Toy Fair',
];

function standSortKey(stand: string): [number, string] {
  if (!stand) return [9999, ''];
  const m = stand.match(/\d+/);
  return [m ? parseInt(m[0], 10) : 9999, stand];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function buildRoute() {
  const root = document.getElementById('route-plan');
  if (!root) return;
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>('.panel[data-panel="for-you"] .card[data-kind="recommendation"]')
  );
  const groups: Record<string, Array<{
    slug: string; name: string; stand: string; url: string;
    visited: boolean; revisit: boolean; skipped: boolean; buy: boolean; day?: string;
    sortKey: [number, string];
  }>> = {};
  for (const card of cards) {
    const slug = card.dataset.slug!;
    const e = store.get(slug);
    const hall = card.dataset.hall || 'Other';
    const stand = card.dataset.stand || '';
    const titleA = card.querySelector<HTMLAnchorElement>('.card-title h3 a, .card-title h4 a');
    (groups[hall] = groups[hall] || []).push({
      slug,
      name: titleA?.textContent || card.dataset.name || '',
      stand,
      url: titleA?.href || '#',
      visited: e.status === 'visited',
      revisit: e.status === 'revisit',
      skipped: !!e.skipped,
      buy: !!e.buy,
      day: e.day,
      sortKey: standSortKey(stand),
    });
  }
  const halls = Object.keys(groups).sort((a, b) => {
    const ai = HALL_ORDER.indexOf(a);
    const bi = HALL_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  let html = '';
  for (const hall of halls) {
    const stops = groups[hall].sort((a, b) =>
      a.sortKey[0] - b.sortKey[0] || a.sortKey[1].localeCompare(b.sortKey[1])
    );
    const remaining = stops.filter((s) => !s.visited && !s.skipped).length;
    html += `<div class="route-hall"><h3>${escapeHtml(hall)} <span class="hall-count">${stops.length} stops · ${remaining} to do</span></h3>`;
    for (const s of stops) {
      const cls = [
        s.visited ? 'done' : '',
        s.revisit ? 'revisit' : '',
        s.skipped ? 'skipped' : '',
        s.buy ? 'buying' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const icon =
        (s.revisit ? '★' : s.visited ? '✓' : s.skipped ? '⊘' : '') +
        (s.buy ? ' 🛒' : '') +
        (s.day ? ' · ' + s.day : '');
      html += `<div class="route-stop ${cls}">
        <span class="stop-num">${escapeHtml(s.stand || '—')}</span>
        <span class="stop-name"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a></span>
        <span class="stop-mini">${icon}</span>
      </div>`;
    }
    html += '</div>';
  }
  root.innerHTML = html || '<p style="color:var(--ink-dim)">No matched stands yet.</p>';
}

export function wireRoute() {
  buildRoute();
  store.subscribe(buildRoute);
}
