// Local plan state — persisted to localStorage. One source of truth for
// visited/buy/skip/day/notes across every booth card on the page.
// All values are optional; absence means "default".
export interface BoothEntry {
  status?: 'visited' | 'revisit';
  skipped?: boolean;
  buy?: boolean;
  day?: 'fri' | 'sat' | 'sun';
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

  setDay(slug: string, day: 'fri' | 'sat' | 'sun' | undefined): void {
    const e = this.get(slug);
    if (e.day === day) this.update(slug, { day: undefined, dayAt: undefined });
    else this.update(slug, { day, dayAt: new Date().toISOString() });
  }

  setNotes(slug: string, notes: string): void {
    this.update(slug, { notes: notes.trim() ? notes : undefined });
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
