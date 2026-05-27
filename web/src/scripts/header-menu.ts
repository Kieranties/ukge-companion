// Mobile-only kebab menu in the site header. On desktop, .header-menu is
// laid out as an inline row by CSS and the kebab is hidden, so this wiring
// is a no-op until a viewport narrower than 640px is in play.
export function wireHeaderMenu() {
  const btn = document.getElementById('header-menu-btn');
  const menu = document.getElementById('header-menu');
  if (!btn || !menu) return;
  const close = () => {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Clicking anything inside the menu (Share, Export, Theme, Install) should
  // close the popover — the action itself is handled by its own listener.
  menu.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.icon-btn')) close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('open')) return;
    const inside = (e.target as HTMLElement).closest('#header-menu, #header-menu-btn');
    if (!inside) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}
