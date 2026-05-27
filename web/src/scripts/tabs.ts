// Hash-routed tab navigation. Tabs hide/show .panel elements by data-panel attr.
export function wireTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
  const valid = new Set(panels.map((p) => p.dataset.panel!));

  function show(id: string) {
    if (!valid.has(id)) id = 'for-you';
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === id);
    for (const p of panels) p.classList.toggle('active', p.dataset.panel === id);
    if (!location.hash.includes('share=') && location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }
    document.getElementById('tab-bar')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab!));
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#/, '').split('&').find((s) => !s.startsWith('share=')) || 'for-you';
    show(id);
  });

  const initial = location.hash.replace(/^#/, '').split('&').find((s) => !s.startsWith('share=')) || 'for-you';
  show(initial);
}
