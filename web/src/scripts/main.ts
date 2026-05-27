import { wireTheme } from './theme';
import { wireTabs } from './tabs';
import { wireFilters, applyFilters } from './filters';
import { wireAllCards } from './cards';
import { wireSearch } from './search';
import { wireRoute } from './route';
import { wireShare } from './share';
import { wireExport } from './export';
import { wirePWA } from './pwa';

wireTheme();
wireAllCards();
wireTabs();
wireFilters();
wireRoute();
wireSearch();
wireShare();
wireExport();
wirePWA();
applyFilters();

// Click-to-filter: any element with data-filter sets the search box.
const globalQ = document.getElementById('global-q') as HTMLInputElement | null;
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('[data-filter]');
  if (!btn || !globalQ) return;
  e.preventDefault();
  globalQ.value = btn.dataset.filter || '';
  globalQ.dispatchEvent(new Event('input', { bubbles: true }));
  globalQ.scrollIntoView({ block: 'start', behavior: 'smooth' });
  globalQ.focus({ preventScroll: true });
});
