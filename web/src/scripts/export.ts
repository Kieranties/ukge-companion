// Markdown export — gathers state + card metadata into shareable text.
import { store, toast } from './state';

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
  const buying = Object.entries(store.data).filter(([, v]) => v.buy);
  if (buying.length) {
    lines.push('## 🛒 Buy list');
    for (const [slug, v] of buying) {
      const i = lookup(slug);
      lines.push(`- **${i.name}** — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  const dayLabels: Record<string, string> = { any: 'Any day', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  for (const d of ['any', 'fri', 'sat', 'sun']) {
    const items = Object.entries(store.data).filter(([, v]) => v.day === d && !v.skipped);
    if (!items.length) continue;
    lines.push(`## ${dayLabels[d]} plan`);
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
  const skipped = Object.entries(store.data).filter(([, v]) => v.skipped);
  if (skipped.length) {
    lines.push('## Skipped');
    for (const [slug, v] of skipped) {
      const i = lookup(slug);
      lines.push(`- ${i.name} — ${i.hall} ${i.stand}`);
      if (v.notes && v.notes.trim()) for (const ln of v.notes.split(/\r?\n/)) lines.push(`  - ${ln}`);
    }
    lines.push('');
  }
  // Any stand with notes that didn't appear in a section above — pure-notes
  // entries would otherwise be silently dropped from the export.
  const seenSlugs = new Set([...visited, ...revisit, ...buying, ...skipped].map(([s]) => s));
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
  if (
    visited.length === 0 &&
    revisit.length === 0 &&
    buying.length === 0 &&
    skipped.length === 0 &&
    notesOnly.length === 0
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
