// Generic single-instance popover.
//
// Opens anchored beneath a trigger element with a list of options
// (checkbox for multi-select, radio for single-select) plus an optional
// "Remove" row. Closes on outside click, Esc, or trigger re-press.
//
// The popover is built imperatively (no template element required); the
// markup is intentionally minimal so it slots into the existing styling
// without an additional template in index.astro.

export interface PopoverOption {
  label: string;
  value: string;
  selected?: boolean;
}

export interface OpenPopoverArgs {
  trigger: HTMLElement;
  title?: string;
  mode: 'single' | 'multi';
  options: PopoverOption[];
  /** Show a destructive "Remove" row at the bottom when truthy. */
  removeLabel?: string;
  /** Called with the option value, or `null` for Remove. In multi mode the
   *  popover stays open after each click; in single mode it closes. */
  onSelect: (value: string | null) => void;
}

let openEl: HTMLElement | null = null;
let openTrigger: HTMLElement | null = null;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function position(popover: HTMLElement, trigger: HTMLElement) {
  const tr = trigger.getBoundingClientRect();
  const ph = popover.offsetHeight;
  const pw = popover.offsetWidth;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // Prefer below the trigger; flip above if it would clip the viewport.
  let top = tr.bottom + 6;
  if (top + ph > vh - 8) top = Math.max(8, tr.top - ph - 6);
  // Align horizontally with trigger but clamp inside the viewport.
  let left = tr.left;
  if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
  if (left < 8) left = 8;
  popover.style.top = `${top + window.scrollY}px`;
  popover.style.left = `${left + window.scrollX}px`;
}

export function closePopover() {
  if (openEl) {
    openEl.remove();
    openEl = null;
    openTrigger = null;
  }
}

export function openPopover(args: OpenPopoverArgs) {
  // Re-press on the same trigger closes the popover (familiar dropdown behaviour).
  if (openTrigger === args.trigger) {
    closePopover();
    return;
  }
  closePopover();

  const wrap = document.createElement('div');
  wrap.className = 'popover';
  wrap.setAttribute('role', 'dialog');
  const titleHtml = args.title ? `<div class="popover-title">${escapeHtml(args.title)}</div>` : '';
  const itemsHtml = args.options
    .map(
      (o) => `<button class="popover-item${o.selected ? ' on' : ''}" type="button" data-value="${escapeHtml(o.value)}" role="${args.mode === 'multi' ? 'menuitemcheckbox' : 'menuitemradio'}" aria-checked="${o.selected ? 'true' : 'false'}">
        <span class="popover-check">${o.selected ? '✓' : ''}</span>
        <span class="popover-label">${escapeHtml(o.label)}</span>
      </button>`
    )
    .join('');
  const removeHtml = args.removeLabel
    ? `<button class="popover-item popover-remove" type="button" data-remove="1">${escapeHtml(args.removeLabel)}</button>`
    : '';
  wrap.innerHTML = `${titleHtml}<div class="popover-body">${itemsHtml}${removeHtml}</div>`;
  document.body.appendChild(wrap);
  openEl = wrap;
  openTrigger = args.trigger;
  position(wrap, args.trigger);

  wrap.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.popover-item');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.remove === '1') {
      args.onSelect(null);
      closePopover();
      return;
    }
    const value = btn.dataset.value || '';
    args.onSelect(value);
    if (args.mode === 'multi') {
      const nowOn = !btn.classList.contains('on');
      btn.classList.toggle('on', nowOn);
      btn.setAttribute('aria-checked', nowOn ? 'true' : 'false');
      const check = btn.querySelector('.popover-check');
      if (check) check.textContent = nowOn ? '✓' : '';
    } else {
      closePopover();
    }
  });
}

// Outside-click + Esc + scroll-away dismissal.
document.addEventListener(
  'click',
  (e) => {
    if (!openEl || !openTrigger) return;
    const t = e.target as Node;
    if (openEl.contains(t) || openTrigger.contains(t)) return;
    closePopover();
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openEl) closePopover();
});
window.addEventListener(
  'scroll',
  () => {
    if (openEl && openTrigger) position(openEl, openTrigger);
  },
  { passive: true, capture: true },
);
window.addEventListener('resize', () => {
  if (openEl && openTrigger) position(openEl, openTrigger);
});
