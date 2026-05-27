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
  description: string;
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

function readCard(slug: string): { name: string; hall: string; stand: string; url: string; description: string } | null {
  const card = findCard(slug);
  if (!card) return null;
  const a = card.querySelector<HTMLAnchorElement>('.card-title h3 a, .card-title h4 a');
  // Pull the rendered description text (uses dataset-mirrored value if missing
  // on the DOM). data-description is lowercased — use the original .card-desc
  // text for proper casing.
  const descEl = card.querySelector<HTMLElement>('.card-desc');
  const description = descEl?.textContent?.trim() || '';
  return {
    name: a?.textContent?.trim() || card.dataset.name || slug,
    hall: card.dataset.hall || '',
    stand: card.dataset.stand || '',
    url: a?.href || '#',
    description,
  };
}

function collectStops(): Stop[] {
  // The route is the user's *plan* — only stands they've explicitly added to
  // it (entry.day set to anything) appear here. No more "everything's in the
  // route by default". Mark a stand on any card to add it.
  const stops: Stop[] = [];
  for (const [slug, e] of Object.entries(store.data)) {
    if (!e.day) continue;
    const info = readCard(slug);
    if (!info) continue;
    const fromRec = !!document.querySelector(
      `.panel[data-panel="for-you"] .card[data-slug="${CSS.escape(slug)}"]`
    );
    stops.push({
      slug,
      name: info.name,
      hall: info.hall ? info.hall.replace(/\b\w/g, (l) => l.toUpperCase()) : 'Other',
      stand: info.stand,
      url: info.url,
      description: info.description,
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

const DAY_BADGE: Record<string, string> = {
  any: 'Any day',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

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
  const hasNotes = !!(s.notes && s.notes.trim());
  const dayBadge = s.day
    ? `<button class="route-day-badge" data-action="cycle-plan" type="button" title="Tap to change plan day — cycles Any → Fri → Sat → Sun → off">${DAY_BADGE[s.day]}</button>`
    : '';

  const descBlock = s.description ? `<div class="route-stop-desc">${esc(s.description)}</div>` : '';
  const standCell = s.stand
    ? `<a class="stop-num" href="https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/map/#${esc(s.stand)}" target="_blank" rel="noopener" title="Find ${esc(s.stand)} on the UKGE map">${esc(s.stand)}</a>`
    : `<span class="stop-num">—</span>`;
  return `<div class="route-stop ${cls}" data-slug="${esc(s.slug)}">
    <div class="route-stop-main">
      ${standCell}
      <span class="stop-name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>${dayBadge}</span>
      <span class="stop-actions">
        <button class="route-act visit ${s.status === 'visited' ? 'on' : ''} ${s.status === 'revisit' ? 'revisit' : ''}" data-action="toggle-visit" type="button" title="Mark visited / revisit">${visitLabel}</button>
        <button class="route-act buy ${s.buy ? 'on' : ''}" data-action="toggle-buy" type="button" title="Buy from this stand">🛒</button>
        <button class="route-act skip ${s.skipped ? 'on' : ''}" data-action="toggle-skip" type="button" title="Skip">⊘</button>
        <button class="route-act notes ${hasNotes ? 'on' : ''}" data-action="toggle-notes" type="button" title="Notes">✎</button>
      </span>
    </div>
    ${descBlock}
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
      // The pill is active when the user wants hidden booths shown.
      const showingHidden = document.getElementById('hide-skipped')?.classList.contains('active');
      if (!showingHidden) return false;
    }
    // 'any'-day stands are flexible — they appear under every specific day
    // filter too. A specific day filter only excludes other specific days.
    if (dayFilter !== 'any' && s.day !== dayFilter && s.day !== 'any') return false;
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
      msg = `Nothing planned for <strong>${DAY_LABEL[dayFilter]}</strong>. Tap <em>Add to plan</em> on any exhibitor card and cycle to ${DAY_LABEL[dayFilter]} to fill this list.`;
    } else {
      msg = `Your route is empty. Tap <em>+ Add to plan</em> on any exhibitor card (in For you, Discover, or Browse all) to add them here. The button cycles: Any day → Friday → Saturday → Sunday.`;
    }
    root.innerHTML = `<div class="route-empty">${msg}</div>`;
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
    else if (action === 'cycle-plan') store.cyclePlan(slug);
    else if (action === 'toggle-notes') {
      const area = stop!.querySelector<HTMLElement>('[data-role="notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.focus();
      }
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
