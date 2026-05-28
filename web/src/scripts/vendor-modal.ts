// Pop a vendor's existing card into a modal so booth tools stay reachable
// when their name is clicked from contexts (like HotCard) that would
// otherwise navigate out to UKGE.
//
// Implementation: we clone the live card from the DOM rather than rebuild
// it. cards.ts uses document-level delegation and `syncAll` queries every
// `.card[data-slug]`, so the clone participates in state sync automatically.

function findCard(slug: string): HTMLElement | null {
  const esc = (window as any).CSS?.escape ? CSS.escape(slug) : slug;
  // Prefer the recommendation card (richer — score, why panel, matched games),
  // fall back to whichever card carries this slug.
  return (
    document.querySelector<HTMLElement>(`.card[data-kind="recommendation"][data-slug="${esc}"]`) ||
    document.querySelector<HTMLElement>(`.card[data-slug="${esc}"]`)
  );
}

export function wireVendorModal() {
  const modal = document.getElementById('vendor-modal');
  const body = document.getElementById('vendor-modal-body');
  if (!modal || !body) return;

  function open(slug: string): boolean {
    const src = findCard(slug);
    if (!src) return false;
    const clone = src.cloneNode(true) as HTMLElement;
    // Strip details/notes open state inherited from the source card so the
    // modal opens in a tidy default shape.
    clone.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((d) => (d.open = false));
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
    const opener = t.closest<HTMLElement>('[data-action="open-vendor-card"]');
    if (opener) {
      // Honour modifier clicks — let cmd/ctrl/middle/shift fall through to
      // the underlying <a href> so power users can still open UKGE in a tab.
      const me = e as MouseEvent;
      if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button === 1) return;
      const slug = opener.dataset.vendorSlug;
      if (!slug) return;
      if (open(slug)) e.preventDefault();
      return;
    }
    if (t.closest('[data-action="close-vendor-modal"]')) {
      close();
      return;
    }
    // Backdrop click — only when the click landed on the modal root itself.
    if (t === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
}
