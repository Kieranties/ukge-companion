// Local plan state — persisted to localStorage. One source of truth for
// visited/buy/skip/day/notes across every booth card on the page.
// All values are optional; absence means "default".
//
// `day` is the plan state. Possible values:
//   undefined  – not planned. Booth doesn't appear in the route.
//   'any'      – planned but no specific day. Appears in the route every day.
//   'fri' | 'sat' | 'sun' – planned for that day.
export type PlanDay = 'any' | 'fri' | 'sat' | 'sun';
export interface BuyItem {
  name: string;
  /** Expected/actual price in GBP. Optional — items without a price contribute zero to totals. */
  price?: number;
  purchased?: boolean;
  addedAt?: string;
  purchasedAt?: string;
}
export interface BoothEntry {
  status?: 'visited' | 'revisit';
  /** Internally still named `skipped`, but the user-facing label is "hidden". */
  skipped?: boolean;
  buy?: boolean;
  /** Specific games the user wants to buy from this booth. */
  buyList?: BuyItem[];
  day?: PlanDay;
  notes?: string;
  visitedAt?: string;
  revisitAt?: string;
  skippedAt?: string;
  buyAt?: string;
  dayAt?: string;
}

const KEY = 'ukge-companion-state-v1';

class StateStore {
  data: Record<string, BoothEntry>;
  listeners = new Set<() => void>();

  constructor() {
    let initial: Record<string, BoothEntry> = {};
    try {
      initial = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      /* corrupt JSON */
    }
    this.data = initial;
  }

  get(slug: string): BoothEntry {
    return this.data[slug] || {};
  }

  update(slug: string, patch: BoothEntry): void {
    const cur = { ...this.get(slug), ...patch };
    // Drop empty fields so the JSON stays compact.
    for (const k of Object.keys(cur) as (keyof BoothEntry)[]) {
      if (cur[k] === undefined || cur[k] === false || cur[k] === '') delete cur[k];
    }
    if (Object.keys(cur).length === 0) delete this.data[slug];
    else this.data[slug] = cur;
    this.persist();
  }

  cycleVisit(slug: string): void {
    const e = this.get(slug);
    if (!e.status) {
      this.update(slug, { status: 'visited', visitedAt: new Date().toISOString(), skipped: false });
    } else if (e.status === 'visited') {
      this.update(slug, { status: 'revisit', revisitAt: new Date().toISOString() });
    } else {
      this.update(slug, { status: undefined, visitedAt: undefined, revisitAt: undefined });
    }
  }

  toggleBuy(slug: string): void {
    const e = this.get(slug);
    if (e.buy) this.update(slug, { buy: undefined, buyAt: undefined });
    else this.update(slug, { buy: true, buyAt: new Date().toISOString(), skipped: false });
  }

  toggleSkip(slug: string): void {
    const e = this.get(slug);
    if (e.skipped) this.update(slug, { skipped: undefined, skippedAt: undefined });
    else this.update(slug, { skipped: true, skippedAt: new Date().toISOString(), status: undefined, buy: undefined });
  }

  setDay(slug: string, day: PlanDay | undefined): void {
    const e = this.get(slug);
    if (e.day === day) this.update(slug, { day: undefined, dayAt: undefined });
    else this.update(slug, { day, dayAt: new Date().toISOString() });
  }

  /**
   * Cycle through plan states for the booth's "Add to plan" button:
   *   undefined  → 'any'  → 'fri' → 'sat' → 'sun' → undefined
   */
  cyclePlan(slug: string): void {
    const e = this.get(slug);
    const order: (PlanDay | undefined)[] = [undefined, 'any', 'fri', 'sat', 'sun'];
    const idx = order.indexOf(e.day);
    const next = order[(idx + 1) % order.length];
    if (next === undefined) {
      this.update(slug, { day: undefined, dayAt: undefined });
    } else {
      this.update(slug, { day: next, dayAt: new Date().toISOString() });
    }
  }

  setNotes(slug: string, notes: string): void {
    this.update(slug, { notes: notes.trim() ? notes : undefined });
  }

  addBuyItem(slug: string, name: string, price?: number): void {
    const clean = name.trim();
    if (!clean) return;
    const e = this.get(slug);
    const item: BuyItem = { name: clean, addedAt: new Date().toISOString() };
    if (typeof price === 'number' && !Number.isNaN(price)) item.price = price;
    const next = [...(e.buyList || []), item];
    this.update(slug, { buyList: next, buy: true, buyAt: e.buyAt || new Date().toISOString(), skipped: false });
  }

  setBuyItemPrice(slug: string, idx: number, price: number | undefined): void {
    const e = this.get(slug);
    const list = e.buyList ? [...e.buyList] : [];
    if (idx < 0 || idx >= list.length) return;
    const cur = { ...list[idx] };
    if (price === undefined || Number.isNaN(price)) delete cur.price;
    else cur.price = price;
    list[idx] = cur;
    this.update(slug, { buyList: list });
  }

  togglePurchased(slug: string, idx: number): void {
    const e = this.get(slug);
    const list = e.buyList ? [...e.buyList] : [];
    if (idx < 0 || idx >= list.length) return;
    const cur = list[idx];
    const nextPurchased = !cur.purchased;
    list[idx] = {
      ...cur,
      purchased: nextPurchased,
      purchasedAt: nextPurchased ? new Date().toISOString() : undefined,
    };
    this.update(slug, { buyList: list });
  }

  removeBuyItem(slug: string, idx: number): void {
    const e = this.get(slug);
    if (!e.buyList) return;
    const list = e.buyList.filter((_, i) => i !== idx);
    this.update(slug, { buyList: list.length ? list : undefined });
  }

  replaceAll(payload: Record<string, BoothEntry>): void {
    this.data = { ...payload };
    this.persist();
  }

  mergeIn(payload: Record<string, BoothEntry>): number {
    let n = 0;
    for (const [slug, fresh] of Object.entries(payload)) {
      const existing = this.data[slug];
      if (!existing || Object.keys(existing).length === 0) {
        this.data[slug] = fresh;
        n++;
      } else {
        // Only fill blanks — never overwrite.
        let touched = false;
        for (const k of Object.keys(fresh) as (keyof BoothEntry)[]) {
          if (existing[k] === undefined) {
            (existing as any)[k] = (fresh as any)[k];
            touched = true;
          }
        }
        if (touched) n++;
      }
    }
    this.persist();
    return n;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      toast('Storage failed — notes may not persist');
    }
    for (const fn of this.listeners) fn();
  }
}

export const store = new StateStore();

// Tiny global toast — keeps state.ts self-contained.
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}
