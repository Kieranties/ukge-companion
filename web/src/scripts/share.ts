// Friend share via base64 URL fragment.
import { store, toast, type BoothEntry } from './state';

interface Slim {
  s?: 'v' | 'r';
  k?: 1;
  b?: 1;
  d?: 'f' | 's' | 'u';
  n?: string;
}

function slim(e: BoothEntry): Slim {
  const o: Slim = {};
  if (e.status === 'visited') o.s = 'v';
  if (e.status === 'revisit') o.s = 'r';
  if (e.skipped) o.k = 1;
  if (e.buy) o.b = 1;
  if (e.day === 'fri') o.d = 'f';
  if (e.day === 'sat') o.d = 's';
  if (e.day === 'sun') o.d = 'u';
  if (e.notes && e.notes.trim()) o.n = e.notes;
  return o;
}

function expand(s: Slim): BoothEntry {
  const e: BoothEntry = {};
  if (s.s === 'v') e.status = 'visited';
  if (s.s === 'r') e.status = 'revisit';
  if (s.k) e.skipped = true;
  if (s.b) e.buy = true;
  if (s.d === 'f') e.day = 'fri';
  if (s.d === 's') e.day = 'sat';
  if (s.d === 'u') e.day = 'sun';
  if (s.n) e.notes = s.n;
  return e;
}

function compact(includeNotes: boolean): Record<string, Slim> {
  const out: Record<string, Slim> = {};
  for (const [slug, e] of Object.entries(store.data)) {
    const s = slim(e);
    if (!includeNotes) delete s.n;
    if (Object.keys(s).length) out[slug] = s;
  }
  return out;
}

function encode(includeNotes: boolean): string {
  const json = JSON.stringify(compact(includeNotes));
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(token: string): Record<string, Slim> | null {
  try {
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return null;
  }
}

export function wireShare() {
  const btn = document.getElementById('share-btn');
  const modal = document.getElementById('share-modal');
  const text = document.getElementById('share-text') as HTMLTextAreaElement | null;
  const notesBox = document.getElementById('share-include-notes') as HTMLInputElement | null;
  if (!btn || !modal || !text) return;

  const update = () => {
    const url = location.origin + location.pathname + '#share=' + encode(!!notesBox?.checked);
    text.value = url;
  };
  btn.addEventListener('click', () => {
    update();
    modal.classList.add('open');
  });
  notesBox?.addEventListener('change', update);
  document.getElementById('share-close')?.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
  document.getElementById('share-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
      toast('Link copied');
    } catch {
      text.select();
      document.execCommand('copy');
      toast('Copied');
    }
  });

  handleSharedFragment();
}

function handleSharedFragment() {
  const m = location.hash.match(/share=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const payload = decode(m[1]);
  if (!payload || !Object.keys(payload).length) return;
  const modal = document.getElementById('import-modal');
  const summary = document.getElementById('import-summary');
  if (!modal || !summary) return;
  const slugs = Object.keys(payload);
  const visited = slugs.filter((s) => payload[s].s === 'v').length;
  const revisit = slugs.filter((s) => payload[s].s === 'r').length;
  const buying = slugs.filter((s) => payload[s].b).length;
  summary.textContent = `${slugs.length} stands · ${visited} visited · ${revisit} revisit · ${buying} buying`;
  modal.classList.add('open');
  const cleanHash = () => {
    const tab = location.hash.replace(/^#/, '').split('&').find((s) => !s.startsWith('share=')) || 'for-you';
    history.replaceState(null, '', '#' + tab);
  };
  const expanded: Record<string, BoothEntry> = {};
  for (const [slug, s] of Object.entries(payload)) expanded[slug] = expand(s);

  document.getElementById('import-cancel')!.onclick = () => {
    modal.classList.remove('open');
    cleanHash();
  };
  document.getElementById('import-merge')!.onclick = () => {
    const n = store.mergeIn(expanded);
    modal.classList.remove('open');
    cleanHash();
    toast(`Merged ${n} entries`);
  };
  document.getElementById('import-replace')!.onclick = () => {
    store.replaceAll(expanded);
    modal.classList.remove('open');
    cleanHash();
    toast(`Replaced with ${Object.keys(expanded).length} entries`);
  };
}
