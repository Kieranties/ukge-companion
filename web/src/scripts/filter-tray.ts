// Mobile: stash status / day / search-facet pills behind a Filters button so
// they don't eat a third of the viewport. The same button shows a badge with
// the count of active (non-default) filters, so users know at a glance when
// something is restricting the view.
//
// On desktop (>= 760px) the tray is always visible and the toggle button is
// hidden — handled entirely in CSS.

function readFilterCount(): number {
  let n = 0;
  // Status pill: anything other than 'all' active counts.
  const status = document.querySelector<HTMLButtonElement>('.status-pill.active')?.dataset.status;
  if (status && status !== 'all') n++;
  // Day pill: anything other than 'any' active counts.
  const day = document.querySelector<HTMLButtonElement>('.day-pill.active')?.dataset.day;
  if (day && day !== 'any') n++;
  // Facets: count of individual facets active (excluding the synthetic 'All').
  const facets = document.querySelectorAll<HTMLButtonElement>('.facet-pill.active');
  for (const f of facets) {
    if (f.dataset.facet && f.dataset.facet !== 'all') n++;
  }
  // Hide-skipped is on by default; only counts if user turned it OFF.
  const hideSkipped = document.getElementById('hide-skipped');
  if (hideSkipped && !hideSkipped.classList.contains('active')) n++;
  return n;
}

function updateFilterCount() {
  const badge = document.getElementById('filter-count');
  if (!badge) return;
  const n = readFilterCount();
  if (n === 0) {
    badge.classList.add('hidden');
  } else {
    badge.classList.remove('hidden');
    badge.textContent = String(n);
  }
}

export function wireFilterTray() {
  const tray = document.getElementById('filter-tray');
  const toggle = document.getElementById('filter-toggle');
  if (!tray || !toggle) return;

  toggle.addEventListener('click', () => {
    const open = tray.dataset.open === 'true';
    tray.dataset.open = open ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  // Update the badge any time a filter is touched. We listen at document
  // level so we don't need to wire each pill individually — the actual
  // filter handlers live in other modules and just toggle .active classes.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.status-pill, .day-pill, .facet-pill, #hide-skipped')) {
      // Defer so the other handler has finished updating .active classes.
      requestAnimationFrame(updateFilterCount);
    }
  });

  updateFilterCount();
}
