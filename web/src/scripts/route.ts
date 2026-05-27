// Route plan. Renders any stand the user has touched (any state) OR any
// recommendation, grouped by hall, sorted by stand number, with inline
// visit/buy/skip/notes controls. Honours the global day filter — if the
// user has Fri/Sat/Sun selected, only stops assigned to that day appear.
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

const DAY_LABEL: Record<string, string> = {
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function standSortKey(stand: string): [number, string] {
  if (!stand) return [9999, ''];
  const m = stand.match(/\d+/);
  return [m ? parseInt(m[0], 10) : 9999, stand];
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

interface Stop {
  slug: string;
  name: string;
  hall: string;
  stand: string;
  url: string;
  status?: 'visited' | 'revisit';
  skipped: boolean;
  buy: boolean;
  day?: string;
  notes?: string;
  sortKey: [number, string];
  fromRec: boolean;
}

function findCard(slug: string): HTMLElement | null {
  // Look for the slug in any panel; recommendation card takes priority.
  return (
    document.querySelector<HTMLElement>(
      `.panel[data-panel="for-you"] .card[data-slug="${CSS.escape(slug)}"]`
    ) ||
    document.querySelector<HTMLElement>(`.card[data-slug="${CSS.escape(slug)}"]`)
  );
}

function readCard(slug: string): { name: string; hall: string; stand: string; url: string } | null {
  const card = findCard(slug);
  if (!card) return null;
  const a = card.querySelector<HTMLAnchorElement>('.card-title h3 a, .card-title h4 a');
  return {
    name: a?.textContent?.trim() || card.dataset.name || slug,
    hall: card.dataset.hall || '',
    stand: card.dataset.stand || '',
    url: a?.href || '#',
  };
}

function collectStops(): Stop[] {
  // Start with every recommendation slug (always part of the plan even if
  // untouched), then add any other slug the user has state for.
  const slugs = new Set<string>();
  for (const card of document.querySelectorAll<HTMLElement>(
    '.panel[data-panel="for-you"] .card[data-slug]'
  )) {
    slugs.add(card.dataset.slug!);
  }
  for (const slug of Object.keys(store.data)) {
    slugs.add(slug);
  }

  const stops: Stop[] = [];
  for (const slug of slugs) {
    const info = readCard(slug);
    if (!info) continue; // Stand removed from the listing — skip silently.
    const e = store.get(slug);
    const fromRec = !!document.querySelector(
      `.panel[data-panel="for-you"] .card[data-slug="${CSS.escape(slug)}"]`
    );
    stops.push({
      slug,
      name: info.name,
      hall: info.hall ? info.hall.replace(/\b\w/g, (l) => l.toUpperCase()) : 'Other',
      stand: info.stand,
      url: info.url,
      status: e.status,
      skipped: !!e.skipped,
      buy: !!e.buy,
      day: e.day,
      notes: e.notes,
      sortKey: standSortKey(info.stand),
      fromRec,
    });
  }
  return stops;
}

function readDayFilter(): string {
  return (
    document.querySelector<HTMLButtonElement>('.day-pill.active')?.dataset.day || 'any'
  );
}

function renderStop(s: Stop, dayFilter: string): string {
  const cls = [
    s.status === 'visited' ? 'done' : '',
    s.status === 'revisit' ? 'revisit' : '',
    s.skipped ? 'skipped' : '',
    s.buy ? 'buying' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const visitLabel = s.status === 'revisit' ? '★' : s.status === 'visited' ? '✓' : 'Mark';
  const dayChips = dayFilter === 'any'
    ? `<div class="route-stop-days">
         ${(['fri', 'sat', 'sun'] as const)
           .map(
             (d) =>
               `<button class="day-chip ${s.day === d ? 'active' : ''}" data-action="set-day" data-day="${d}" type="button">${DAY_LABEL[d]}</button>`
           )
           .join('')}
       </div>`
    : '';
  const hasNotes = !!(s.notes && s.notes.trim());

  return `<div class="route-stop ${cls}" data-slug="${esc(s.slug)}">
    <div class="route-stop-main">
      <span class="stop-num">${esc(s.stand || '—')}</span>
      <span class="stop-name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></span>
      <span class="stop-actions">
        <button class="route-act visit ${s.status === 'visited' ? 'on' : ''} ${s.status === 'revisit' ? 'revisit' : ''}" data-action="toggle-visit" type="button" title="Mark visited / revisit">${visitLabel}</button>
        <button class="route-act buy ${s.buy ? 'on' : ''}" data-action="toggle-buy" type="button" title="Buy from this stand">🛒</button>
        <button class="route-act skip ${s.skipped ? 'on' : ''}" data-action="toggle-skip" type="button" title="Skip">⊘</button>
        <button class="route-act notes ${hasNotes ? 'on' : ''}" data-action="toggle-notes" type="button" title="Notes">✎</button>
      </span>
    </div>
    ${dayChips}
    <div class="route-stop-notes hidden" data-role="notes">
      <textarea data-role="notes-text" placeholder="Notes — saved on your device only">${esc(s.notes || '')}</textarea>
    </div>
  </div>`;
}

export function buildRoute() {
  const root = document.getElementById('route-plan');
  if (!root) return;
  const dayFilter = readDayFilter();
  const stops = collectStops().filter((s) => {
    if (s.skipped) {
      const hideSkipped = document.getElementById('hide-skipped')?.classList.contains('active');
      if (hideSkipped) return false;
    }
    if (dayFilter !== 'any' && s.day !== dayFilter) return false;
    return true;
  });

  // Group by hall
  const groups: Record<string, Stop[]> = {};
  for (const s of stops) (groups[s.hall] = groups[s.hall] || []).push(s);
  const halls = Object.keys(groups).sort((a, b) => {
    const ai = HALL_ORDER.indexOf(a);
    const bi = HALL_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  if (halls.length === 0) {
    let msg: string;
    if (dayFilter !== 'any') {
      msg = `No stands assigned to ${DAY_LABEL[dayFilter]}. Use the <span style="font-family:var(--font-sans);font-size:11px;background:var(--panel-2);padding:1px 6px;border-radius:6px">Day</span> chips on any card to plan one in.`;
    } else {
      msg = 'No stands yet — mark some as visited or assign a day to start building your route.';
    }
    root.innerHTML = `<p style="color:var(--ink-dim); padding: 18px 0">${msg}</p>`;
    return;
  }

  let html = '';
  if (dayFilter !== 'any') {
    html += `<p class="route-filter-note">Showing <strong>${DAY_LABEL[dayFilter]}</strong> stops only — pick <strong>Any</strong> in the day filter above to see everything.</p>`;
  }
  for (const hall of halls) {
    const list = groups[hall].sort((a, b) =>
      a.sortKey[0] - b.sortKey[0] || a.sortKey[1].localeCompare(b.sortKey[1])
    );
    const remaining = list.filter((s) => !s.status && !s.skipped).length;
    html += `<div class="route-hall"><h3>${esc(hall)} <span class="hall-count">${list.length} stops · ${remaining} to do</span></h3>`;
    for (const s of list) html += renderStop(s, dayFilter);
    html += '</div>';
  }
  root.innerHTML = html;
}

function wireRouteInteractions() {
  const root = document.getElementById('route-plan');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const stop = btn.closest<HTMLElement>('.route-stop');
    const slug = stop?.dataset.slug;
    if (!slug) return;
    const action = btn.dataset.action;
    if (action === 'toggle-visit') store.cycleVisit(slug);
    else if (action === 'toggle-buy') store.toggleBuy(slug);
    else if (action === 'toggle-skip') store.toggleSkip(slug);
    else if (action === 'toggle-notes') {
      const area = stop!.querySelector<HTMLElement>('[data-role="notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.focus();
      }
    } else if (action === 'set-day') {
      store.setDay(slug, btn.dataset.day as 'fri' | 'sat' | 'sun');
    }
  });
  // Debounced notes input. Event delegation so we don't re-bind on rebuild.
  const notesTimers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();
  root.addEventListener('input', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta?.dataset?.role || ta.dataset.role !== 'notes-text') return;
    const slug = ta.closest<HTMLElement>('.route-stop')?.dataset.slug;
    if (!slug) return;
    const prev = notesTimers.get(ta);
    if (prev) clearTimeout(prev);
    notesTimers.set(
      ta,
      setTimeout(() => store.setNotes(slug, ta.value), 250)
    );
  });
}

export function wireRoute() {
  wireRouteInteractions();
  buildRoute();
  store.subscribe(buildRoute);
  // Rebuild when day filter or hide-skipped changes (they affect what's shown).
  for (const pill of document.querySelectorAll('.day-pill, #hide-skipped')) {
    pill.addEventListener('click', () => setTimeout(buildRoute, 0));
  }
}
