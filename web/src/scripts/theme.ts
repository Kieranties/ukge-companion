// Theme toggle. Initial state is applied by an inline <head> script (see
// index.astro) so the page paints with the correct theme — that block must
// stay in sync with the KEY constant here.
const KEY = 'ukge-companion-theme';

export function wireTheme() {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    document.documentElement.setAttribute('data-theme', next);
  });
}
