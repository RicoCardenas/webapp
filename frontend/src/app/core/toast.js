import { qs } from '../../lib/dom.js';

// Simple toast utility used across the app
export const toast = (() => {
  const container = qs('#toasts');

  function show(type, message, timeoutMs = 6000) {
    if (!container) return;

    const card = document.createElement('div');
    card.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
    card.setAttribute('aria-atomic', 'true');

    card.classList.add(
      type === 'success'
        ? 'is-success'
        : type === 'error'
        ? 'is-danger'
        : type === 'info'
        ? 'is-info'
        : 'is-warning'
    );

    const text = document.createElement('span');
    text.textContent = message;
    card.appendChild(text);
    container.appendChild(card);

    let timer = setTimeout(remove, timeoutMs);

    function remove() {
      clearTimeout(timer);
      if (card.parentNode) card.parentNode.removeChild(card);
    }

    return { remove };
  }

  return {
    success: (m) => show('success', m),
    error: (m) => show('error', m, 7000),
    info: (m) => show('info', m),
    warn: (m) => show('warn', m, 7000),
  };
})();

