// Markdown export — gathers state + card metadata into shareable text.
import { store, toast } from './state';
import { formatPrice } from './cards';

function lookup(slug: string) {
  const card = document.querySelector<HTMLElement>(`.card[data-slug="${CSS.escape(slug)}"]`);
  if (!card) return { name: slug, hall: '', stand: '' };
  return {
    name: card.dataset.name || slug,
    hall: card.dataset.hall || '',
    stand: card.dataset.stand || '',
  };
}

function buildMarkdown(): string {
  const lines: string[] = [];
  lines.push('# UK Games Expo 2026 — my plan');
  lines.push('');
  lines.push(`*Generated ${new Date().toLocaleString()}*`);
  lines.push('');
  const visited = Object.entries(store.data).filter(([, v]) => v.status === 'visited');
  if (visited.length) {
    lines.push('## Visited stands');
    for (const [slug, v] of visited) {
      const i = lookup(slug);
      lines.push(`- **${i.name}** — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const revisit = Object.entries(store.data).filter(([, v]) => v.status === 'revisit');
  if (revisit.length) {
    lines.push('## Visit again ★');
    for (const [slug, v] of revisit) {
      const i = lookup(slug);
      lines.push(`- **${i.name}** — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const buying = Object.entries(store.data).filter(([, v]) => v.buy || (v.buyList && v.buyList.length));
  let totalPlanned = 0;
  let totalSpent = 0;
  let totalUnpriced = 0;
  if (buying.length) {
    lines.push('## 🛒 Shopping list');
    for (const [slug, v] of buying) {
      const i = lookup(slug);
      lines.push(`- **${i.name}** — ${i.hall} ${i.stand}`);
      let boothPlanned = 0;
      let boothSpent = 0;
      let boothUnpriced = 0;
      for (const item of v.buyList || []) {
        const tick = item.purchased ? '[x]' : '[ ]';
        const price = typeof item.price === 'number' ? ` — ${formatPrice(item.price)}` : '';
        lines.push(`  - ${tick} ${item.name}${price}`);
        if (typeof item.price === 'number') {
          boothPlanned += item.price;
          if (item.purchased) boothSpent += item.price;
        } else {
          boothUnpriced++;
        }
      }
      if (boothPlanned > 0 || boothUnpriced > 0) {
        const bits: string[] = [];
        if (boothPlanned > 0) {
          bits.push(`${formatPrice(boothPlanned)} planned`);
          if (boothSpent > 0) bits.push(`${formatPrice(boothSpent)} spent`);
        }
        if (boothUnpriced > 0) bits.push(`${boothUnpriced} unpriced`);
        lines.push(`  - _Subtotal: ${bits.join(' · ')}_`);
      }
      totalPlanned += boothPlanned;
      totalSpent += boothSpent;
      totalUnpriced += boothUnpriced;
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    if (totalPlanned > 0 || totalUnpriced > 0) {
      const remaining = totalPlanned - totalSpent;
      const bits: string[] = [];
      if (totalPlanned > 0) {
        bits.push(`${formatPrice(totalPlanned)} planned`);
        if (totalSpent > 0) bits.push(`${formatPrice(totalSpent)} spent`);
        if (remaining > 0) bits.push(`${formatPrice(remaining)} to go`);
      }
      if (totalUnpriced > 0) bits.push(`${totalUnpriced} unpriced`);
      lines.push('');
      lines.push(`**Total: ${bits.join(' · ')}**`);
    }
    lines.push('');
  }
  const dayLabels: Record<string, string> = { any: 'Any day', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  // Pre-collect attending events for each specific day. Read metadata off
  // the rendered .event-card so the export uses the same source of truth
  // as the rest of the app.
  function attendingEventsFor(day: string): Array<{ id: string; title: string; time: string; category: string; exhibitor: string; notes?: string; timeKey: [number, number] }> {
    const out = [];
    for (const id of Object.keys(store.events)) {
      if (!store.isAttendingDay(id, day)) continue;
      const card = document.querySelector<HTMLElement>(`.event-card[data-event-id="${CSS.escape(id)}"]`);
      if (!card) continue;
      const days = (card.dataset.days || '').split(/\s+/);
      if (!days.includes(day)) continue;
      const time = card.dataset.time || '';
      const m = time.match(/(\d{1,2})[:.](\d{2})/);
      out.push({
        id,
        title: card.dataset.title || '',
        time,
        category: card.dataset.category || '',
        exhibitor: card.dataset.exhibitorName || '',
        notes: store.getEvent(id).notes,
        timeKey: m ? [parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number] : [99, 99] as [number, number],
      });
    }
    out.sort((a, b) => a.timeKey[0] - b.timeKey[0] || a.timeKey[1] - b.timeKey[1] || a.title.localeCompare(b.title));
    return out;
  }

  for (const d of ['any', 'fri', 'sat', 'sun']) {
    const items = Object.entries(store.data).filter(([, v]) => v.day === d && !v.skipped);
    const events = d === 'any' ? [] : attendingEventsFor(d);
    if (!items.length && !events.length) continue;
    lines.push(`## ${dayLabels[d]} plan`);
    if (events.length) {
      lines.push(`### 📅 Events (${events.length})`);
      for (const ev of events) {
        const where = ev.exhibitor ? ` — at **${ev.exhibitor}**` : '';
        const cat = ev.category ? ` _(${ev.category})_` : '';
        lines.push(`- **${ev.time || '—'}** ${ev.title}${where}${cat}`);
        if (ev.notes && ev.notes.trim()) for (const ln of ev.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
      }
      if (items.length) {
        lines.push('');
        lines.push(`### 🏪 Stands (${items.length})`);
      }
    }
    for (const [slug, v] of items) {
      const i = lookup(slug);
      const tags = [
        v.status === 'visited' ? '✓' : v.status === 'revisit' ? '★' : '',
        v.buy ? '🛒' : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`- ${tags || '·'} ${i.name} — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const libToPlay = store.library.filter((g) => !g.played);
  const libPlayed = store.library.filter((g) => g.played);
  if (libToPlay.length || libPlayed.length) {
    lines.push('## 🎲 Library');
    for (const g of libToPlay) {
      lines.push(`- [ ] ${g.name}`);
      if (g.notes && g.notes.trim()) for (const ln of g.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    for (const g of libPlayed) {
      lines.push(`- [x] ${g.name}`);
      if (g.notes && g.notes.trim()) for (const ln of g.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  if (store.playLog.length) {
    lines.push('## 🃏 Played');
    const sorted = [...store.playLog].sort((a, b) => (a.playedAt || '').localeCompare(b.playedAt || ''));
    for (const s of sorted) {
      const when = s.playedAt ? ` _(${new Date(s.playedAt).toLocaleString()})_` : '';
      lines.push(`- **${s.gameName}**${when}`);
      if (s.notes && s.notes.trim()) for (const ln of s.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const hidden = Object.entries(store.data).filter(([, v]) => v.skipped);
  if (hidden.length) {
    lines.push('## Hidden');
    for (const [slug, v] of hidden) {
      const i = lookup(slug);
      lines.push(`- ${i.name} — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  // Any stand with notes that didn't appear in a section above — pure-notes
  // entries would otherwise be silently dropped from the export.
  const seenSlugs = new Set([...visited, ...revisit, ...buying, ...hidden].map(([s]) => s));
  const notesOnly = Object.entries(store.data).filter(
    ([slug, v]) => v.notes && v.notes.trim() && !seenSlugs.has(slug)
  );
  if (notesOnly.length) {
    lines.push('## Notes');
    for (const [slug, v] of notesOnly) {
      const i = lookup(slug);
      lines.push(`- **${i.name}** — ${i.hall} ${i.stand}`);
      for (const ln of v.notes!.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const anyEventTracked = Object.keys(store.events).some(
    (id) => store.isAttendingAny(id) || (store.getEvent(id).notes || '').trim()
  );
  if (
    visited.length === 0 &&
    revisit.length === 0 &&
    buying.length === 0 &&
    hidden.length === 0 &&
    notesOnly.length === 0 &&
    !anyEventTracked &&
    store.library.length === 0 &&
    store.playLog.length === 0
  ) {
    lines.push('*Nothing tracked yet.*');
  }
  return lines.join('\n');
}

export function wireExport() {
  const btn = document.getElementById('export-btn');
  const modal = document.getElementById('export-modal');
  const text = document.getElementById('export-text') as HTMLTextAreaElement | null;
  if (!btn || !modal || !text) return;
  btn.addEventListener('click', () => {
    text.value = buildMarkdown();
    modal.classList.add('open');
  });
  document.getElementById('export-close')?.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
  document.getElementById('export-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      toast('Copied to clipboard');
    } catch {
      text.select();
      document.execCommand('copy');
      toast('Copied');
    }
  });
}
