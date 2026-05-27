// Theme toggle. Picks system preference unless the user has set one.
const KEY = 'ukge-companion-theme';

export function applyTheme(t: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', t);
  const ico = document.getElementById('theme-ico');
  const lbl = document.getElementById('theme-label');
  if (ico) ico.textContent = t === 'dark' ? '☾' : '☀';
  if (lbl) lbl.textContent = t === 'dark' ? 'Dark' : 'Light';
}

export function wireTheme() {
  const stored = localStorage.getItem(KEY) as 'light' | 'dark' | null;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(stored || (systemDark ? 'dark' : 'light'));
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    applyTheme(next);
  });
}
