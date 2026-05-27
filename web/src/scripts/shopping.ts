// Shopping tab — aggregates all booths the user has flagged for buying.
// Each booth shows its specific shopping list (if any) with check-off and
// remove controls. Empty booths surface as "no specific items yet" so the
// user can still see the visit is on their shopping route.
//
// Rendering is full re-render on every state change (cheap — usually < 30
// entries). Interaction goes through a single delegated click + submit
// handler at the panel root.
import { store, type BoothEntry, type BuyItem } from './state';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

interface BoothInfo {
  name: string;
  hall: string;
  stand: string;
  url: string;
}

function readBoothInfo(slug: string): BoothInfo | null {
  const card = document.querySelector<HTMLElement>(`.card[data-slug="${CSS.escape(slug)}"]`);
  if (!card) return null;
  const a = card.querySelector<HTMLAnchorElement>('.card-title h3 a, .card-title h4 a');
  return {
    name: a?.textContent?.trim() || card.dataset.name || slug,
    hall: card.dataset.hall || '',
    stand: card.dataset.stand || '',
    url: a?.href || '#',
  };
}

function renderItems(items: BuyItem[] | undefined, slug: string): string {
  if (!items || items.length === 0) {
    return '<p class="shop-no-items">No specific items yet — add one below or remove this stand from the shopping list.</p>';
  }
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      // unpurchased first, then purchased
      if (!!a.it.purchased === !!b.it.purchased) return 0;
      return a.it.purchased ? 1 : -1;
    });
  return `<ul class="shop-items">
    ${sorted.map(({ it, i }) => `<li class="shop-item${it.purchased ? ' purchased' : ''}">
      <button class="shopping-check" data-action="toggle-purchased" data-slug="${esc(slug)}" data-idx="${i}" type="button" aria-label="${it.purchased ? 'Mark as not purchased' : 'Mark as purchased'}">${it.purchased ? '✓' : ''}</button>
      <span class="shop-item-name">${esc(it.name)}</span>
      <button class="shopping-remove" data-action="remove-buy-item" data-slug="${esc(slug)}" data-idx="${i}" type="button" aria-label="Remove ${esc(it.name)}">×</button>
    </li>`).join('')}
  </ul>`;
}

export function buildShopping() {
  const root = document.getElementById('shopping-list');
  const tabBadge = document.querySelector<HTMLElement>('.tab[data-tab="shopping"] .badge');
  if (!root) return;

  // Booths the user has flagged for buying OR has any items listed for.
  const entries: [string, BoothEntry][] = Object.entries(store.data).filter(
    ([, e]) => e.buy || (e.buyList && e.buyList.length > 0)
  );

  // Sort by hall + stand (alphabetical fallback) so walking is intuitive.
  entries.sort(([slugA], [slugB]) => {
    const a = readBoothInfo(slugA);
    const b = readBoothInfo(slugB);
    const hallCmp = (a?.hall || '').localeCompare(b?.hall || '');
    if (hallCmp !== 0) return hallCmp;
    return (a?.stand || '').localeCompare(b?.stand || '');
  });

  // Badge: unpurchased item count; if zero, fall back to booth count.
  let unpurchased = 0;
  let totalItems = 0;
  for (const [, e] of entries) {
    for (const it of e.buyList || []) {
      totalItems++;
      if (!it.purchased) unpurchased++;
    }
  }
  if (tabBadge) {
    if (unpurchased > 0) {
      tabBadge.textContent = String(unpurchased);
      tabBadge.classList.remove('hidden');
    } else if (entries.length > 0) {
      tabBadge.textContent = String(entries.length);
      tabBadge.classList.remove('hidden');
    } else {
      tabBadge.classList.add('hidden');
    }
  }

  if (entries.length === 0) {
    root.innerHTML = `<div class="route-empty">
      Your shopping list is empty. Tap <em>🛒 Buy</em> on any exhibitor card to flag them; add specific games right there and they'll appear here.
    </div>`;
    return;
  }

  // Summary line.
  let html = `<p class="shop-summary">`;
  if (totalItems === 0) {
    html += `<strong>${entries.length}</strong> stand${entries.length === 1 ? '' : 's'} flagged — no specific items yet.`;
  } else {
    html += `<strong>${unpurchased}</strong> to buy · <strong>${totalItems - unpurchased}</strong> picked up · across <strong>${entries.length}</strong> stand${entries.length === 1 ? '' : 's'}.`;
  }
  html += `</p>`;

  // One booth = one card-like block.
  for (const [slug, e] of entries) {
    const info = readBoothInfo(slug);
    if (!info) continue;
    const standLink = info.stand
      ? `<a class="stand" href="https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/map/#${esc(info.stand)}" target="_blank" rel="noopener" title="Find ${esc(info.stand)} on the UKGE map">${esc(info.stand)}</a>`
      : '';
    html += `<section class="shop-booth" data-slug="${esc(slug)}">
      <header class="shop-booth-head">
        <h3><a href="${esc(info.url)}" target="_blank" rel="noopener">${esc(info.name)}</a></h3>
        <div class="shop-booth-loc">
          <span class="hall">${esc(info.hall)}</span>
          ${standLink}
          <button class="shop-clear-booth" data-action="clear-booth" data-slug="${esc(slug)}" type="button" title="Remove this stand from the shopping list">Remove stand</button>
        </div>
      </header>
      ${renderItems(e.buyList, slug)}
      <form class="shopping-add shop-add" data-action="add-buy-item-shop" data-slug="${esc(slug)}">
        <input type="text" data-role="shopping-input" placeholder="Add a game to buy from ${esc(info.name)}…" />
        <button type="submit" class="shopping-add-btn">+ Add</button>
      </form>
    </section>`;
  }

  root.innerHTML = html;
}

export function wireShopping() {
  const panel = document.querySelector<HTMLElement>('.panel[data-panel="shopping"]');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const slug = btn.dataset.slug;
    if (!slug) return;
    if (action === 'toggle-purchased') {
      const idx = parseInt(btn.dataset.idx || '-1', 10);
      if (idx >= 0) store.togglePurchased(slug, idx);
    } else if (action === 'remove-buy-item') {
      const idx = parseInt(btn.dataset.idx || '-1', 10);
      if (idx >= 0) store.removeBuyItem(slug, idx);
    } else if (action === 'clear-booth') {
      // Drop the buy flag and any items in one go.
      store.update(slug, { buy: undefined, buyAt: undefined, buyList: undefined });
    }
  });

  panel.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!form?.dataset || form.dataset.action !== 'add-buy-item-shop') return;
    e.preventDefault();
    const slug = form.dataset.slug;
    const input = form.querySelector<HTMLInputElement>('[data-role="shopping-input"]');
    if (!slug || !input) return;
    const val = input.value.trim();
    if (!val) return;
    store.addBuyItem(slug, val);
    input.value = '';
    input.focus();
  });

  store.subscribe(buildShopping);
  buildShopping();
}
