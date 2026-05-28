// Wire up every card's booth-tools UI (visit / buy / skip / day / notes)
// to the central state store.
import { store, type BoothEntry } from './state';

const PLAN_LABEL: Record<string, string> = {
  any: 'Planned · Any day',
  fri: '🗓 Friday',
  sat: '🗓 Saturday',
  sun: '🗓 Sunday',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderShoppingList(items: BoothEntry['buyList']): string {
  if (!items || items.length === 0) {
    return '<li class="shopping-empty">No specific games listed yet. Add one below ↓</li>';
  }
  return items
    .map(
      (it, i) => `<li class="shopping-item${it.purchased ? ' purchased' : ''}">
      <button class="shopping-check" data-action="toggle-purchased" data-idx="${i}" type="button" aria-label="${it.purchased ? 'Mark as not purchased' : 'Mark as purchased'}">${it.purchased ? '✓' : ''}</button>
      <span class="shopping-name">${escapeHtml(it.name)}</span>
      <button class="shopping-remove" data-action="remove-buy-item" data-idx="${i}" type="button" aria-label="Remove ${escapeHtml(it.name)}">×</button>
    </li>`
    )
    .join('');
}

function syncCard(card: HTMLElement, e: BoothEntry) {
  const status = e.status;
  card.classList.toggle('visited', status === 'visited');
  card.classList.toggle('revisit', status === 'revisit');
  card.classList.toggle('skipped', !!e.skipped);
  card.classList.toggle('buying', !!e.buy);
  card.classList.toggle('planned', !!e.day);
  card.dataset.status = status ?? '';
  card.dataset.skipped = e.skipped ? '1' : '0';
  card.dataset.buy = e.buy ? '1' : '0';
  card.dataset.day = e.day ?? '';

  const v = card.querySelector<HTMLButtonElement>('[data-action="toggle-visit"]');
  if (v) {
    v.textContent =
      status === 'revisit' ? '★ Visit again' : status === 'visited' ? '✓ Visited' : 'Mark as visited';
    v.classList.toggle('visited', status === 'visited');
    v.classList.toggle('revisit', status === 'revisit');
  }
  const b = card.querySelector<HTMLButtonElement>('[data-action="toggle-buy"]');
  if (b) {
    const n = e.buyList?.length || 0;
    if (e.buy && n > 0) b.textContent = `🛒 Buying (${n})`;
    else if (e.buy) b.textContent = '🛒 Buying';
    else b.textContent = '🛒 Buy';
    b.classList.toggle('on', !!e.buy);
  }
  const s = card.querySelector<HTMLButtonElement>('[data-action="toggle-skip"]');
  if (s) {
    s.textContent = e.skipped ? 'Hidden' : 'Hide';
    s.classList.toggle('on', !!e.skipped);
  }
  const p = card.querySelector<HTMLButtonElement>('[data-action="cycle-plan"]');
  if (p) {
    p.textContent = e.day ? PLAN_LABEL[e.day] : '+ Add to plan';
    p.classList.toggle('on', !!e.day);
    p.classList.toggle('plan-any', e.day === 'any');
    p.classList.toggle('plan-fri', e.day === 'fri');
    p.classList.toggle('plan-sat', e.day === 'sat');
    p.classList.toggle('plan-sun', e.day === 'sun');
  }
  const notesBtn = card.querySelector<HTMLButtonElement>('[data-action="toggle-notes"]');
  if (notesBtn) notesBtn.classList.toggle('has-notes', !!(e.notes && e.notes.trim()));
  const notesText = card.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]');
  if (notesText && notesText.value !== (e.notes || '')) notesText.value = e.notes || '';

  // Shopping editor: visible whenever buy flag is on. Inner item list
  // re-rendered each sync so add/remove/check updates show immediately.
  const shopping = card.querySelector<HTMLElement>('[data-role="shopping-editor"]');
  if (shopping) {
    shopping.classList.toggle('hidden', !e.buy);
    const itemsEl = shopping.querySelector<HTMLElement>('[data-role="shopping-items"]');
    if (itemsEl) itemsEl.innerHTML = renderShoppingList(e.buyList);
  }
}

export function wireAllCards() {
  // Initial sync of every card already in the DOM.
  function syncAll() {
    for (const card of document.querySelectorAll<HTMLElement>('.card[data-slug]')) {
      syncCard(card, store.get(card.dataset.slug!));
    }
  }
  syncAll();
  store.subscribe(syncAll);

  // Event delegation — handles clicks on ANY card with [data-slug], including
  // cards cloned into the search-results panel. Listeners are attached once
  // to document, so clones work without re-wiring.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const card = btn.closest<HTMLElement>('.card[data-slug]');
    if (!card) return;
    // Don't intercept buttons inside the route plan — that view has its own
    // delegation (we don't want both to fire).
    if (btn.closest('#route-plan')) return;
    const slug = card.dataset.slug!;
    const action = btn.dataset.action;
    if (action === 'cycle-plan') store.cyclePlan(slug);
    else if (action === 'toggle-visit') store.cycleVisit(slug);
    else if (action === 'toggle-buy') store.toggleBuy(slug);
    else if (action === 'toggle-skip') store.toggleSkip(slug);
    else if (action === 'toggle-purchased') {
      const idx = parseInt(btn.dataset.idx || '-1', 10);
      if (idx >= 0) store.togglePurchased(slug, idx);
    } else if (action === 'remove-buy-item') {
      const idx = parseInt(btn.dataset.idx || '-1', 10);
      if (idx >= 0) store.removeBuyItem(slug, idx);
    } else if (action === 'toggle-notes') {
      const area = card.querySelector<HTMLElement>('[data-role="notes"]');
      area?.classList.toggle('hidden');
      if (area && !area.classList.contains('hidden')) {
        area.querySelector<HTMLTextAreaElement>('[data-role="notes-text"]')?.focus();
      }
    } else if (action === 'toggle-why') {
      card.querySelector<HTMLElement>('[data-role="why-panel"]')?.classList.toggle('hidden');
    }
  });

  // Shopping list: add item via the inline form. Submit prevents nav.
  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!form?.dataset || form.dataset.action !== 'add-buy-item') return;
    e.preventDefault();
    const card = form.closest<HTMLElement>('.card[data-slug]');
    if (!card) return;
    const input = form.querySelector<HTMLInputElement>('[data-role="shopping-input"]');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    store.addBuyItem(card.dataset.slug!, val);
    input.value = '';
    input.focus();
  });

  // Notes input delegation (also works on clones).
  const notesDebouncers = new WeakMap<HTMLTextAreaElement, ReturnType<typeof setTimeout>>();
  document.addEventListener('input', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta?.dataset || ta.dataset.role !== 'notes-text') return;
    if (ta.closest('#route-plan')) return; // route has its own handler
    const card = ta.closest<HTMLElement>('.card[data-slug]');
    if (!card) return;
    const slug = card.dataset.slug!;
    const prev = notesDebouncers.get(ta);
    if (prev) clearTimeout(prev);
    notesDebouncers.set(
      ta,
      setTimeout(() => store.setNotes(slug, ta.value), 250)
    );
  });
}
