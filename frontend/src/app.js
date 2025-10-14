// ====== Selectores / Constantes ============================================

const SELECTORS = {
  siteHeader: '#site-header',
  primaryNav: '#primary-nav',
  drawer: '#mobile-drawer',
  drawerOverlay: '.drawer__overlay',
  drawerToggle: '[data-drawer-toggle]',
  modalLogin: '#modal-login',
  modalSignup: '#modal-signup',
  modalOverlay: '.modal__overlay',
  modalDialog: '.modal__dialog',
  modalClose: '[data-close="modal"]',
  modalOpenLogin: '[data-open="modal-login"]',
  modalOpenSignup: '[data-open="modal-signup"]',
  themeToggle: '[data-theme-toggle]',
  backendStatus: '[data-status]',
  ctaGraficar: '#cta-graficar',
  sections: ['#hero', '#features', '#how-it-works', '#about', '#docs', '#contact'],
  contactForm: '#contact-form',
  contactErrorsGlobal: '#contact-form-errors',
  errorName: '#error-contact-name',
  errorEmail: '#error-contact-email',
  errorMessage: '#error-contact-message',
  toasts: '#toasts',
  year: '[data-year]',
  rootFallback: '#root', // compatibilidad con markup antiguo
};

const KEYS = {
  theme: 'ecup-theme',
  lastSection: 'ecup-last-section',
};

const CLASSNAMES = {
  isOpen: 'is-open',
  hasModal: 'has-modal',
  statusLoading: 'status--loading',
  statusOk: 'status--ok',
  statusError: 'status--error',
};

const STATUS_CLASSES = [CLASSNAMES.statusLoading, CLASSNAMES.statusOk, CLASSNAMES.statusError];

// ====== Utilidades DOM / Eventos ===========================================

/** @template {Element} T */
const qs = (sel, ctx = document) => /** @type {T|null} */ (ctx.querySelector(sel));
/** @template {Element} T */
const qsa = (sel, ctx = document) => /** @type {NodeListOf<T>} */ (ctx.querySelectorAll(sel));

const on = (el, type, handler, opts) => el?.addEventListener?.(type, handler, opts);
const off = (el, type, handler, opts) => el?.removeEventListener?.(type, handler, opts);

/** @param {HTMLElement} el @param {Record<string, string|boolean|null|undefined>} obj */
function setAria(el, obj) {
  if (!el || !obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) el.removeAttribute(`aria-${k}`);
    else el.setAttribute(`aria-${k}`, String(v));
  }
}

/** @param {HTMLElement} btn @param {boolean} state */
function toggleAriaExpanded(btn, state) {
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(state));
}

/** @param {Element} el @param {string} name @param {boolean} [state] */
function toggleClass(el, name, state) {
  if (!el) return;
  el.classList.toggle(name, state ?? !el.classList.contains(name));
}

/** @returns {boolean} */
const prefersReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @template T */
function debounce(fn, delay = 150) {
  let t;
  return /** @param {T} args */ (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

/** @template T */
function throttle(fn, limit = 200) {
  let inThrottle = false;
  let lastArgs = null;
  return /** @param {T} args */ (...args) => {
    if (inThrottle) {
      lastArgs = args;
      return;
    }
    fn(...args);
    inThrottle = true;
    setTimeout(() => {
      inThrottle = false;
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
    }, limit);
  };
}

// ====== Focus Trap / Scroll Lock ===========================================

let focusTrapStack = /** @type {Array<{container: HTMLElement, lastActive: HTMLElement|null}>} */([]);
let lastScrollTop = 0;

function getFocusable(container) {
  if (!container) return [];
  const sel = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return /** @type {HTMLElement[]} */ (Array.from(container.querySelectorAll(sel)))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

/** Bloquea foco dentro del contenedor. */
function trapFocus(container) {
  if (!container) return;
  const lastActive = /** @type {HTMLElement|null} */ (document.activeElement || null);
  focusTrapStack.push({ container, lastActive });

  const focusables = getFocusable(container);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };
  on(container, 'keydown', handler);
  container.dataset.trapHandler = 'true';
  container.__trapHandler = handler;

  (first || container).focus({ preventScroll: true });
}

/** Libera el trap actual y retorna el foco al último elemento activo. */
function releaseFocus() {
  const ctx = focusTrapStack.pop();
  if (!ctx) return;
  const { container, lastActive } = ctx;
  const handler = container.__trapHandler;
  if (handler) off(container, 'keydown', handler);
  delete container.__trapHandler;
  lastActive?.focus?.({ preventScroll: true });
}

/** Evita scroll del body (para modales/drawer). */
function lockScroll() {
  lastScrollTop = window.scrollY || document.documentElement.scrollTop;
  document.body.style.top = `-${lastScrollTop}px`;
  document.body.style.position = 'fixed';
}

/** Restaura el scroll del body. */
function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  window.scrollTo({ top: lastScrollTop, left: 0 });
}

// ====== Fetch seguro con timeout ===========================================

/**
 * Fetch con AbortController + timeout seguro.
 * @param {RequestInfo} url
 * @param {RequestInit} [opts]
 * @param {number} [timeoutMs=3000]
 */
async function safeFetch(url, opts = {}, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ====== Gestor de Tema ======================================================

/** Aplica tema y emite evento. */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/** Lee preferencia de storage o media query. */
function initTheme() {
  const btn = qs(SELECTORS.themeToggle);
  const stored = localStorage.getItem(KEYS.theme);
  const mqDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (mqDark ? 'dark' : 'light');
  applyTheme(theme);
  if (btn instanceof HTMLElement) {
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

/** Alterna y guarda tema. */
function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(KEYS.theme, next);
  const btn = qs(SELECTORS.themeToggle);
  if (btn) btn.setAttribute('aria-pressed', String(next === 'dark'));
}

// ====== Drawer Móvil ========================================================

const DrawerController = (() => {
  let drawer, toggleBtn, overlay, openerBtn = /** @type {HTMLElement|null} */(null);

  function bind() {
    drawer = qs(SELECTORS.drawer);
    toggleBtn = qs(SELECTORS.drawerToggle);
    overlay = qs(SELECTORS.drawerOverlay, drawer || undefined);

    if (!drawer || !toggleBtn) return;

    on(toggleBtn, 'click', open);
    on(overlay, 'click', close);
    on(document, 'keydown', (e) => {
      if (drawer?.classList.contains(CLASSNAMES.isOpen) && e.key === 'Escape') close();
    });
  }

  function open() {
    if (!drawer || !toggleBtn) return;
    openerBtn = /** @type {HTMLElement} */(document.activeElement);
    toggleClass(drawer, CLASSNAMES.isOpen, true);
    setAria(drawer, { hidden: false });
    toggleAriaExpanded(toggleBtn, true);
    lockScroll();
    const firstLink = qs('.drawer__link', drawer);
    const panel = qs(SELECTORS.drawerOverlay, drawer)?.nextElementSibling;
    if (panel instanceof HTMLElement) trapFocus(panel);
    (/** @type {HTMLElement} */(firstLink) || drawer).focus({ preventScroll: true });
  }

  function close() {
    if (!drawer || !toggleBtn) return;
    toggleClass(drawer, CLASSNAMES.isOpen, false);
    setAria(drawer, { hidden: true });
    toggleAriaExpanded(toggleBtn, false);
    releaseFocus();
    unlockScroll();
    openerBtn?.focus?.({ preventScroll: true });
    openerBtn = null;
  }

  return { bind, open, close };
})();

// ====== Modales (Login / Signup) ===========================================

function createModalController(rootSelector) {
  /** @type {HTMLElement|null} */
  const modal = qs(rootSelector);
  if (!modal) return { open: () => {}, close: () => {}, bind: () => {} };

  let openerBtn = /** @type {HTMLElement|null} */(null);
  const overlay = qs(SELECTORS.modalOverlay, modal);
  const dialog = qs(SELECTORS.modalDialog, modal);
  const closeBtns = qsa(SELECTORS.modalClose, modal);

  function open() {
    openerBtn = /** @type {HTMLElement} */(document.activeElement);
    toggleClass(modal, CLASSNAMES.isOpen, true);
    setAria(modal, { hidden: false });
    document.body.classList.add(CLASSNAMES.hasModal);
    lockScroll();
    if (dialog instanceof HTMLElement) trapFocus(dialog);
  }

  function close() {
    toggleClass(modal, CLASSNAMES.isOpen, false);
    setAria(modal, { hidden: true });
    document.body.classList.remove(CLASSNAMES.hasModal);
    releaseFocus();
    unlockScroll();
    openerBtn?.focus?.({ preventScroll: true });
    openerBtn = null;
  }

  function bind() {
    on(overlay, 'click', close);
    closeBtns.forEach(btn => on(btn, 'click', close));
    on(document, 'keydown', (e) => {
      if (modal.classList.contains(CLASSNAMES.isOpen) && e.key === 'Escape') close();
    });
  }

  return { open, close, bind };
}

const LoginModal = createModalController(SELECTORS.modalLogin);
const SignupModal = createModalController(SELECTORS.modalSignup);

/** Funciones públicas para pruebas manuales */
function openLogin() { LoginModal.open(); }
function openSignup() { SignupModal.open(); }

// ====== Smooth Scroll + ScrollSpy ==========================================

function getHeaderOffset() {
  const header = qs(SELECTORS.siteHeader);
  const rect = header?.getBoundingClientRect();
  const styles = header ? getComputedStyle(header) : null;
  const marginTop = styles ? parseFloat(styles.marginTop || '0') : 0;
  return (rect?.height || 0) + marginTop + 8; // espacio extra
}

function smoothScrollTo(targetEl) {
  if (!targetEl) return;
  const top = window.scrollY + targetEl.getBoundingClientRect().top - getHeaderOffset();
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  window.scrollTo({ top, behavior });
}

function bindAnchorScrolling() {
  on(document, 'click', (e) => {
    const t = /** @type {HTMLElement} */(e.target);
    if (!(t instanceof Element)) return;
    const link = t.closest('a[href^="#"]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    const dest = qs(href);
    if (dest) {
      e.preventDefault();
      smoothScrollTo(dest);
      history.pushState(null, '', href);
      localStorage.setItem(KEYS.lastSection, href);
      DrawerController.close?.();
    }
  });
}

function initScrollSpy() {
  const nav = qs(SELECTORS.primaryNav);
  if (!nav) return;
  const links = /** @type {HTMLAnchorElement[]} */(Array.from(qsa('.nav__link', nav)));
  const map = new Map();
  links.forEach(l => {
    const hash = l.getAttribute('href');
    const sec = hash ? qs(hash) : null;
    if (sec) map.set(sec, l);
  });

  const setCurrent = (el) => {
    links.forEach(a => a.removeAttribute('aria-current'));
    el?.setAttribute('aria-current', 'page');
  };

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const link = map.get(entry.target);
      if (!link) return;
      if (entry.isIntersecting) setCurrent(link);
    });
  }, { rootMargin: `-${Math.max(80, getHeaderOffset())}px 0px -70% 0px`, threshold: [0.1, 0.6] });

  map.forEach((_, sec) => obs.observe(sec));
}

// ====== Estado del Backend ==================================================

/**
 * Actualiza el indicador de estado con clase modificadora y mensaje.
 * @param {HTMLElement} element
 * @param {string|null} modifierClass
 * @param {string} message
 */
function setStatus(element, modifierClass, message) {
  if (!element) return;
  element.textContent = message;
  STATUS_CLASSES.forEach((name) => element.classList.remove(name));
  if (modifierClass) element.classList.add(modifierClass);
}

const BackendStatus = (() => {
  /** Root compatible: primero #app, si no existe usar #root */
  const host = qs('#app') || qs(SELECTORS.rootFallback) || document.body;
  /** @type {HTMLElement|null} */
  let statusEl = qs(SELECTORS.backendStatus, host);

  if (!statusEl) {
    statusEl = document.createElement('p');
    statusEl.dataset.status = '';
    statusEl.className = `status ${CLASSNAMES.statusLoading}`;
    statusEl.textContent = 'Verificando estado del backend...';
    host.append(statusEl);
  } else {
    setStatus(statusEl, CLASSNAMES.statusLoading, 'Verificando estado del backend...');
  }

  setAria(statusEl, { live: 'polite' });
  statusEl.setAttribute('role', 'status');

  async function check(attempt = 1) {
    try {
      const res = await safeFetch('/api/health', {}, 3000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let message = 'Backend operativo';
      try {
        const payload = await res.json();
        const label = payload?.status ?? 'desconocido';
        message = `Estado del backend: ${label}`;
      } catch {
        // si no es JSON válido, mantenemos mensaje genérico
      }
      setStatus(statusEl, CLASSNAMES.statusOk, message);
      return true;
    } catch (err) {
      if (attempt < 3) {
        const backoff = Math.min(4000, Math.floor(1500 * Math.pow(1.5, attempt)));
        await new Promise(r => setTimeout(r, backoff));
        return check(attempt + 1);
      }
      console.error('No se pudo verificar el backend', err);
      setStatus(statusEl, CLASSNAMES.statusError, 'Estado del backend: error al conectar');
      return false;
    }
  }

  return { check };
})();

// ====== Toasts =============================================================

const toast = (() => {
  const container = qs(SELECTORS.toasts);

  /**
   * Crea un toast.
   * @param {'success'|'error'|'info'|'warn'} type
   * @param {string} message
   * @param {number} [timeoutMs=6000]
   */
  function show(type, message, timeoutMs = 6000) {
    if (!container) return;

    const card = document.createElement('div');
    card.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
    card.setAttribute('aria-atomic', 'true');
    if (type === 'success') card.classList.add('is-success');
    if (type === 'error') card.classList.add('is-danger');
    if (type === 'info') card.classList.add('is-info');
    if (type === 'warn') card.classList.add('is-warning');

    const text = document.createElement('span');
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--icon';
    closeBtn.setAttribute('aria-label', 'Cerrar notificación');
    closeBtn.textContent = '✕';
    on(closeBtn, 'click', () => remove());

    card.appendChild(text);
    card.appendChild(closeBtn);
    container.appendChild(card);

    let timer = setTimeout(remove, timeoutMs);

    function remove() {
      clearTimeout(timer);
      if (card.parentNode) card.parentNode.removeChild(card);
    }

    return { remove };
  }

  return {
    /** @param {string} m */ success: (m) => show('success', m),
    /** @param {string} m */ error: (m) => show('error', m, 7000),
    /** @param {string} m */ info: (m) => show('info', m),
    /** @param {string} m */ warn: (m) => show('warn', m, 7000),
  };
})();

// ====== Formulario de Contacto =============================================

function initContactForm() {
  const form = qs(SELECTORS.contactForm);
  if (!form) return;

  const errGlobal = qs(SELECTORS.contactErrorsGlobal);
  const errName = qs(SELECTORS.errorName);
  const errEmail = qs(SELECTORS.errorEmail);
  const errMsg = qs(SELECTORS.errorMessage);

  function showFieldError(pEl, msg) {
    if (!pEl) return;
    pEl.textContent = msg;
    pEl.classList.add('is-visible');
    pEl.setAttribute('aria-hidden', 'false');
  }
  function hideFieldError(pEl) {
    if (!pEl) return;
    pEl.textContent = '';
    pEl.classList.remove('is-visible');
    pEl.setAttribute('aria-hidden', 'true');
  }

  const validators = {
    name: (v) => (v && v.trim().length >= 2) ? '' : 'Ingresa tu nombre (mín. 2 caracteres)',
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '')) ? '' : 'Ingresa un correo válido',
    message: (v) => (v && v.trim().length >= 10) ? '' : 'Escribe un mensaje (mín. 10 caracteres)',
  };

  on(form, 'submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '');
    const email = String(fd.get('email') || '');
    const message = String(fd.get('message') || '');

    hideFieldError(errName);
    hideFieldError(errEmail);
    hideFieldError(errMsg);
    if (errGlobal) {
      errGlobal.textContent = '';
      errGlobal.classList.remove('is-visible');
      errGlobal.setAttribute('aria-hidden', 'true');
    }

    const errors = {
      name: validators.name(name),
      email: validators.email(email),
      message: validators.message(message),
    };

    let invalid = false;
    if (errors.name) { showFieldError(errName, errors.name); invalid = true; }
    if (errors.email) { showFieldError(errEmail, errors.email); invalid = true; }
    if (errors.message) { showFieldError(errMsg, errors.message); invalid = true; }

    if (invalid) {
      if (errGlobal) {
        errGlobal.textContent = 'Por favor corrige los errores en el formulario.';
        errGlobal.classList.add('is-visible');
        errGlobal.setAttribute('aria-hidden', 'false');
      }
      return;
    }

    try {
      const res = await safeFetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      }, 5000);

      if (res.ok) {
        toast.success('Mensaje enviado');
        /** @type {HTMLFormElement} */(form).reset();
      } else {
        toast.error('No se pudo enviar tu mensaje');
      }
    } catch {
      toast.error('No se pudo enviar tu mensaje');
    }
  });
}

// ====== CTA Graficar ========================================================

function initCTA() {
  const cta = qs(SELECTORS.ctaGraficar);
  const docs = qs('#docs');
  if (!cta || !docs) return;
  on(cta, 'click', (e) => {
    e.preventDefault();
    const ev = new CustomEvent('plot:start', { bubbles: true });
    cta.dispatchEvent(ev);
    smoothScrollTo(docs);
  });
}

// ====== Footer Año ==========================================================

function setCurrentYear() {
  const yEl = qs(SELECTORS.year);
  if (!yEl) return;
  const now = new Date().getFullYear();
  yEl.textContent = String(now);
}

// ====== Guardar/restaurar última sección (opcional) ========================

function restoreLastSection() {
  const last = localStorage.getItem(KEYS.lastSection);
  if (!last) return;
  const el = qs(last);
  if (el) {
    // (opcional) smoothScrollTo(el);
  }
}

// ====== Enlaces de modales / tema ==========================================

function bindGlobalTriggers() {
  const themeBtn = qs(SELECTORS.themeToggle);
  on(themeBtn, 'click', toggleTheme);

  const drawerBtn = qs(SELECTORS.drawerToggle);
  on(drawerBtn, 'click', (e) => {
    e.preventDefault();
    DrawerController.open();
  });

  qsa(SELECTORS.modalOpenLogin).forEach(btn =>
    on(btn, 'click', (e) => { e.preventDefault(); LoginModal.open(); }),
  );
  qsa(SELECTORS.modalOpenSignup).forEach(btn =>
    on(btn, 'click', (e) => { e.preventDefault(); SignupModal.open(); }),
  );
}

// ====== Punto de entrada ====================================================

function init() {
  initTheme();
  DrawerController.bind();
  LoginModal.bind?.();
  SignupModal.bind?.();
  bindAnchorScrolling();
  initScrollSpy();
  BackendStatus.check();
  initContactForm();
  initCTA();
  setCurrentYear();
  restoreLastSection();
  bindGlobalTriggers();
}

init();

export { openLogin, openSignup, toggleTheme };

