const numberFormatter = new Intl.NumberFormat('es-CO');

export function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '0';
  try {
    return numberFormatter.format(Number(value));
  } catch {
    return String(value ?? '0');
  }
}

export function initialsFrom(name = '', email = '') {
  const source = name || email;
  if (!source) return 'EC';
  const chunks = source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .filter(Boolean);
  if (!chunks.length) return 'EC';
  if (chunks.length === 1) {
    const [first] = chunks;
    if (first.length === 1) {
      return (first + (email?.[0] || 'C')).toUpperCase();
    }
    return first.slice(0, 2).toUpperCase();
  }
  return chunks.map((chunk) => chunk[0]).join('').toUpperCase();
}

export function openModal(modal) {
  if (!modal || modal.classList.contains('is-open')) return;
  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('has-modal');
  modal.__lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable =
    modal.querySelector('[data-modal-focus]') ||
    modal.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
  if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });
  const handleKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(modal);
    }
  };
  modal.__escHandler = handleKey;
  document.addEventListener('keydown', handleKey);
}

export function closeModal(modal) {
  if (!modal || !modal.classList.contains('is-open')) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  if (modal.__escHandler) {
    document.removeEventListener('keydown', modal.__escHandler);
    delete modal.__escHandler;
  }
  const previous = modal.__lastFocus;
  if (previous && typeof previous.focus === 'function') {
    previous.focus({ preventScroll: true });
  }
  delete modal.__lastFocus;
  if (!document.querySelector('.modal.is-open')) {
    document.body.classList.remove('has-modal');
  }
}
