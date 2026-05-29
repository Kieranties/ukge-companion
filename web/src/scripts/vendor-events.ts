// Client-side sync for the per-vendor events list. Two jobs:
//
//   1. Hydrate any "extra" event rows the user added via the picker (lives
//      in localStorage as store.vendorOverrides[slug].extraEventIds).
//   2. Keep the summary count in sync as overrides come and go.
//
// The Going button labels on each row are kept in sync by the existing
// syncAllEventCards pass in events.ts, which matches every [data-event-id]
// node — including the rows here, since they carry data-event-id + data-days
// the same way EventCard does.
import { store } from './state';

const DAY_SHORT: Record<string, string> = { fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function findSourceEventCard(id: string): HTMLElement | null {
  const esc = (window as any).CSS?.escape ? CSS.escape(id) : id;
  return document.querySelector<HTMLElement>(`#event-grid .event-card[data-event-id="${esc}"]`);
}

function readEventMetaFromSource(card: HTMLElement) {
  const days = (card.dataset.days || '').split(/\s+/).filter(Boolean);
  return {
    title: card.dataset.title || '',
    days,
    time: card.dataset.time || '',
    category: card.dataset.category || '',
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function buildOverrideRowHtml(id: string): string | null {
  const src = findSourceEventCard(id);
  if (!src) return null;
  const meta = readEventMetaFromSource(src);
  const dayPills = meta.days
    .map((d) => `<span class="event-day event-day-${d}">${DAY_SHORT[d] || d}</span>`)
    .join('');
  return `<li class="vendor-event-row" data-event-id="${escapeHtml(id)}" data-source="override" data-days="${escapeHtml(meta.days.join(' '))}">
    <button class="vendor-event-open" type="button" data-action="open-event-card" data-event-id="${escapeHtml(id)}" title="Open ${escapeHtml(meta.title)}">
      <span class="vendor-event-meta">${dayPills}${meta.time ? `<span class="vendor-event-time">${escapeHtml(meta.time)}</span>` : ''}${meta.category ? `<span class="vendor-event-cat">${escapeHtml(meta.category)}</span>` : ''}<span class="vendor-event-manual" title="Added by you">manual</span></span>
      <span class="vendor-event-title">${escapeHtml(meta.title)}</span>
    </button>
    <span class="vendor-event-actions">
      <button class="booth-btn attend-btn vendor-event-going" type="button" data-action="open-going-picker">Going</button>
      <button class="vendor-event-remove" type="button" data-action="remove-vendor-event-override" title="Remove from this vendor" aria-label="Remove">×</button>
    </span>
  </li>`;
}

function syncBlock(block: HTMLElement) {
  const slug = block.dataset.vendorSlug || '';
  if (!slug) return;
  const list = block.querySelector<HTMLElement>('[data-role="vendor-events-list"]');
  const countEl = block.querySelector<HTMLElement>('[data-role="vendor-events-count"]');
  const labelEl = block.querySelector<HTMLElement>('.vendor-events-label');
  if (!list) return;

  const baseIds = new Set((block.dataset.baseEventIds || '').split(/\s+/).filter(Boolean));
  const desiredOverrides = store.getExtraEventIds(slug).filter((id) => !baseIds.has(id));
  const desiredSet = new Set(desiredOverrides);

  // Drop any override rows that are no longer in state.
  for (const row of list.querySelectorAll<HTMLElement>('.vendor-event-row[data-source="override"]')) {
    const id = row.dataset.eventId || '';
    if (!desiredSet.has(id)) row.remove();
  }

  // Append any newly-added overrides not already present.
  const existing = new Set(
    Array.from(list.querySelectorAll<HTMLElement>('.vendor-event-row[data-source="override"]')).map(
      (r) => r.dataset.eventId || '',
    ),
  );
  for (const id of desiredOverrides) {
    if (existing.has(id)) continue;
    const html = buildOverrideRowHtml(id);
    if (!html) continue;
    list.insertAdjacentHTML('beforeend', html);
  }

  // Refresh the summary. The server may have rendered the empty-state form
  // (no count span); when overrides have promoted us off-zero, swap in the
  // populated form so the count + label match.
  const total = baseIds.size + desiredOverrides.length;
  const summary = block.querySelector<HTMLElement>(':scope > summary');
  if (summary) {
    if (total === 0) {
      summary.innerHTML = '<span class="vendor-events-label">Add event…</span>';
    } else if (!countEl || !labelEl) {
      summary.innerHTML = `<span class="vendor-events-count" data-role="vendor-events-count">${total}</span><span class="vendor-events-label">event${total === 1 ? '' : 's'} at this booth</span>`;
    } else {
      countEl.textContent = String(total);
      labelEl.textContent = `event${total === 1 ? '' : 's'} at this booth`;
    }
  }
  block.classList.toggle('has-overrides', desiredOverrides.length > 0);
  block.classList.toggle('is-empty', total === 0);
}

function syncAll() {
  for (const block of document.querySelectorAll<HTMLElement>('[data-role="vendor-events"]')) {
    syncBlock(block);
  }
}

export function wireVendorEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const rm = t.closest<HTMLElement>('[data-action="remove-vendor-event-override"]');
    if (!rm) return;
    const block = rm.closest<HTMLElement>('[data-role="vendor-events"]');
    const row = rm.closest<HTMLElement>('.vendor-event-row');
    if (!block || !row) return;
    const slug = block.dataset.vendorSlug || '';
    const id = row.dataset.eventId || '';
    if (slug && id) store.removeVendorEventOverride(slug, id);
    e.stopPropagation();
  });

  syncAll();
  store.subscribe(syncAll);
}
