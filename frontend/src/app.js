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
  rootFallback: '#root',

  signupForm: '#modal-signup .form',
  signupEmail: '#signup-email',
  signupPassword: '#signup-password',
  signupTerms: '#signup-terms',
  loginForm: '#modal-login .form',
  loginEmail: '#login-email',
  loginPassword: '#login-password',
  btnLogout: '#btn-logout',
  btnAccount: '#btn-account',
};

window.addEventListener('error', (e) => {
  try {
    const msg =
      e?.error?.message ||
      e?.message ||
      'Error de script';

    const file = e?.filename
      ? ` @ ${e.filename}:${e.lineno}:${e.colno}`
      : '';

    console.error('[EcuPlot] Error:', e.error || e);
    toast?.error?.(`Error JS: ${msg}${file}`);
  } catch {}
});

window.addEventListener('unhandledrejection', (e) => {
  try {
    const msg =
      e?.reason?.message ||
      String(e.reason) ||
      'Promise rechazada';

    console.error('[EcuPlot] Rechazo no manejado:', e.reason);
    toast?.error?.(`Error async: ${msg}`);
  } catch {}
});

const KEYS = {
  theme: 'ecup-theme',
  sessionToken: 'ecuplot_session_token',
};

const HEADER_ICON_PATHS = {
  account: {
    light: '/static/images/userclaro.png',
    dark: '/static/images/useroscuro.png',
    label: 'Mi Cuenta',
  },
};

const CLASSNAMES = {
  isOpen: 'is-open',
  hasModal: 'has-modal',
  statusLoading: 'status--loading',
  statusOk: 'status--ok',
  statusError: 'status--error',
};

const STATUS_CLASSES = [
  CLASSNAMES.statusLoading,
  CLASSNAMES.statusOk,
  CLASSNAMES.statusError,
];

/** Utils DOM */
const qs = (sel, ctx = document) =>
  /** @type {any} */ (ctx.querySelector(sel));

const qsa = (sel, ctx = document) =>
  /** @type {any} */ (ctx.querySelectorAll(sel));

const on = (el, type, handler, opts) =>
  el?.addEventListener?.(type, handler, opts);

const off = (el, type, handler, opts) =>
  el?.removeEventListener?.(type, handler, opts);

function setAria(el, obj) {
  if (!el) return;
  for (const [k, v] of Object.entries(obj)) {
    v == null
      ? el.removeAttribute(`aria-${k}`)
      : el.setAttribute(`aria-${k}`, String(v));
  }
}

function toggleAriaExpanded(btn, state) {
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(state));
}

function toggleClass(el, name, state) {
  if (!el) return;
  el.classList.toggle(name, state ?? !el.classList.contains(name));
}

const prefersReducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function debounce(fn, delay = 150) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), delay);
  };
}

/** Focus trap / Scroll lock */
let focusTrapStack = [];
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

  return Array
    .from(container.querySelectorAll(sel))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

function trapFocus(container) {
  if (!container) return;

  const lastActive = document.activeElement || null;
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
  container.__trapHandler = handler;

  (first || container).focus({ preventScroll: true });
}

function releaseFocus() {
  const ctx = focusTrapStack.pop();
  if (!ctx) return;

  const { container, lastActive } = ctx;
  const handler = container.__trapHandler;

  if (handler) off(container, 'keydown', handler);
  delete container.__trapHandler;

  lastActive?.focus?.({ preventScroll: true });
}

function lockScroll() {
  lastScrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollbarComp = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.top = `-${lastScrollTop}px`;
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  if (scrollbarComp > 0) {
    document.body.style.paddingRight = `${scrollbarComp}px`;
  }
}

function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.paddingRight = '';
  window.scrollTo({ top: lastScrollTop, left: 0 });
}

/** Fetch con timeout */
async function safeFetch(url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(id);
  }
}

/** Tema */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

function initTheme() {
  const btn = qs('[data-theme-toggle]');
  const stored = localStorage.getItem(KEYS.theme);
  const mqDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (mqDark ? 'dark' : 'light');

  applyTheme(theme);
  if (btn) btn.setAttribute('aria-pressed', String(theme === 'dark'));
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(KEYS.theme, next);

  const btn = qs('[data-theme-toggle]');
  if (btn) btn.setAttribute('aria-pressed', String(next === 'dark'));
}

/** Drawer móvil */
const DrawerController = (() => {
  let drawer, toggleBtn, overlay, openerBtn = null;

  function bind() {
    drawer = qs('#mobile-drawer');
    toggleBtn = qs('[data-drawer-toggle]');
    overlay = qs('.drawer__overlay', drawer || undefined);
    const closeBtn = drawer ? qs('.drawer__close', drawer) : null;

    if (!drawer || !toggleBtn) return;

    on(toggleBtn, 'click', open);
    on(overlay, 'click', close);
    on(closeBtn, 'click', close);
    on(document, 'keydown', (e) => {
      if (drawer?.classList.contains('is-open') && e.key === 'Escape') close();
    });
  }

  function open() {
    if (!drawer || !toggleBtn) return;

    openerBtn = document.activeElement;
    toggleClass(drawer, 'is-open', true);
    setAria(drawer, { hidden: false });
    toggleAriaExpanded(toggleBtn, true);
    lockScroll();

    const firstLink = qs('.drawer__link', drawer);
    const panel = qs('.drawer__overlay', drawer)?.nextElementSibling;
    if (panel instanceof HTMLElement) trapFocus(panel);

    (firstLink || drawer).focus({ preventScroll: true });
  }

  function close() {
    if (!drawer || !toggleBtn) return;

    toggleClass(drawer, 'is-open', false);
    setAria(drawer, { hidden: true });
    toggleAriaExpanded(toggleBtn, false);
    releaseFocus();
    unlockScroll();

    openerBtn?.focus?.({ preventScroll: true });
    openerBtn = null;
  }

  return { bind, open, close };
})();

// Modales
function createModalController(rootSelector) {
  const modal = qs(rootSelector);
  if (!modal) return { open: () => {}, close: () => {}, bind: () => {} };

  let openerBtn = null;
  const overlay = qs('.modal__overlay', modal);
  const dialog = qs('.modal__dialog', modal);
  const closeBtns = qsa('[data-close="modal"]', modal);

  function open() {
    openerBtn = document.activeElement;
    toggleClass(modal, 'is-open', true);
    setAria(modal, { hidden: false });
    document.body.classList.add('has-modal');
    lockScroll();
    if (dialog instanceof HTMLElement) trapFocus(dialog);
  }

  function close() {
    toggleClass(modal, 'is-open', false);
    setAria(modal, { hidden: true });
    document.body.classList.remove('has-modal');
    releaseFocus();
    unlockScroll();
    openerBtn?.focus?.({ preventScroll: true });
    openerBtn = null;
  }

  function bind() {
    on(overlay, 'click', close);
    closeBtns.forEach((btn) => on(btn, 'click', close));
    on(document, 'keydown', (e) => {
      if (modal.classList.contains('is-open') && e.key === 'Escape') close();
    });
  }

  return { open, close, bind };
}

const LoginModal = createModalController('#modal-login');
const SignupModal = createModalController('#modal-signup');


function bindDrawerLinkClosing() {
  const drawer = qs('#mobile-drawer');
  if (!drawer) {
    return;
  }
  const links = qsa('.drawer__link', drawer);
  links.forEach((link) => {
    on(link, 'click', () => {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) {
        DrawerController.close?.();
      }
    });
  });
}

/** ScrollSpy */
function initScrollSpy() {
  const nav = qs('#primary-nav');
  if (!nav) return;

  const links = Array
    .from(qsa('.nav__link', nav))
    .filter((a) => (a.getAttribute('href') || '').startsWith('#'));

  if (links.length === 0) return;

  const map = new Map();
  links.forEach((l) => {
    const hash = l.getAttribute('href'); 
    const sec = hash ? qs(hash) : null;
    if (sec) map.set(sec, l);
  });

  const setCurrent = (el) => {
    links.forEach((a) => a.removeAttribute('aria-current'));
    el?.setAttribute('aria-current', 'page');
  };

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = map.get(entry.target);
        if (!link) return;
        if (entry.isIntersecting) setCurrent(link);
      });
    },
    {
      rootMargin: `-80px 0px -70% 0px`,
      threshold: [0.1, 0.6],
    }
  );

  map.forEach((_, sec) => obs.observe(sec));
}

/** Estado backend: solo si hay [data-status] en la página */
function setStatus(element, modifierClass, message) {
  if (!element) return;
  element.textContent = message;
  STATUS_CLASSES.forEach((n) => element.classList.remove(n));
  if (modifierClass) element.classList.add(modifierClass);
}

const BackendStatus = (() => {
  const statusEl = qs('[data-status]'); // si no hay, no hace nada
  if (!statusEl) return { check: () => {} };

  setStatus(statusEl, CLASSNAMES.statusLoading, 'Verificando estado del backend…');
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
      } catch {}

      setStatus(statusEl, CLASSNAMES.statusOk, message);
      return true;
    } catch (err) {
      if (attempt < 3) {
        const backoff = Math.min(4000, Math.floor(1500 * Math.pow(1.5, attempt)));
        await new Promise((r) => setTimeout(r, backoff));
        return check(attempt + 1);
      }
      console.error('No se pudo verificar el backend', err);
      setStatus(statusEl, CLASSNAMES.statusError, 'Estado del backend: error al conectar');
      return false;
    }
  }

  return { check };
})();

// notificaciones/toasts
const toast = (() => {
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

// Contacto
function initContactForm() {
  const form = qs('#contact-form');
  if (!form) return;

  const errGlobal = qs('#contact-form-errors');
  const errName = qs('#error-contact-name');
  const errEmail = qs('#error-contact-email');
  const errMsg = qs('#error-contact-message');

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
    name: (v) =>
      v && v.trim().length >= 2 ? '' : 'Ingresa tu nombre (mín. 2 caracteres)',
    email: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '') ? '' : 'Ingresa un correo válido',
    message: (v) =>
      v && v.trim().length >= 10 ? '' : 'Escribe un mensaje (mín. 10 caracteres)',
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
      const res = await safeFetch(
        '/contact',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message }),
        },
        5000
      );

      if (res.ok) {
        toast.success('Mensaje enviado (simulación)');
        form.reset();
      } else {
        toast.error('No se pudo enviar tu mensaje (simulación)');
      }
    } catch {
      toast.error('No se pudo enviar tu mensaje (simulación)');
    }
  });
}

// Footer
function setCurrentYear() {
  const yEl = qs('[data-year]');
  if (!yEl) return;
  yEl.textContent = String(new Date().getFullYear());
}

// Triggers
function bindGlobalTriggers() {
  const themeBtn = qs('[data-theme-toggle]');
  on(themeBtn, 'click', toggleTheme);

  const drawerBtn = qs('[data-drawer-toggle]');
  on(drawerBtn, 'click', (e) => {
    e.preventDefault();
    DrawerController.open();
    });

  qsa('[data-open="modal-login"]').forEach((btn) =>
    on(btn, 'click', (e) => {
      e.preventDefault();
      LoginModal.open();
    })
  );

  qsa('[data-open="modal-signup"]').forEach((btn) =>
    on(btn, 'click', (e) => {
      e.preventDefault();
      SignupModal.open();
    })
  );
}

// Utilidades de autenticación
function getSessionToken() {
  return localStorage.getItem(KEYS.sessionToken);
}

function setSessionToken(token) {
  if (token) localStorage.setItem(KEYS.sessionToken, token);
}

function clearSessionToken() {
  localStorage.removeItem(KEYS.sessionToken);
}

function buildHeaderButtonMarkup(config, options = {}) {
  if (!config) return '';
  const { light, dark, label } = config;
  const showLabel = options.showLabel ?? false;
  return `
    <span class="btn__icon" aria-hidden="true">
      <img class="btn__icon-img btn__icon-img--light" src="${light}" alt="" decoding="async" />
      <img class="btn__icon-img btn__icon-img--dark" src="${dark}" alt="" decoding="async" />
    </span>
    ${showLabel && label ? `<span class="btn__label">${label}</span>` : ''}
  `;
}

async function authFetch(url, options = {}) {
  const token = getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...options, headers });
}

function ensureAccountButton() {
  const actions = qs('.header__actions');
  if (!actions) return null;

  let btnAccount = qs('#btn-account', actions);
  if (!btnAccount) {
    btnAccount = document.createElement('a');
    btnAccount.id = 'btn-account';
    btnAccount.className = 'btn header__btn header__btn--account btn--has-icon btn--icon-only';
    btnAccount.href = '/account';
    btnAccount.setAttribute('aria-label', HEADER_ICON_PATHS.account.label);
    btnAccount.innerHTML = buildHeaderButtonMarkup(HEADER_ICON_PATHS.account);
    btnAccount.style.display = 'none';

    const themeBtn = qs('[data-theme-toggle]', actions);
    actions.insertBefore(btnAccount, themeBtn || actions.lastChild);
  } else {
    btnAccount.classList.add('btn--has-icon', 'header__btn--account', 'btn--icon-only');
    btnAccount.setAttribute('aria-label', HEADER_ICON_PATHS.account.label);
    if (!btnAccount.querySelector('.btn__icon')) {
      btnAccount.innerHTML = buildHeaderButtonMarkup(HEADER_ICON_PATHS.account);
    }
  }
  return btnAccount;
}

function setAuthUI(isLogged) {
  const btnLogin = qsa('[data-open="modal-login"]');
  const btnSignup = qsa('[data-open="modal-signup"]');
  const btnAccount = qs('#btn-account') || ensureAccountButton();
  const btnLogout = qs('#btn-logout');

  btnLogin.forEach(
    (b) => b instanceof HTMLElement && (b.style.display = isLogged ? 'none' : '')
  );
  btnSignup.forEach(
    (b) => b instanceof HTMLElement && (b.style.display = isLogged ? 'none' : '')
  );

  if (btnAccount) btnAccount.style.display = isLogged ? '' : 'none';
  if (btnLogout) btnLogout.style.display = isLogged ? '' : 'none';
}

function restoreSessionAuth() {
  const hasToken = !!getSessionToken();
  setAuthUI(hasToken);
}

function initAuthForms() {
  const signupForm = qs('#modal-signup .form');
  const loginForm = qs('#modal-login .form');

  // 1. Validadores específicos para autenticación
  const authValidators = {
    email: (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '') ? '' : 'Ingresa un correo válido',
    password: (v) =>
      v && v.length >= 8 ? '' : 'La contraseña debe tener al menos 8 caracteres',
    loginPassword: (v) =>
      v && v.length > 0 ? '' : 'Ingresa tu contraseña',
    name: (v) => // <-- NUEVO
      v && v.length >= 2 ? '' : 'El nombre debe tener al menos 2 caracteres',
  };

  if (signupForm) {
    on(signupForm, 'submit', async (e) => {
      e.preventDefault();

      const btn = qs('button[type="submit"]', signupForm);
      const nameEl = qs('#signup-name', signupForm); // <-- NUEVO
      const emailEl = qs('#signup-email', signupForm);
      const passwordEl = qs('#signup-password', signupForm);
      const terms = qs('#signup-terms', signupForm);

      // 2. Obtener elementos de error
      const errName = qs('#error-signup-name', signupForm); // <-- NUEVO
      const errEmail = qs('#error-signup-email', signupForm);
      const errPass = qs('#error-signup-password', signupForm);
      const errTerms = qs('#error-signup-terms', signupForm);

      // <-- MODIFICADO
      if (!emailEl || !passwordEl || !btn || !terms || !errEmail || !errPass || !errTerms || !nameEl || !errName) return;

      // 3. Ocultar errores previos
      hideFieldError(errName); // <-- NUEVO
      hideFieldError(errEmail);
      hideFieldError(errPass);
      hideFieldError(errTerms);

      // 4. Ejecutar validaciones
      const errors = {
        name: authValidators.name(nameEl.value), // <-- NUEVO
        email: authValidators.email(emailEl.value),
        password: authValidators.password(passwordEl.value),
        terms: !terms.checked ? 'Debes aceptar los términos' : ''
      };

      let invalid = false;
      if (errors.name) { showFieldError(errName, errors.name); invalid = true; } // <-- NUEVO
      if (errors.email) { showFieldError(errEmail, errors.email); invalid = true; }
      if (errors.password) { showFieldError(errPass, errors.password); invalid = true; }
      if (errors.terms) { showFieldError(errTerms, errors.terms); invalid = true; }

      // 5. Detener si hay errores
      if (invalid) return;

    
      btn.disabled = true;
      btn.textContent = 'Registrando...';

      try {
        const res = await safeFetch(
          '/api/register',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: nameEl.value, // <-- NUEVO
              email: emailEl.value,
              password: passwordEl.value,
              terms: true,
            }),
          }
        );

        const data = await res.json();
        if (res.ok) {
          toast.success(data.message || '¡Registro exitoso! Revisa tu correo.');
          SignupModal.close();
          signupForm.reset();
        } else {
          toast.error(data.error || `Error (${res.status}): No se pudo registrar.`);
        }
      } catch {
        toast.error('Error de red.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Crear cuenta';
      }
    });
  }

  if (loginForm) {
    on(loginForm, 'submit', async (e) => {
      e.preventDefault();

      const btn = qs('button[type="submit"]', loginForm);
      const emailEl = qs('#login-email', loginForm);
      const passwordEl = qs('#login-password', loginForm);

      // 2. Obtener elementos de error
      const errEmail = qs('#error-login-email', loginForm);
      const errPass = qs('#error-login-password', loginForm);

      if (!emailEl || !passwordEl || !btn || !errEmail || !errPass) return;

      // 3. Ocultar errores previos
      hideFieldError(errEmail);
      hideFieldError(errPass);

      // 4. Ejecutar validaciones
      const errors = {
        email: authValidators.email(emailEl.value),
        password: authValidators.loginPassword(passwordEl.value), // Solo revisa que no esté vacío
      };

      let invalid = false;
      if (errors.email) { showFieldError(errEmail, errors.email); invalid = true; }
      if (errors.password) { showFieldError(errPass, errors.password); invalid = true; }
      
      // 5. Detener si hay errores
      if (invalid) return;

      // --- Solo si la validación pasa, continuamos ---
      btn.disabled = true;
      btn.textContent = 'Entrando...';

      try {
        const res = await safeFetch(
          '/api/login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: emailEl.value,
              password: passwordEl.value,
            }),
          }
        );

        const data = await res.json();
        if (res.ok) {
          toast.success(data.message || '¡Bienvenido de nuevo!');
          if (data.session_token) setSessionToken(data.session_token);
          setAuthUI(true);
          window.dispatchEvent(new CustomEvent('ecuplot:login'));
          LoginModal.close();
          loginForm.reset();
        } else {
          toast.error(data.error || `Error (${res.status}): Credenciales inválidas.`);
        }
      } catch {
        toast.error('Error de red.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });
  }
}

// Verificación de correo
function checkEmailVerification() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('verified') && params.get('verified') === 'true') {
    toast.success('¡Correo verificado! Ya puedes iniciar sesión.', 8000);
    history.replaceState(null, '', window.location.pathname);
    LoginModal.open();
  }

  const error = params.get('error');
  if (error) {
    let message = 'Ocurrió un error de verificación.';
    if (error === 'invalid_token') message = 'El enlace de verificación no es válido.';
    if (error === 'token_used') message = 'El enlace de verificación ya fue utilizado.';
    if (error === 'token_expired') message = 'El enlace de verificación ha expirado.';
    toast.error(message, 8000);
    history.replaceState(null, '', window.location.pathname);
  }
}

// Proteccion de historial de graficas
async function savePlot(expression, plot_parameters = null, plot_metadata = null) {
  const res = await authFetch('/api/plot', {
    method: 'POST',
    body: JSON.stringify({ expression, plot_parameters, plot_metadata }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'No se pudo guardar el historial');
  return data;
}

// Cierre de sesión
async function logout() {
  try {
    await authFetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Logout request failed:', e);
  } finally {
    localStorage.removeItem(KEYS.sessionToken);
    setAuthUI(false);
    window.dispatchEvent(new CustomEvent('ecuplot:logout'));
    toast.success('Sesión cerrada.');
  }
}

function bindLogout() {
  const btn = qs('#btn-logout');
  if (btn) on(btn, 'click', (e) => {
    e.preventDefault();
    logout();
  });
}

// Iniciador
function init() {
  initTheme();
  DrawerController.bind();
  LoginModal.bind?.();
  SignupModal.bind?.();

  bindDrawerLinkClosing();
  initScrollSpy();
  BackendStatus.check();
  initContactForm();
  setCurrentYear();
  bindGlobalTriggers();

  restoreSessionAuth();
  initAuthForms();
  bindLogout();
  checkEmailVerification();
}

init();

export { toggleTheme, authFetch, savePlot, logout, toast };
