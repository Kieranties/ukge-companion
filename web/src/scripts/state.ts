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
const LIBRARY_KEY = 'ukge-companion-library-v1';
const PLAY_LOG_KEY = 'ukge-companion-play-log-v1';

export interface LibraryEntry {
  /** Stable id so re-renders don't shift index-based ops underneath the user. */
  id: string;
  name: string;
  played?: boolean;
  notes?: string;
  addedAt?: string;
  playedAt?: string;
}

function newLibraryId(): string {
  // crypto.randomUUID exists on every modern browser in a secure context (we
  // ship over https) — fall back to a timestamp + random suffix on the off
  // chance an old webview hits this code.
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

/** A single recorded play at the show. Free-form: works for library games
 *  (with `libraryId` linking back to the LibraryEntry), games brought from
 *  home, and opportunistic plays in open gaming. */
export interface PlaySession {
  id: string;
  gameName: string;
  /** ISO timestamp of when the entry was logged. Used for sort and the
   *  day chip ("Fri" etc.) on the row. */
  playedAt?: string;
  /** Free-text who-was-there field. */
  withWho?: string;
  /** 1–5, quick post-play rating. Absent = not rated. */
  rating?: number;
  notes?: string;
  /** Set when this session was auto-created by marking a Library entry as
   *  played, so the two stay linked (and toggling played-off can clean up). */
  libraryId?: string;
}

class StateStore {
  data: Record<string, BoothEntry>;
  events: Record<string, EventEntry>;
  vendorOverrides: Record<string, VendorOverride>;
  library: LibraryEntry[];
  playLog: PlaySession[];
  listeners = new Set<() => void>();

  constructor() {
    let initial: Record<string, BoothEntry> = {};
    let initialEvents: Record<string, EventEntry> = {};
    let initialOverrides: Record<string, VendorOverride> = {};
    let initialLibrary: LibraryEntry[] = [];
    let initialPlayLog: PlaySession[] = [];
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
    try {
      const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
      if (Array.isArray(raw)) initialLibrary = raw.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string');
    } catch {
      /* corrupt JSON */
    }
    try {
      const raw = JSON.parse(localStorage.getItem(PLAY_LOG_KEY) || '[]');
      if (Array.isArray(raw)) initialPlayLog = raw.filter((x) => x && typeof x.id === 'string' && typeof x.gameName === 'string');
    } catch {
      /* corrupt JSON */
    }
    this.data = initial;
    this.events = initialEvents;
    this.vendorOverrides = initialOverrides;
    this.library = initialLibrary;
    this.playLog = initialPlayLog;
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

  // ---- library -----------------------------------------------------------

  addLibraryGame(name: string): string | null {
    const clean = name.trim();
    if (!clean) return null;
    // Dedupe by case-insensitive name so re-adding "Wingspan" doesn't pile up.
    const existing = this.library.find((g) => g.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    const id = newLibraryId();
    this.library = [...this.library, { id, name: clean, addedAt: new Date().toISOString() }];
    this.persist();
    return id;
  }

  togglePlayedLibrary(id: string): void {
    const idx = this.library.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const cur = this.library[idx];
    const nextPlayed = !cur.played;
    const now = new Date().toISOString();
    this.library = this.library.map((g, i) => (i === idx
      ? { ...g, played: nextPlayed || undefined, playedAt: nextPlayed ? now : undefined }
      : g));
    // When marking played, mirror an entry into the play log so the user can
    // attach who-played-with + post-play notes. When unmarking, remove only
    // the auto-created session — leave any manually-edited one as a record.
    if (nextPlayed) {
      const existing = this.playLog.find((s) => s.libraryId === id);
      if (!existing) {
        this.playLog = [
          ...this.playLog,
          { id: newLibraryId(), gameName: cur.name, playedAt: now, libraryId: id },
        ];
      }
    } else {
      const auto = this.playLog.find(
        (s) => s.libraryId === id && !s.withWho && !s.notes
      );
      if (auto) this.playLog = this.playLog.filter((s) => s.id !== auto.id);
    }
    this.persist();
  }

  setLibraryNotes(id: string, notes: string): void {
    const idx = this.library.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const trimmed = notes.trim();
    this.library = this.library.map((g, i) => (i === idx
      ? { ...g, notes: trimmed ? notes : undefined }
      : g));
    this.persist();
  }

  removeLibraryGame(id: string): void {
    const next = this.library.filter((g) => g.id !== id);
    if (next.length === this.library.length) return;
    this.library = next;
    this.persist();
  }

  // ---- play log ----------------------------------------------------------

  addPlaySession(gameName: string): string | null {
    const clean = gameName.trim();
    if (!clean) return null;
    const id = newLibraryId();
    this.playLog = [
      ...this.playLog,
      { id, gameName: clean, playedAt: new Date().toISOString() },
    ];
    this.persist();
    return id;
  }

  updatePlaySession(id: string, patch: Partial<PlaySession>): void {
    const idx = this.playLog.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const cur = this.playLog[idx];
    const merged: PlaySession = { ...cur, ...patch };
    // Drop empty optional fields so the JSON stays compact.
    if (!merged.withWho || !merged.withWho.trim()) delete merged.withWho;
    if (!merged.notes || !merged.notes.trim()) delete merged.notes;
    if (!merged.rating || merged.rating < 1) delete merged.rating;
    this.playLog = this.playLog.map((s, i) => (i === idx ? merged : s));
    this.persist();
  }

  removePlaySession(id: string): void {
    const next = this.playLog.filter((s) => s.id !== id);
    if (next.length === this.playLog.length) return;
    // If this session was linked to a library entry, clear the library's
    // played flag so the two views agree.
    const removed = this.playLog.find((s) => s.id === id);
    if (removed?.libraryId) {
      const lid = removed.libraryId;
      this.library = this.library.map((g) => (g.id === lid
        ? { ...g, played: undefined, playedAt: undefined }
        : g));
    }
    this.playLog = next;
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
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(this.library));
      localStorage.setItem(PLAY_LOG_KEY, JSON.stringify(this.playLog));
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
