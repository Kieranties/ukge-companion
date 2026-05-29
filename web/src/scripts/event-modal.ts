// Pop an event's existing EventCard into a modal so the Going toggle and
// notes stay reachable when the event is clicked from a vendor card (or
// any other context outside the Events tab).
//
// Mirrors vendor-modal.ts: we clone the live card from #event-grid rather
// than rebuild it. events.ts uses document-level delegation and a
// `syncAllEventCards` pass over every `[data-event-id]`, so the clone
// participates in state sync automatically.

function findEventCard(id: string): HTMLElement | null {
  const esc = (window as any).CSS?.escape ? CSS.escape(id) : id;
  // Source from the canonical Events grid — that's the server-rendered
  // EventCard with full markup. Fall back to any node carrying the id.
  return (
    document.querySelector<HTMLElement>(`#event-grid [data-event-id="${esc}"]`) ||
    document.querySelector<HTMLElement>(`[data-event-id="${esc}"]:not(.vendor-event-row)`)
  );
}

export function wireEventModal() {
  const modal = document.getElementById('event-modal');
  const body = document.getElementById('event-modal-body');
  if (!modal || !body) return;

  function open(id: string): boolean {
    const src = findEventCard(id);
    if (!src) return false;
    const clone = src.cloneNode(true) as HTMLElement;
    clone.classList.remove('hidden');
    clone.style.removeProperty('display');
    // Open in a tidy state.
    clone.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((d) => (d.open = false));
    clone.querySelectorAll<HTMLElement>('[data-role="event-notes"]').forEach((n) => n.classList.add('hidden'));
    body!.replaceChildren(clone);
    modal!.classList.add('open');
    modal!.setAttribute('aria-hidden', 'false');
    return true;
  }

  function close() {
    modal!.classList.remove('open');
    modal!.setAttribute('aria-hidden', 'true');
    body!.replaceChildren();
  }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const opener = t.closest<HTMLElement>('[data-action="open-event-card"]');
    if (opener) {
      // Don't intercept clicks on the inline Going button living inside
      // the same row — its own data-action takes precedence.
      if (t.closest('[data-action="open-going-picker"]')) return;
      const me = e as MouseEvent;
      if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button === 1) return;
      const id = opener.dataset.eventId;
      if (!id) return;
      if (open(id)) e.preventDefault();
      return;
    }
    if (t.closest('[data-action="close-event-modal"]')) {
      close();
      return;
    }
    if (t === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
}
