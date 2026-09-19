// Menu-button keyboard behavior, kept separate from download-source validation.
export function nextMenuIndex(key, current, count) {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1 + count) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  return current;
}

export function createSourceMenu(root, onSelect) {
  const toggle = root.querySelector('#source-toggle');
  const current = root.querySelector('#source-current');
  const menu = root.querySelector('#source-menu');
  const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
  let selected = 'github';

  function close(restoreFocus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  function open(index = items.findIndex(item => item.dataset.source === selected)) {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    items[Math.max(0, index)].focus();
  }
  toggle.addEventListener('click', () => menu.hidden ? open() : close());
  toggle.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open(event.key === 'ArrowUp' ? items.length - 1 : 0);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') {
      // Resume the document's natural tab order from the trigger, in either direction.
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    items[nextMenuIndex(event.key, items.indexOf(root.ownerDocument.activeElement), items.length)].focus();
  });
  for (const item of items) item.addEventListener('click', () => {
    if (item.getAttribute('aria-disabled') === 'true') return;
    close(true);
    onSelect(item.dataset.source);
  });
  root.ownerDocument.addEventListener('pointerdown', event => {
    if (!root.contains(event.target)) close();
  });
  root.addEventListener('focusout', event => {
    if (!root.contains(event.relatedTarget)) close();
  });
  return {
    close,
    update(source, mirrorAvailable, unavailableText) {
      selected = source;
      current.textContent = source === 'mirror' ? 'Сервер в РФ' : 'GitHub';
      for (const item of items) {
        item.setAttribute('aria-checked', String(item.dataset.source === source));
        if (item.dataset.source === 'mirror') {
          item.setAttribute('aria-disabled', String(!mirrorAvailable));
          item.querySelector('.source-description').textContent = mirrorAvailable ? 'Резервное зеркало' : unavailableText;
        }
      }
    },
  };
}
