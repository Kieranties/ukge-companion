// Shopping tab — aggregates all booths the user has flagged for buying.
// Each booth shows its specific shopping list (if any) with check-off and
// remove controls. Empty booths surface as "no specific items yet" so the
// user can still see the visit is on their shopping route.
//
// Rendering is full re-render on every state change (cheap — usually < 30
// entries). Interaction goes through a single delegated click + submit
// handler at the panel root.
import { store, type BoothEntry, type BuyItem } from './state';
import { parsePrice, formatPrice } from './cards';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function priceInputValue(price?: number): string {
  return typeof price === 'number' ? price.toFixed(2) : '';
}

interface BoothTotals {
  planned: number;
  spent: number;
  unpriced: number;
  totalItems: number;
  unpurchasedPriced: number;
}

function totalsFor(items: BuyItem[] | undefined): BoothTotals {
  const t: BoothTotals = { planned: 0, spent: 0, unpriced: 0, totalItems: 0, unpurchasedPriced: 0 };
  for (const it of items || []) {
    t.totalItems++;
    if (typeof it.price === 'number') {
      t.planned += it.price;
      if (it.purchased) t.spent += it.price;
      else t.unpurchasedPriced += it.price;
    } else {
      t.unpriced++;
    }
  }
  return t;
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
  const t = totalsFor(items);
  const subtotalBits: string[] = [];
  if (t.planned > 0) {
    if (t.spent > 0 && t.spent < t.planned) {
      subtotalBits.push(`${formatPrice(t.spent)} spent · ${formatPrice(t.planned - t.spent)} to go`);
    } else if (t.spent >= t.planned) {
      subtotalBits.push(`${formatPrice(t.spent)} spent`);
    } else {
      subtotalBits.push(`${formatPrice(t.planned)} planned`);
    }
  }
  if (t.unpriced > 0) subtotalBits.push(`${t.unpriced} unpriced`);
  const subtotal = subtotalBits.length ? `<div class="shop-subtotal">${subtotalBits.join(' · ')}</div>` : '';
  return `<ul class="shop-items">
    ${sorted.map(({ it, i }) => `<li class="shop-item${it.purchased ? ' purchased' : ''}">
      <button class="shopping-check" data-action="toggle-purchased" data-slug="${esc(slug)}" data-idx="${i}" type="button" aria-label="${it.purchased ? 'Mark as not purchased' : 'Mark as purchased'}">${it.purchased ? '✓' : ''}</button>
      <span class="shop-item-name">${esc(it.name)}</span>
      <input class="shopping-price" data-action="set-price" data-slug="${esc(slug)}" data-idx="${i}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="£" aria-label="Price in GBP" value="${priceInputValue(it.price)}" />
      <button class="shopping-remove" data-action="remove-buy-item" data-slug="${esc(slug)}" data-idx="${i}" type="button" aria-label="Remove ${esc(it.name)}">×</button>
    </li>`).join('')}
  </ul>${subtotal}`;
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
  let totalPlanned = 0;
  let totalSpent = 0;
  let totalUnpriced = 0;
  for (const [, e] of entries) {
    const t = totalsFor(e.buyList);
    unpurchased += t.totalItems - (e.buyList || []).filter((it) => it.purchased).length;
    totalItems += t.totalItems;
    totalPlanned += t.planned;
    totalSpent += t.spent;
    totalUnpriced += t.unpriced;
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
  if (totalPlanned > 0 || totalUnpriced > 0) {
    const remaining = totalPlanned - totalSpent;
    const bits: string[] = [];
    if (totalPlanned > 0) {
      bits.push(`<strong>${formatPrice(totalPlanned)}</strong> planned`);
      if (totalSpent > 0) bits.push(`<strong>${formatPrice(totalSpent)}</strong> spent`);
      if (remaining > 0) bits.push(`<strong>${formatPrice(remaining)}</strong> to go`);
    }
    if (totalUnpriced > 0) bits.push(`<span class="shop-summary-unpriced">${totalUnpriced} unpriced</span>`);
    html += `<p class="shop-summary shop-summary-money">${bits.join(' · ')}</p>`;
  }

  // One booth = one card-like block.
  for (const [slug, e] of entries) {
    const info = readBoothInfo(slug);
    if (!info) continue;
    const standLink = info.stand
      ? `<a class="stand" href="https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/map/#${esc(info.stand)}" target="_blank" rel="noopener" title="Find ${esc(info.stand)} on the UKGE map">${esc(info.stand)}</a>`
      : '';
    html += `<section class="shop-booth" data-slug="${esc(slug)}">
      <header class="shop-booth-head">
        <h3><a href="${esc(info.url)}" target="_blank" rel="noopener" data-action="open-vendor-card" data-vendor-slug="${esc(slug)}" title="Open ${esc(info.name)} in app">${esc(info.name)}</a></h3>
        <div class="shop-booth-loc">
          <span class="hall">${esc(info.hall)}</span>
          ${standLink}
          <button class="shop-clear-booth" data-action="clear-booth" data-slug="${esc(slug)}" type="button" title="Remove this stand from the shopping list">Remove stand</button>
        </div>
      </header>
      ${renderItems(e.buyList, slug)}
      <form class="shopping-add shop-add" data-action="add-buy-item-shop" data-slug="${esc(slug)}">
        <input type="text" data-role="shopping-input" placeholder="Add a game to buy from ${esc(info.name)}…" />
        <input type="number" data-role="shopping-price" class="shopping-price" placeholder="£" step="0.01" min="0" inputmode="decimal" aria-label="Price in GBP" />
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
    const priceInput = form.querySelector<HTMLInputElement>('[data-role="shopping-price"]');
    const price = parsePrice(priceInput?.value);
    store.addBuyItem(slug, val, price);
    input.value = '';
    if (priceInput) priceInput.value = '';
    input.focus();
  });

  // Per-item price edit. `change` fires on blur/Enter, so by the time the
  // store updates and triggers a re-render the user is no longer focused.
  panel.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input?.dataset || input.dataset.action !== 'set-price') return;
    const slug = input.dataset.slug;
    const idx = parseInt(input.dataset.idx || '-1', 10);
    if (!slug || idx < 0) return;
    store.setBuyItemPrice(slug, idx, parsePrice(input.value));
  });

  store.subscribe(buildShopping);
  buildShopping();
}
