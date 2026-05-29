// "+ Add event" picker — opened from a vendor card's events block. Lists
// every event at the show, pre-filtered to the vendor's hall (toggleable
// to show all halls). Selecting one calls store.addVendorEventOverride
// so VendorEvents can render it as an extra row.
//
// We source events from the already-rendered EventCards in #event-grid
// rather than re-importing dashboard.json — keeps a single source of truth
// and avoids shipping the events array twice. The cards carry every
// attribute we need on their data-* set.
import { store } from './state';

interface EventLite {
  id: string;
  title: string;
  hall: string; // best-effort: parsed from stand_label
  time: string;
  days: string[];
  category: string;
  exhibitorSlug: string;
  exhibitorName: string;
  haystack: string;
}

function readAllEvents(): EventLite[] {
  const out: EventLite[] = [];
  for (const card of document.querySelectorAll<HTMLElement>('#event-grid .event-card')) {
    const id = card.dataset.eventId || '';
    if (!id) continue;
    const exhibitorLink = card.querySelector<HTMLElement>('.event-exhibitor');
    const hallText = parseHallFromCard(card, exhibitorLink);
    out.push({
      id,
      title: card.dataset.title || '',
      time: card.dataset.time || '',
      days: (card.dataset.days || '').split(/\s+/).filter(Boolean),
      category: card.dataset.category || '',
      exhibitorSlug: card.dataset.exhibitorSlug || '',
      exhibitorName: card.dataset.exhibitorName || '',
      hall: hallText,
      haystack: card.dataset.haystack || '',
    });
  }
  return out;
}

/** EventCard doesn't expose hall directly — we derive it from the linked
 *  exhibitor's vendor card if present. Returns lower-case hall or ''. */
function parseHallFromCard(_card: HTMLElement, exhibitorLink: HTMLElement | null): string {
  const slug = exhibitorLink?.getAttribute('data-vendor-slug');
  if (!slug) return '';
  const esc = (window as any).CSS?.escape ? CSS.escape(slug) : slug;
  const vendor = document.querySelector<HTMLElement>(`.card[data-slug="${esc}"]`);
  return (vendor?.dataset.hall || '').toLowerCase();
}

const DAY_SHORT: Record<string, string> = { fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderRow(e: EventLite, alreadyAdded: boolean): string {
  const dayPills = e.days
    .map((d) => `<span class="event-day event-day-${d}">${DAY_SHORT[d] || d}</span>`)
    .join('');
  return `<button class="event-picker-row${alreadyAdded ? ' added' : ''}" type="button" data-event-id="${escapeHtml(e.id)}" ${alreadyAdded ? 'disabled' : ''}>
    <span class="event-picker-meta">${dayPills}${e.time ? `<span class="vendor-event-time">${escapeHtml(e.time)}</span>` : ''}${e.category ? `<span class="vendor-event-cat">${escapeHtml(e.category)}</span>` : ''}</span>
    <span class="event-picker-title">${escapeHtml(e.title)}</span>
    ${e.exhibitorName ? `<span class="event-picker-vendor">at ${escapeHtml(e.exhibitorName)}</span>` : ''}
    ${alreadyAdded ? '<span class="event-picker-added">already added</span>' : ''}
  </button>`;
}

export function wireEventPicker() {
  const modal = document.getElementById('vendor-event-picker');
  const list = document.getElementById('event-picker-list');
  const search = document.getElementById('event-picker-search') as HTMLInputElement | null;
  const empty = document.getElementById('event-picker-empty');
  const allHalls = document.getElementById('event-picker-all-halls') as HTMLInputElement | null;
  const title = document.getElementById('event-picker-title');
  if (!modal || !list || !search || !empty || !allHalls || !title) return;

  let allEvents: EventLite[] = [];
  let vendorSlug = '';
  let vendorHall = '';
  let vendorName = '';

  function rebuild() {
    if (!list || !empty) return;
    const q = (search?.value || '').trim().toLowerCase();
    const restrictHall = !allHalls?.checked && !!vendorHall;
    const linked = new Set<string>();
    // Linked = auto-pipeline links for this vendor plus already-added overrides.
    for (const ev of allEvents) {
      if (ev.exhibitorSlug === vendorSlug) linked.add(ev.id);
    }
    for (const id of store.getExtraEventIds(vendorSlug)) linked.add(id);

    const filtered = allEvents.filter((e) => {
      if (restrictHall && e.hall !== vendorHall.toLowerCase()) return false;
      if (q && !e.haystack.includes(q)) return false;
      return true;
    });
    // Sort: not-already-added first, then by title.
    filtered.sort((a, b) => {
      const ai = linked.has(a.id) ? 1 : 0;
      const bi = linked.has(b.id) ? 1 : 0;
      if (ai !== bi) return ai - bi;
      return a.title.localeCompare(b.title);
    });
    // Cap rendered rows; 600+ events would otherwise lock up mobile Safari.
    const cap = 200;
    const shown = filtered.slice(0, cap);
    list.innerHTML = shown.map((e) => renderRow(e, linked.has(e.id))).join('');
    empty.classList.toggle('hidden', shown.length > 0);
    if (filtered.length > cap) {
      const note = document.createElement('p');
      note.className = 'event-picker-truncated';
      note.textContent = `Showing the first ${cap} of ${filtered.length} matches — refine the search to narrow down.`;
      list.appendChild(note);
    }
  }

  function open(args: { slug: string; hall: string; name: string }) {
    vendorSlug = args.slug;
    vendorHall = args.hall || '';
    vendorName = args.name || '';
    if (search) search.value = '';
    if (allHalls) allHalls.checked = !vendorHall;
    if (title) title.textContent = vendorName ? `Add event at ${vendorName}…` : 'Add event…';
    // Lazy populate the events snapshot on first open — by then index.astro
    // has rendered the full event grid.
    if (allEvents.length === 0) allEvents = readAllEvents();
    rebuild();
    modal!.classList.add('open');
    modal!.setAttribute('aria-hidden', 'false');
    // Defer focus so iOS Safari shows the keyboard reliably.
    setTimeout(() => search?.focus(), 0);
  }

  function close() {
    modal!.classList.remove('open');
    modal!.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const opener = t.closest<HTMLElement>('[data-action="open-vendor-event-picker"]');
    if (opener) {
      e.preventDefault();
      open({
        slug: opener.dataset.vendorSlug || '',
        hall: opener.dataset.vendorHall || '',
        name: opener.dataset.vendorName || '',
      });
      return;
    }
    if (t.closest('[data-action="close-vendor-event-picker"]')) {
      close();
      return;
    }
    if (t === modal) {
      close();
      return;
    }
    const row = t.closest<HTMLElement>('.event-picker-row');
    if (row && !row.hasAttribute('disabled')) {
      const id = row.dataset.eventId;
      if (id && vendorSlug) {
        store.addVendorEventOverride(vendorSlug, id);
        close();
      }
    }
  });

  search.addEventListener('input', rebuild);
  allHalls.addEventListener('change', rebuild);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
}
