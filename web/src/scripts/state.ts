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
const EVENT_KEY = 'ukge-companion-events-v1';
const VENDOR_OVERRIDES_KEY = 'ukge-companion-vendor-overrides-v1';

export interface EventEntry {
  /** Day codes ("fri" | "sat" | "sun") the user is attending. Empty/missing = not going. */
  attendingDays?: string[];
  /** Legacy: pre-per-day flag. Treated as "attending every day this event runs". */
  attending?: boolean;
  attendingAt?: string;
  notes?: string;
}

/** Per-vendor user overrides — currently just manually-added event IDs that
 *  weren't auto-linked by the data pipeline (event had no stand_name match,
 *  or sat in a neighbouring booth the user knows about). */
export interface VendorOverride {
  extraEventIds?: string[];
}

class StateStore {
  data: Record<string, BoothEntry>;
  events: Record<string, EventEntry>;
  vendorOverrides: Record<string, VendorOverride>;
  listeners = new Set<() => void>();

  constructor() {
    let initial: Record<string, BoothEntry> = {};
    let initialEvents: Record<string, EventEntry> = {};
    let initialOverrides: Record<string, VendorOverride> = {};
    try {
      initial = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      /* corrupt JSON */
    }
    try {
      initialEvents = JSON.parse(localStorage.getItem(EVENT_KEY) || '{}');
    } catch {
      /* corrupt JSON */
    }
    try {
      initialOverrides = JSON.parse(localStorage.getItem(VENDOR_OVERRIDES_KEY) || '{}');
    } catch {
      /* corrupt JSON */
    }
    this.data = initial;
    this.events = initialEvents;
    this.vendorOverrides = initialOverrides;
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

  // ---- events ------------------------------------------------------------

  getEvent(id: string): EventEntry {
    return this.events[id] || {};
  }

  private updateEvent(id: string, patch: EventEntry): void {
    const cur = { ...this.getEvent(id), ...patch };
    for (const k of Object.keys(cur) as (keyof EventEntry)[]) {
      if (cur[k] === undefined || cur[k] === false || cur[k] === '') delete cur[k];
    }
    if (Object.keys(cur).length === 0) delete this.events[id];
    else this.events[id] = cur;
    this.persist();
  }

  /** Is the user attending this event on the given day code? Honours the
   *  legacy `attending: true` flag as "yes on every day this event runs",
   *  so old localStorage entries keep behaving. */
  isAttendingDay(id: string, day: string): boolean {
    const e = this.getEvent(id);
    if (e.attendingDays && e.attendingDays.includes(day)) return true;
    if (e.attending) return true;
    return false;
  }

  /** True if the user is attending any day of this event. */
  isAttendingAny(id: string): boolean {
    const e = this.getEvent(id);
    if (e.attendingDays && e.attendingDays.length > 0) return true;
    if (e.attending) return true;
    return false;
  }

  /** Toggle a single day's attendance. `allEventDays` is supplied by the
   *  caller (it reads them off the rendered card) so that promoting an old
   *  `attending: true` entry first expands to "all days", then unticks the
   *  requested one — matching the mental model "I was going to all three;
   *  now skip Friday." */
  toggleAttendingDay(id: string, day: string, allEventDays: string[]): void {
    const e = this.getEvent(id);
    let cur: string[];
    if (e.attendingDays) cur = [...e.attendingDays];
    else if (e.attending) cur = [...allEventDays];
    else cur = [];
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day];
    this.updateEvent(id, {
      attendingDays: next.length ? next : undefined,
      attending: undefined, // drop legacy once the user touches it
      attendingAt: e.attendingAt || new Date().toISOString(),
    });
  }

  setEventNotes(id: string, notes: string): void {
    this.updateEvent(id, { notes: notes.trim() ? notes : undefined });
  }

  // ---- vendor overrides ---------------------------------------------------

  getVendorOverride(slug: string): VendorOverride {
    return this.vendorOverrides[slug] || {};
  }

  /** Returns the user-added extra event IDs for this vendor, in insertion order. */
  getExtraEventIds(slug: string): string[] {
    return this.getVendorOverride(slug).extraEventIds || [];
  }

  addVendorEventOverride(slug: string, eventId: string): void {
    const cur = this.getExtraEventIds(slug);
    if (cur.includes(eventId)) return;
    this.vendorOverrides[slug] = { ...this.getVendorOverride(slug), extraEventIds: [...cur, eventId] };
    this.persist();
  }

  removeVendorEventOverride(slug: string, eventId: string): void {
    const cur = this.getExtraEventIds(slug);
    if (!cur.includes(eventId)) return;
    const next = cur.filter((id) => id !== eventId);
    if (next.length) {
      this.vendorOverrides[slug] = { ...this.getVendorOverride(slug), extraEventIds: next };
    } else {
      delete this.vendorOverrides[slug];
    }
    this.persist();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      localStorage.setItem(EVENT_KEY, JSON.stringify(this.events));
      localStorage.setItem(VENDOR_OVERRIDES_KEY, JSON.stringify(this.vendorOverrides));
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
