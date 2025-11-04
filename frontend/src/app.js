import {
  qs,
  qsa,
  toggleClass,
  setAria,
  toggleAriaExpanded,
} from './lib/dom.js';
import { on, off, debounce } from './lib/events.js';
import { contactValidators, authValidators, validate } from './lib/validators.js';
import { setSessionToken, clearSessionToken, hasSessionToken } from './lib/session.js';
import { initThemeSync, setThemePreference, getThemePreference } from './lib/theme.js';
import { createEventStream } from './lib/event-stream.js';

const SELECTORS = {
  siteHeader: '#site-header',
  primaryNav: '#primary-nav',
  drawer: '#mobile-drawer',
  drawerOverlay: '.drawer__overlay',
  drawerToggle: '[data-drawer-toggle]',
  themeToggle: '[data-theme-toggle]',
  backendStatus: '[data-status]',
  ctaGraficar: '#cta-graficar',
  sections: ['#hero', '#features', '#learn', '#about', '#contact'],
  contactForm: '#contact-form',
  contactErrorsGlobal: '#contact-form-errors',
  errorName: '#error-contact-name',
  errorEmail: '#error-contact-email',
  errorMessage: '#error-contact-message',
  toasts: '#toasts',
  year: '[data-year]',
  rootFallback: '#root',

  signupForm: '#signup-form',
  signupEmail: '#signup-email',
  signupPassword: '#signup-password',
  signupPasswordConfirm: '#signup-password-confirm',
  signupTerms: '#signup-terms',
  loginForm: '#login-form',
  loginEmail: '#login-email',
  loginPassword: '#login-password',
  forgotForm: '#forgot-form',
  forgotEmail: '#forgot-email',
  errorForgotEmail: '#error-forgot-email',
  btnLogout: '#btn-logout',
  btnAccount: '#btn-account',
};

const LEARN_HASHES = new Set([
  '#learn',
  '#docs',
  '#documentacion',
  '#how-it-works',
  '#como-funciona',
  '#como-usar',
]);

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

const USER_STATE_KEY = 'ecuplot.currentUser';

const userState = {
  current: null,
};

function loadStoredUser() {
  try {
    const raw = sessionStorage.getItem(USER_STATE_KEY);
    if (!raw) {
      userState.current = null;
      return null;
    }
    const parsed = JSON.parse(raw);
    userState.current = parsed;
    return parsed;
  } catch {
    userState.current = null;
    return null;
  }
}

function initForgotPassword() {
  const forgotForm = qs(SELECTORS.forgotForm);
  if (!forgotForm) return;

  const emailInput = qs(SELECTORS.forgotEmail, forgotForm);
  const submitBtn = qs('button[type="submit"]', forgotForm);
  const errorEmail = qs(SELECTORS.errorForgotEmail, forgotForm);

  on(forgotForm, 'submit', async (event) => {
    event.preventDefault();
    if (!emailInput || !submitBtn) return;

    const values = { email: emailInput.value };
    const errors = validate({ email: authValidators.email }, values);
    const invalid = renderErrors(errors, { email: errorEmail });
    if (invalid) return;

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const res = await safeFetch(
        '/api/password/forgot',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: values.email }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(
          data.message || 'Si existe una cuenta con ese correo, enviaremos instrucciones.',
          8000
        );
        forgotForm.reset();
        hideFieldError(errorEmail);
      } else {
        toast.error(data.error || 'No se pudo enviar la solicitud de restablecimiento.');
      }
    } catch (error) {
      console.error('Password reset request failed', error);
      toast.error('Error de red.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel || 'Enviar instrucciones';
    }
  });
}

function initResetPasswordPage() {
  const form = qs('#reset-password-form');
  if (!form) return;

  const passwordInput = /** @type {HTMLInputElement|null} */ (qs('#reset-password', form));
  const confirmInput = /** @type {HTMLInputElement|null} */ (qs('#reset-password-confirm', form));
  const submitBtn = qs('button[type="submit"]', form);
  const tokenField = /** @type {HTMLInputElement|null} */ (qs('#reset-token', form));
  const errorPassword = qs('#error-reset-password', form);
  const errorConfirm = qs('#error-reset-password-confirm', form);
  const statusMessage = qs('#reset-password-status');

  const resetMeter = passwordInput ? createPasswordMeter(passwordInput, 'reset-strength') : null;
  if (resetMeter && passwordInput) {
    on(passwordInput, 'input', () => resetMeter.update(passwordInput.value));
    on(form, 'reset', () => resetMeter.update(passwordInput.value || ''));
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    if (statusMessage) {
      statusMessage.textContent = 'El enlace de restablecimiento no es válido.';
      statusMessage.classList.add('status-message', 'status-message--error');
    }
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (tokenField) tokenField.value = token;

  on(form, 'submit', async (event) => {
    event.preventDefault();
    if (!passwordInput || !confirmInput || !submitBtn) return;

    if (statusMessage) {
      statusMessage.textContent = '';
      statusMessage.classList.remove('status-message--error');
    }

    const values = {
      password: passwordInput.value,
      passwordConfirm: confirmInput.value,
    };

    const errors = validate(
      {
        password: authValidators.password,
        passwordConfirm: authValidators.passwordConfirm,
      },
      values
    );

    const invalid = renderErrors(errors, {
      password: errorPassword,
      passwordConfirm: errorConfirm,
    });
    if (invalid) return;

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Actualizando...';

    try {
      const res = await safeFetch(
        '/api/password/reset',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            password: values.password,
            password_confirm: values.passwordConfirm,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message || 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.', 8000);
        setTimeout(() => {
          window.location.href = '/?reset=success';
        }, 600);
      } else {
        const msg = data.error || 'No se pudo restablecer la contraseña.';
        toast.error(msg);
        if (statusMessage) {
          statusMessage.textContent = msg;
          statusMessage.classList.add('status-message', 'status-message--error');
        }
      }
    } catch (error) {
      console.error('Reset password request failed', error);
      toast.error('Error de red.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel || 'Actualizar contraseña';
    }
  });
}

function setCurrentUser(user, { emit = true } = {}) {
  userState.current = user ? { ...user } : null;
  try {
    if (user) sessionStorage.setItem(USER_STATE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_STATE_KEY);
  } catch {}
  if (user) maybeShowTwoFactorReminder(user);
  BackendStatus.update?.(userState.current);
  if (emit) {
    window.dispatchEvent(new CustomEvent('ecuplot:user', { detail: userState.current }));
  }
}

function getCurrentUser() {
  return userState.current;
}

async function refreshCurrentUser() {
  try {
    const res = await authFetch('/api/user/me');
    const status = res.status;
    if (!res.ok) {
      clearSessionToken();
      setAuthUI(false);
      eventStream.disconnect();
      setCurrentUser(null);
      return { user: null, status };
    }
    const data = await res.json();
    setSessionToken();
    setAuthUI(true);
    eventStream.ensure();
    setCurrentUser(data);
    return { user: data, status };
  } catch (error) {
    clearSessionToken();
    setAuthUI(false);
    eventStream.disconnect();
    setCurrentUser(null);
    return { user: null, status: 500, error };
  }
}

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
  statusDegraded: 'status--degraded',
  statusError: 'status--error',
  statusUnknown: 'status--unknown',
};

const STATUS_CLASSES = [
  CLASSNAMES.statusLoading,
  CLASSNAMES.statusOk,
  CLASSNAMES.statusDegraded,
  CLASSNAMES.statusError,
  CLASSNAMES.statusUnknown,
];

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

function showFieldError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.add('is-visible');
  element.setAttribute('aria-hidden', String(!message));
}

function hideFieldError(element) {
  if (!element) return;
  element.textContent = '';
  element.classList.remove('is-visible');
  element.setAttribute('aria-hidden', 'true');
}

/**
 * @param {Record<string, string>} errors
 * @param {Record<string, Element|null|undefined>} fields
 */
function renderErrors(errors, fields) {
  let hasError = false;
  for (const [name, message] of Object.entries(errors)) {
    const target = fields[name];
    if (!target) continue;
    if (message) {
      showFieldError(target, message);
      hasError = true;
    } else {
      hideFieldError(target);
    }
  }
  return hasError;
}

function initPasswordToggles() {
  const toggles = qsa('[data-password-toggle]');
  toggles.forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const targetId = btn.getAttribute('data-password-toggle');
    if (!targetId) return;
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(targetId));
    if (!input) return;

    const showIcon = btn.querySelector('[data-icon="show"]');
    const hideIcon = btn.querySelector('[data-icon="hide"]');

    const applyState = () => {
      const isVisible = input.type === 'text';
      if (showIcon instanceof HTMLElement) showIcon.hidden = isVisible;
      if (hideIcon instanceof HTMLElement) hideIcon.hidden = !isVisible;
      btn.setAttribute('aria-label', isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
      btn.setAttribute('aria-pressed', String(isVisible));
    };

    applyState();

    on(btn, 'click', (event) => {
      event.preventDefault();
      const willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      applyState();
      input.focus();
    });
  });
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

function evaluatePasswordStrength(password) {
  if (!password) {
    return { level: 0, label: 'Sin contraseña', hint: 'Escribe una contraseña segura.' };
  }

  const checks = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/];
  let score = checks.reduce((acc, regex) => (regex.test(password) ? acc + 1 : acc), 0);
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  let level = 1;
  if (password.length < 8 || score <= 2) level = 1;
  else if (score === 3) level = 2;
  else if (score === 4) level = 3;
  else level = 4;

  const labels = {
    0: 'Sin contraseña',
    1: 'Débil',
    2: 'Aceptable',
    3: 'Buena',
    4: 'Fuerte',
  };

  return {
    level,
    label: labels[level] || labels[1],
    hint: level >= 3 ? 'Contraseña segura.' : 'Usa mayúsculas, minúsculas, números y símbolos.',
  };
}

function createPasswordMeter(input, idSuffix) {
  if (!input) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'password-meter';
  const meterId = `${input.id || 'password'}-${idSuffix || 'strength'}`;
  wrapper.id = meterId;
  wrapper.setAttribute('role', 'status');
  wrapper.setAttribute('aria-live', 'polite');
  wrapper.setAttribute('aria-atomic', 'true');

  const bar = document.createElement('div');
  bar.className = 'password-meter__bar';
  const fill = document.createElement('div');
  fill.className = 'password-meter__fill';
  fill.setAttribute('aria-hidden', 'true');
  bar.appendChild(fill);

  const label = document.createElement('span');
  label.className = 'password-meter__label';
  label.textContent = 'Fortaleza: ';

  const value = document.createElement('strong');
  value.className = 'password-meter__value';
  label.appendChild(value);

  const hint = document.createElement('span');
  hint.className = 'password-meter__hint';

  wrapper.appendChild(bar);
  wrapper.appendChild(label);
  wrapper.appendChild(hint);

  const container = input.closest('.password-input');
  if (container instanceof HTMLElement) {
    container.insertAdjacentElement('afterend', wrapper);
  } else {
    input.insertAdjacentElement('afterend', wrapper);
  }

  const describedBy = input.getAttribute('aria-describedby');
  if (describedBy) {
    if (!describedBy.includes(meterId)) {
      input.setAttribute('aria-describedby', `${describedBy} ${meterId}`.trim());
    }
  } else {
    input.setAttribute('aria-describedby', meterId);
  }

  const update = (password) => {
    const strength = evaluatePasswordStrength(password);
    const clamped = Math.max(0, Math.min(4, strength.level));
    wrapper.dataset.strength = String(clamped);
    fill.style.transform = `scaleX(${clamped / 4})`;
    value.textContent = strength.label;
    hint.textContent = strength.hint;
    wrapper.setAttribute('aria-label', `Fortaleza de contraseña: ${strength.label}. ${strength.hint}`);
    return strength;
  };

  update(input.value || '');

  return { update, element: wrapper };
}

async function loadAppEnvironment() {
  if (appEnvironment && appEnvironment !== 'pending') {
    return appEnvironment;
  }
  appEnvironment = 'pending';
  try {
    const res = await safeFetch('/api/meta/env', {}, 3000);
    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      appEnvironment = String(data?.env || 'production').toLowerCase();
      demoModeEnabled = Boolean(data?.demo_mode);
      return appEnvironment;
    }
  } catch (error) {
    console.warn('No se pudo obtener el entorno de la app', error);
  }
  appEnvironment = 'production';
  demoModeEnabled = false;
  return appEnvironment;
}

function addDemoButton(form, fillFn) {
  if (!form || typeof fillFn !== 'function') return;
  if (form.dataset.demoAttached) return;
  const actions = form.querySelector('.form__actions') || form;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--ghost btn--sm form__demo-btn';
  btn.textContent = 'Rellenar demo';
  actions.appendChild(btn);
  on(btn, 'click', (event) => {
    event.preventDefault();
    fillFn();
    toast?.info?.('Datos de ejemplo cargados.');
  });
  form.dataset.demoAttached = 'true';
}

function enableDemoMode() {
  const loginForm = qs(SELECTORS.loginForm);
  if (loginForm) {
    addDemoButton(loginForm, () => {
      const email = qs(SELECTORS.loginEmail, loginForm);
      const password = qs(SELECTORS.loginPassword, loginForm);
      if (email instanceof HTMLInputElement) email.value = 'demo@ecuplot.test';
      if (password instanceof HTMLInputElement) {
        password.value = 'DemoPass.123';
        password.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  const signupForm = qs(SELECTORS.signupForm);
  if (signupForm) {
    addDemoButton(signupForm, () => {
      const nameInput = qs('#signup-name', signupForm);
      const emailInput = qs('#signup-email', signupForm);
      const passwordInput = qs(SELECTORS.signupPassword, signupForm);
      const confirmInput = qs(SELECTORS.signupPasswordConfirm, signupForm);
      const terms = qs(SELECTORS.signupTerms, signupForm);

      if (nameInput instanceof HTMLInputElement) nameInput.value = 'Ana Ejemplo';
      if (emailInput instanceof HTMLInputElement) emailInput.value = 'demo.usuario@ecuplot.test';
      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.value = 'DemoPass.123';
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (confirmInput instanceof HTMLInputElement) confirmInput.value = 'DemoPass.123';
      if (terms instanceof HTMLInputElement) terms.checked = true;
    });
  }
}

function maybeShowTwoFactorReminder(user) {
  if (!user || user.two_factor_enabled) return;
  try {
    if (sessionStorage.getItem(TWOFA_REMINDER_KEY)) return;
    sessionStorage.setItem(TWOFA_REMINDER_KEY, '1');
  } catch (error) {
    /* ignore */
  }
  toast?.info?.('Refuerza tu cuenta: activa la verificación en dos pasos desde tu perfil.', 10000);
}

const THEME_LABELS = {
  light: 'Tema claro',
  dark: 'Tema oscuro',
  system: 'Tema según el sistema',
};

initThemeSync();
const eventStream = createEventStream();
let appEnvironment = 'production';
let demoModeEnabled = false;
const TWOFA_REMINDER_KEY = 'ecuplot.2fa-reminder';

function bindThemeSelector() {
  const switcher = qs('[data-theme-switcher]');
  if (!switcher) return;

  const trigger = qs('[data-theme-menu-trigger]', switcher);
  const menu = qs('[data-theme-menu]', switcher);
  if (!trigger || !menu) return;

  const options = Array.from(qsa('[data-theme-option]', menu)).filter((node) => node instanceof HTMLElement);
  if (!options.length) return;

  let isOpen = false;

  const closeMenu = () => {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const active = options.find((opt) => opt.getAttribute('aria-checked') === 'true');
    (active || options[0]).focus({ preventScroll: true });
  };

  const toggleMenu = () => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  const describeSelection = (pref) => {
    const label = THEME_LABELS[pref] || 'Tema';
    trigger.setAttribute('aria-label', `${label}. Cambiar tema`);
    trigger.dataset.themeCurrent = pref;
  };

  const updateActive = () => {
    const pref = getThemePreference();
    options.forEach((opt) => {
      const value = opt.dataset.themeOption || '';
      const isActive = value === pref;
      opt.setAttribute('aria-checked', String(isActive));
      opt.classList.toggle('is-active', isActive);
    });
    describeSelection(pref);
  };

  on(trigger, 'click', (event) => {
    event.preventDefault();
    toggleMenu();
  });

  on(trigger, 'keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  });

  options.forEach((option) => {
    on(option, 'click', (event) => {
      event.preventDefault();
      const value = option.dataset.themeOption;
      if (!value) return;
      setThemePreference(value);
      updateActive();
      closeMenu();
    });
    on(option, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        trigger.focus();
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        const currentIndex = options.indexOf(option);
        const nextIndex = (currentIndex + dir + options.length) % options.length;
        options[nextIndex]?.focus();
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        option.click();
      }
    });
  });

  on(document, 'click', (event) => {
    if (!isOpen) return;
    if (event.target instanceof Node && !switcher.contains(event.target)) {
      closeMenu();
    }
  });

  on(document, 'keydown', (event) => {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      trigger.focus();
    }
  });

  updateActive();
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
const ForgotModal = createModalController('#modal-forgot');


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
  links.forEach((link) => {
    const hash = link.getAttribute('href');
    if (!hash || !hash.startsWith('#')) return;
    const section = qs(hash);
    if (!section) return;
    const stored = map.get(section) || [];
    stored.push(link);
    map.set(section, stored);
  });

  const setCurrent = (targets = []) => {
    links.forEach((a) => a.removeAttribute('aria-current'));
    targets.forEach((el) => el?.setAttribute('aria-current', 'page'));
  };

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const group = map.get(entry.target);
        if (!group) return;
        if (entry.isIntersecting) setCurrent(group);
      });
    },
    {
      rootMargin: `-80px 0px -70% 0px`,
      threshold: [0.1, 0.6],
    }
  );

  map.forEach((_, sec) => obs.observe(sec));
}

function ensureStatusSlots(element) {
  if (!element) return { label: null, badges: null };
  let label = element.querySelector('[data-status-label]');
  if (!label) {
    label = document.createElement('span');
    label.dataset.statusLabel = 'true';
    label.className = 'status__label';
    element.appendChild(label);
  }
  let badges = element.querySelector('[data-status-badges]');
  if (!badges) {
    badges = document.createElement('span');
    badges.dataset.statusBadges = 'true';
    badges.className = 'status__badges';
    badges.hidden = true;
    element.appendChild(badges);
  }
  return { label, badges };
}

/** Estado backend: solo si hay [data-status] en la página */
function setStatus(element, modifierClass, message, badges = []) {
  if (!element) return;
  const { label, badges: badgesContainer } = ensureStatusSlots(element);

  if (label) label.textContent = message;
  else element.textContent = message;

  STATUS_CLASSES.forEach((n) => element.classList.remove(n));
  if (modifierClass) element.classList.add(modifierClass);

  if (badgesContainer) {
    badgesContainer.replaceChildren();
    if (Array.isArray(badges) && badges.length) {
      badges.forEach((badgeData) => {
        const badgeLabel = badgeData?.label;
        if (!badgeLabel) return;
        const badge = document.createElement('span');
        const variant = badgeData?.variant ? ` status-badge--${badgeData.variant}` : '';
        badge.className = `status-badge${variant}`;
        badge.textContent = badgeLabel;
        badgesContainer.appendChild(badge);
      });
      badgesContainer.hidden = false;
    } else {
      badgesContainer.hidden = true;
    }
  }

  if (modifierClass) {
    element.dataset.statusLevel = modifierClass.replace('status--', '');
  } else {
    delete element.dataset.statusLevel;
  }
}

const BackendStatus = (() => {
  const statusEl = qs('[data-status]');
  if (!statusEl) {
    return {
      check: () => false,
      enable: () => {},
      disable: () => {},
      update: () => {},
    };
  }

  let timerId = null;
  let enabled = false;
  let ariaPrepared = false;

  function clearTimer() {
    if (timerId) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  }

  function setVisible(flag) {
    statusEl.hidden = !flag;
    statusEl.setAttribute('aria-hidden', flag ? 'false' : 'true');
  }

  setVisible(false);

  const INDICATOR_LABELS = {
    database: 'Base de datos',
    mail: 'Cola de correo',
    system: 'Carga del sistema',
  };

  function normalizeStatus(value) {
    return String(value || 'unknown').toLowerCase();
  }

  function resolveVariant(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'ok') return CLASSNAMES.statusOk;
    if (normalized === 'degraded') return CLASSNAMES.statusDegraded;
    if (normalized === 'error') return CLASSNAMES.statusError;
    return CLASSNAMES.statusUnknown;
  }

  function badgeVariant(status) {
    if (status === 'critical' || status === 'error') return 'critical';
    if (status === 'warning') return 'warning';
    return 'unknown';
  }

  function buildBadges(indicators) {
    if (!indicators || typeof indicators !== 'object') return [];
    return Object.entries(indicators)
      .map(([key, status]) => {
        const normalized = normalizeStatus(status);
        return {
          key,
          label: INDICATOR_LABELS[key] || key,
          variant: badgeVariant(normalized),
          status: normalized,
        };
      })
      .filter((item) => item.status !== 'ok');
  }

  function buildMessage(status, badges) {
    const normalized = normalizeStatus(status);
    if (normalized === 'ok') return 'Backend operativo';
    if (normalized === 'degraded') {
      if (Array.isArray(badges) && badges.length) {
        const summary = badges.map((badge) => badge.label).join(', ');
        return `Backend degradado (${summary})`;
      }
      return 'Backend degradado';
    }
    if (normalized === 'error') return 'Backend con incidencias';
    return 'Estado del backend desconocido';
  }

  function scheduleNext(delayMs) {
    if (!enabled) return;
    clearTimer();
    timerId = window.setTimeout(() => {
      check();
    }, delayMs);
  }

  async function check() {
    if (!enabled) return false;
    clearTimer();

    let lastStatus = 'unknown';

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!enabled) return false;
      try {
        const res = await safeFetch('/api/health', {}, 3000);
        let payload = null;
        try {
          payload = await res.json();
        } catch {}

        const status = normalizeStatus(payload?.status ?? (res.ok ? 'unknown' : 'error'));
        const badges = buildBadges(payload?.indicators);

        if (!res.ok) {
          const message = payload?.status
            ? buildMessage(status, badges)
            : `Backend con incidencias (HTTP ${res.status})`;
          if (enabled) setStatus(statusEl, resolveVariant(status), message, badges);
          lastStatus = status;
          break;
        }

        const message = buildMessage(status, badges);
        if (enabled) setStatus(statusEl, resolveVariant(status), message, badges);
        lastStatus = status;
        break;
      } catch (err) {
        if (attempt === 3) {
          console.error('No se pudo verificar el backend', err);
          if (enabled) setStatus(statusEl, CLASSNAMES.statusError, 'Estado del backend: error al conectar');
          lastStatus = 'error';
          break;
        }
        const backoff = Math.min(4000, Math.floor(1500 * Math.pow(1.5, attempt)));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    if (!enabled) return false;

    const delay = lastStatus === 'ok' ? 60000 : 30000;
    scheduleNext(delay);
    return lastStatus === 'ok';
  }

  function enable() {
    if (enabled) return check();
    enabled = true;
    if (!ariaPrepared) {
      setAria(statusEl, { live: 'polite' });
      statusEl.setAttribute('role', 'status');
      ariaPrepared = true;
    }
    STATUS_CLASSES.forEach((cls) => statusEl.classList.remove(cls));
    delete statusEl.dataset.statusLevel;
    setVisible(true);
    setStatus(statusEl, CLASSNAMES.statusLoading, 'Verificando estado del backend…');
    return check();
  }

  function disable() {
    if (!enabled && statusEl.hidden === true) return;
    enabled = false;
    clearTimer();
    STATUS_CLASSES.forEach((cls) => statusEl.classList.remove(cls));
    delete statusEl.dataset.statusLevel;
    setVisible(false);
  }

  function collectRoles(user) {
    const roles = new Set();
    if (!user) return roles;
    if (user.role) roles.add(String(user.role).toLowerCase());
    if (Array.isArray(user.roles)) {
      user.roles.forEach((role) => {
        if (role) roles.add(String(role).toLowerCase());
      });
    }
    return roles;
  }

  function update(user) {
    const roles = collectRoles(user);
    if (roles.has('development')) enable();
    else disable();
  }

  return { check, enable, disable, update };
})();

// notificaciones/toasts
/**
 * @type {{
 *   success: (message: string, timeout?: number) => void,
 *   error: (message: string, timeout?: number) => void,
 *   info: (message: string, timeout?: number) => void,
 *   warn: (message: string, timeout?: number) => void,
 * }}
 */
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

function isLearnHash(hash) {
  if (typeof hash !== 'string') return false;
  return LEARN_HASHES.has(hash.toLowerCase());
}

function scrollToLearn(hash = '#learn', { updateHistory = false, behavior } = {}) {
  const section = qs('#learn');
  if (!section) return;

  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollBehavior = behavior || (prefersReduced ? 'auto' : 'smooth');

  section.scrollIntoView({ block: 'start', behavior: scrollBehavior });

  const delay = scrollBehavior === 'smooth' ? 320 : 0;
  setTimeout(() => {
    if (typeof section.focus === 'function') {
      section.focus({ preventScroll: true });
    }
  }, delay);

  if (updateHistory) {
    const targetHash = hash && hash.startsWith('#') ? hash : '#learn';
    history.replaceState(null, '', targetHash);
  }
}

function initLearnAnchors() {
  const section = qs('#learn');
  if (!section) return;

  qsa('a[data-learn-alias]').forEach((link) => {
    on(link, 'click', (event) => {
      event.preventDefault();
      const alias = link.dataset.learnAlias ? `#${link.dataset.learnAlias}` : '#learn';
      scrollToLearn(alias, { updateHistory: true });
    });
  });

  window.addEventListener('hashchange', () => {
    const { hash } = window.location;
    if (!isLearnHash(hash) || hash === '#learn') return;
    scrollToLearn(hash, { updateHistory: true });
  });

  const initialHash = window.location.hash;
  if (isLearnHash(initialHash) && initialHash !== '#learn') {
    scrollToLearn(initialHash, { updateHistory: true, behavior: 'auto' });
  }
}

function initLearnCarousel() {
  const track = qs('[data-learn-track]');
  const slides = track ? Array.from(qsa('[data-learn-slide]', track)) : [];
  const prevBtn = qs('[data-learn-prev]');
  const nextBtn = qs('[data-learn-next]');
  const status = qs('[data-learn-status]');

  if (!track || slides.length === 0) {
    bindSnippetChips();
    return;
  }

  slides.forEach((slide) => {
    if (!slide.hasAttribute('tabindex')) slide.setAttribute('tabindex', '-1');
  });

  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    slides.forEach((slide) => slide.classList.add('is-visible'));
  } else {
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-visible');
        });
      },
      { root: track, threshold: 0.4 }
    );
    slides.forEach((slide) => visibilityObserver.observe(slide));
  }
  let currentIndex = 0;
  let pointerId = null;
  let startX = 0;
  let scrollStart = 0;
  let dragging = false;
  let ignoreClick = false;

  const updateControls = (index) => {
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= slides.length - 1;
    if (status) status.textContent = `Tarjeta ${index + 1} de ${slides.length}`;
  };

  const applyClasses = (index) => {
    slides.forEach((slide, idx) => {
      slide.classList.toggle('is-active', idx === index);
      slide.classList.toggle('is-near', Math.abs(idx - index) === 1);
    });
    updateControls(index);
  };

  const detectActive = () => {
    const trackRect = track.getBoundingClientRect();
    const center = trackRect.left + trackRect.width / 2;
    let bestIndex = currentIndex;
    let bestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, idx) => {
      const rect = slide.getBoundingClientRect();
      const slideCenter = rect.left + rect.width / 2;
      const distance = Math.abs(center - slideCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = idx;
      }
    });
    currentIndex = bestIndex;
    applyClasses(currentIndex);
  };

  const debouncedDetect = debounce(detectActive, 90);
  on(track, 'scroll', () => {
    debouncedDetect();
  });

  const goTo = (index, { focus = false } = {}) => {
    const clamped = Math.min(slides.length - 1, Math.max(0, index));
    const target = slides[clamped];
    if (!target) return;
    target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
    currentIndex = clamped;
    applyClasses(currentIndex);
    if (focus) {
      setTimeout(() => target.focus?.({ preventScroll: true }), prefersReduced ? 0 : 280);
    }
  };

  if (prevBtn) {
    on(prevBtn, 'click', () => {
      goTo(currentIndex - 1, { focus: true });
    });
  }

  if (nextBtn) {
    on(nextBtn, 'click', () => {
      goTo(currentIndex + 1, { focus: true });
    });
  }

  on(track, 'keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(currentIndex + 1, { focus: true });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(currentIndex - 1, { focus: true });
    }
  });

  on(track, 'wheel', (event) => {
    if (!event.shiftKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    track.scrollLeft += event.deltaY;
  }, { passive: false });

  on(track, 'pointerdown', (event) => {
    if (!(event instanceof PointerEvent)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('button, a, input, textarea')) return;
    dragging = true;
    ignoreClick = false;
    startX = event.clientX;
    scrollStart = track.scrollLeft;
    pointerId = event.pointerId;
    track.classList.add('is-dragging');
    track.dataset.dragging = 'false';
    track.setPointerCapture?.(pointerId);
  });

  on(track, 'pointermove', (event) => {
    if (!dragging || !(event instanceof PointerEvent)) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 4) {
      track.dataset.dragging = 'true';
      ignoreClick = true;
    }
    track.scrollLeft = scrollStart - delta;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-dragging');
    delete track.dataset.dragging;
    if (pointerId !== null) {
      try { track.releasePointerCapture?.(pointerId); } catch {}
      pointerId = null;
    }
    detectActive();
    setTimeout(() => {
      ignoreClick = false;
    }, 120);
  };

  on(track, 'pointerup', endDrag);
  on(track, 'pointercancel', endDrag);

  window.addEventListener('resize', debounce(detectActive, 120));

  bindSnippetChips(track, { shouldIgnore: () => ignoreClick });
  applyClasses(currentIndex);
  detectActive();
}

function bindSnippetChips(scope = document, options = {}) {
  const chips = Array.from(qsa('.chip[data-snippet]', scope));
  if (!chips.length) return;

  const shouldIgnore = typeof options.shouldIgnore === 'function'
    ? options.shouldIgnore
    : () => false;

  chips.forEach((chip) => {
    on(chip, 'click', async () => {
      const track = chip.closest('[data-learn-track]');
      if (track?.classList.contains('is-dragging')) return;
      if (shouldIgnore()) return;
      const snippet = chip.getAttribute('data-snippet');
      if (!snippet) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(snippet);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = snippet;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'absolute';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        chip.setAttribute('data-copied', 'true');
        toast.success('Ejemplo copiado al portapapeles.');
        setTimeout(() => chip.removeAttribute('data-copied'), 2000);
      } catch (error) {
        console.error('No se pudo copiar el ejemplo', error);
        toast.error('No se pudo copiar el ejemplo.');
      }
    });
  });
}

// Contacto
function initContactForm() {
  const form = qs(SELECTORS.contactForm);
  if (!form) return;

  const globalError = qs(SELECTORS.contactErrorsGlobal);
  const setGlobalErrors = (messages = []) => {
    if (!globalError) return;
    const list = globalError.querySelector('[data-global-error-messages]');
    if (!(list instanceof HTMLUListElement)) return;

    const items = Array.isArray(messages) ? messages.flat().filter(Boolean) : [messages].filter(Boolean);
    list.innerHTML = '';
    items.forEach((message) => {
      const li = document.createElement('li');
      li.textContent = String(message);
      list.appendChild(li);
    });

    const hasErrors = items.length > 0;
    globalError.classList.toggle('is-visible', hasErrors);
    globalError.setAttribute('aria-hidden', hasErrors ? 'false' : 'true');
  };
  const submitBtn = qs('button[type="submit"]', form);
  const fieldErrors = {
    name: qs(SELECTORS.errorName),
    email: qs(SELECTORS.errorEmail),
    message: qs(SELECTORS.errorMessage),
  };

  const clearGlobalMessage = () => {
    setGlobalErrors([]);
  };

  const showGlobalMessage = (message) => {
    setGlobalErrors([message]);
  };

  on(form, 'submit', async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const values = {
      name: String(fd.get('name') || ''),
      email: String(fd.get('email') || ''),
      message: String(fd.get('message') || ''),
    };

    Object.values(fieldErrors).forEach(hideFieldError);

    clearGlobalMessage();

    const errors = validate(contactValidators, values);
    const invalid = renderErrors(errors, fieldErrors);

    if (invalid) {
      showGlobalMessage('Por favor corrige los errores en el formulario.');
      return;
    }

    const originalLabel = submitBtn?.textContent;
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';
      }

      const res = await safeFetch(
        '/api/contact',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
        5000
      );

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        toast.success(data.message || 'Mensaje enviado. Gracias por escribirnos.');
        form.reset();
        return;
      }

      if (data?.fields && typeof data.fields === 'object') {
        renderErrors(
          {
            name: data.fields.name || '',
            email: data.fields.email || '',
            message: data.fields.message || '',
          },
          fieldErrors
        );
      }

      const errorMsg = data.error || 'No se pudo enviar tu mensaje.';
      if (!globalError) {
        toast.error(errorMsg);
      } else {
        showGlobalMessage(errorMsg);
      }
    } catch (error) {
      console.error('Contact request failed', error);
      toast.error('Error de red al enviar tu mensaje.');
      showGlobalMessage('No se pudo enviar el mensaje. Intenta nuevamente.');
    }
    finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel || 'Enviar';
      }
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
  const drawerBtn = qs('[data-drawer-toggle]');
  if (drawerBtn) {
    on(drawerBtn, 'click', (e) => {
      e.preventDefault();
      DrawerController.open();
    });
  }
}

// Utilidades de autenticación

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

/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && !(options.body instanceof FormData);
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const fetchOptions = {
    credentials: options.credentials ?? 'same-origin',
    ...options,
    headers,
  };
  return fetch(url, fetchOptions);
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
  const btnLogin = qsa('[data-auth-link="login"]');
  const btnSignup = qsa('[data-auth-link="signup"]');
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
  const isActive = hasSessionToken();
  setAuthUI(isActive);
  if (isActive) {
    eventStream.ensure();
    const cached = loadStoredUser();
    if (cached) {
      BackendStatus.update?.(cached);
      window.dispatchEvent(new CustomEvent('ecuplot:user', { detail: cached }));
    } else {
      BackendStatus.update?.(null);
    }
  } else {
    eventStream.disconnect();
    BackendStatus.update?.(null);
    setCurrentUser(null);
  }

  refreshCurrentUser();
}

function initAuthForms() {
  const signupForm = qs(SELECTORS.signupForm);
  const loginForm = qs(SELECTORS.loginForm);

  if (signupForm) {
    const signupErrors = {
      name: qs('#error-signup-name', signupForm),
      email: qs('#error-signup-email', signupForm),
      password: qs('#error-signup-password', signupForm),
      passwordConfirm: qs('#error-signup-password-confirm', signupForm),
      terms: qs('#error-signup-terms', signupForm),
      role: qs('#error-signup-role', signupForm),
    };

    const signupPasswordInput = qs(SELECTORS.signupPassword, signupForm);
    const signupPasswordMeter = signupPasswordInput instanceof HTMLInputElement
      ? createPasswordMeter(signupPasswordInput, 'signup-strength')
      : null;
    if (signupPasswordMeter && signupPasswordInput instanceof HTMLInputElement) {
      on(signupPasswordInput, 'input', () => signupPasswordMeter.update(signupPasswordInput.value));
      on(signupForm, 'reset', () => signupPasswordMeter.update(signupPasswordInput.value || ''));
    }

    on(signupForm, 'submit', async (event) => {
      event.preventDefault();

      const submitBtn = qs('button[type="submit"]', signupForm);
      const nameInput = qs('#signup-name', signupForm);
      const emailInput = qs('#signup-email', signupForm);
      const passwordInput = qs('#signup-password', signupForm);
      const passwordConfirmInput = qs('#signup-password-confirm', signupForm);
      const termsInput = /** @type {HTMLInputElement|null} */ (qs('#signup-terms', signupForm));
      const roleSelect = /** @type {HTMLSelectElement|null} */ (qs('#signup-role', signupForm));

      if (!submitBtn || !nameInput || !emailInput || !passwordInput || !passwordConfirmInput || !termsInput || !roleSelect) {
        return;
      }

      const values = {
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
        passwordConfirm: passwordConfirmInput.value,
        terms: termsInput.checked,
        role: roleSelect.value,
      };

      if (!['user', 'student'].includes(values.role)) {
        values.role = 'user';
        roleSelect.value = 'user';
      }

      const errors = validate(
        {
          name: authValidators.name,
          email: authValidators.email,
          password: authValidators.password,
          passwordConfirm: authValidators.passwordConfirm,
          terms: authValidators.terms,
          role: () => '',
        },
        values
      );

      const invalid = renderErrors(errors, signupErrors);
      if (invalid) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Registrando...';

      try {
        const res = await safeFetch(
          '/api/register',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: values.name,
              email: values.email,
              password: values.password,
              password_confirm: values.passwordConfirm,
              terms: true,
              role: values.role,
            }),
          }
        );

        const data = await res.json();
        if (res.ok) {
          toast.success(data.message || '¡Registro exitoso! Revisa tu correo.');
          signupForm.reset();
          if (signupPasswordMeter && signupPasswordInput instanceof HTMLInputElement) {
            signupPasswordMeter.update('');
          }
        } else {
          toast.error(data.error || `Error (${res.status}): No se pudo registrar.`);
        }
      } catch (error) {
        console.warn('Register request failed', error);
        toast.error('Error de red.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear cuenta';
      }
    });
  }

  if (loginForm) {
    const loginErrors = {
      email: qs('#error-login-email', loginForm),
      password: qs('#error-login-password', loginForm),
      otp: qs('#error-login-otp', loginForm),
    };

    const loginPasswordInput = qs(SELECTORS.loginPassword, loginForm);
    const loginPasswordMeter = loginPasswordInput instanceof HTMLInputElement
      ? createPasswordMeter(loginPasswordInput, 'login-strength')
      : null;
    if (loginPasswordMeter && loginPasswordInput instanceof HTMLInputElement) {
      on(loginPasswordInput, 'input', () => loginPasswordMeter.update(loginPasswordInput.value));
      on(loginForm, 'reset', () => loginPasswordMeter.update(loginPasswordInput.value || ''));
    }

    const otpField = loginForm.querySelector('[data-otp-field]');
    const otpInput = /** @type {HTMLInputElement|null} */ (qs('#login-otp', loginForm));
    let otpRequired = otpField instanceof HTMLElement ? !otpField.hasAttribute('hidden') : false;

    const setOtpVisible = (visible, message = '') => {
      if (!(otpField instanceof HTMLElement)) {
        otpRequired = false;
        return;
      }
      otpRequired = visible;
      otpField.hidden = !visible;
      otpField.classList.toggle('is-visible', visible);

      if (!visible) {
        if (otpInput) otpInput.value = '';
        hideFieldError(loginErrors.otp);
        return;
      }

      if (message) {
        showFieldError(loginErrors.otp, message);
      } else {
        hideFieldError(loginErrors.otp);
      }

      if (otpInput) {
        requestAnimationFrame(() => {
          otpInput.focus();
          otpInput.select();
        });
      }
    };

    on(loginForm, 'submit', async (event) => {
      event.preventDefault();

      const submitBtn = qs('button[type="submit"]', loginForm);
      const emailInput = qs('#login-email', loginForm);
      const passwordInput = qs('#login-password', loginForm);

      if (!submitBtn || !emailInput || !passwordInput) return;

      const values = {
        email: emailInput.value,
        password: passwordInput.value,
      };

      const otpValue = otpInput ? otpInput.value.trim() : '';
      const otpActive = otpRequired || (otpField instanceof HTMLElement && !otpField.hidden);
      if (otpActive || otpValue) {
        values.otp = otpValue;
      } else {
        delete values.otp;
      }

      const schema = {
        email: authValidators.email,
        password: authValidators.loginPassword,
      };

      if (otpActive) {
        schema.otp = authValidators.otp;
      } else {
        hideFieldError(loginErrors.otp);
      }

      const errors = validate(schema, /** @type {Record<string, string>} */ (values));

      const invalid = renderErrors(errors, loginErrors);
      if (invalid) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Entrando...';

      try {
        const res = await safeFetch(
          '/api/login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
          }
        );

        const data = await res.json();
        if (res.ok) {
          toast.success(data.message || '¡Bienvenido de nuevo!');
          setSessionToken();
          eventStream.ensure();
          setAuthUI(true);
          await refreshCurrentUser();
          window.dispatchEvent(new CustomEvent('ecuplot:login'));
          loginForm.reset();
          if (loginPasswordMeter) {
            loginPasswordMeter.update('');
          }
          setOtpVisible(false);
          if (window.location.pathname === '/login') {
            setTimeout(() => {
              window.location.href = '/account';
            }, 500);
          }
        } else {
          if (res.status === 401 && data?.requires_2fa) {
            const message = data.error || 'Ingresa el código de tu app de autenticación para continuar.';
            setOtpVisible(true, message);
            const shouldInfo = !otpValue || /requiere/i.test(message);
            if (shouldInfo) {
              toast.info(message);
            } else {
              toast.error(message);
            }
          } else {
            toast.error(data.error || `Error (${res.status}): Credenciales inválidas.`);
          }
        }
      } catch (error) {
        console.error('Login request failed', error);
        toast.error('Error de red.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar';
      }
    });
  }
}

// Verificación de correo
function checkEmailVerification() {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return;

  let shouldReplace = false;
  const redirectToLogin = () => {
    if (window.location.pathname !== '/login') {
      setTimeout(() => {
        window.location.href = '/login';
      }, 400);
    }
  };

  if (params.get('verified') === 'true') {
    toast.success('¡Correo verificado! Ya puedes iniciar sesión.', 8000);
    redirectToLogin();
    params.delete('verified');
    shouldReplace = true;
  }

  const error = params.get('error');
  if (error) {
    let message = 'Ocurrió un error de verificación.';
    if (error === 'invalid_token') message = 'El enlace de verificación no es válido.';
    if (error === 'token_used') message = 'El enlace de verificación ya fue utilizado.';
    if (error === 'token_expired') message = 'El enlace de verificación ha expirado.';
    toast.error(message, 8000);
    params.delete('error');
    shouldReplace = true;
  }

  const unlock = params.get('unlock');
  if (unlock) {
    let message = '';
    switch (unlock) {
      case 'success':
        message = 'Tu cuenta fue desbloqueada. Inicia sesión nuevamente.';
        toast.success(message, 8000);
        redirectToLogin();
        break;
      case 'used':
        message = 'Este enlace de desbloqueo ya fue utilizado.';
        break;
      case 'expired':
        message = 'El enlace de desbloqueo ha expirado. Solicita uno nuevo desde el inicio de sesión.';
        break;
      case 'error':
        message = 'No pudimos desbloquear la cuenta. Intenta nuevamente.';
        break;
      default:
        message = 'El enlace de desbloqueo no es válido.';
        break;
    }
    if (unlock !== 'success') toast.error(message, 8000);
    params.delete('unlock');
    shouldReplace = true;
  }

  const reset = params.get('reset');
  if (reset) {
    if (reset === 'success') {
      toast.success('Tu contraseña fue actualizada. Inicia sesión con tus nuevas credenciales.', 8000);
      redirectToLogin();
    } else if (reset === 'invalid') {
      toast.error('El enlace de restablecimiento no es válido.', 8000);
    }
    params.delete('reset');
    shouldReplace = true;
  }

  if (shouldReplace) {
    const search = params.toString();
    const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname;
    history.replaceState(null, '', newUrl);
  }
}

// Proteccion de historial de graficas
/**
 * Persist a plot entry for the authenticated user.
 * @param {string} expression
 * @param {any} [plot_parameters]
 * @param {any} [plot_metadata]
 * @returns {Promise<any>}
 */
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
    clearSessionToken();
    eventStream.disconnect();
    try {
      sessionStorage.removeItem(TWOFA_REMINDER_KEY);
    } catch (error) {}
    setCurrentUser(null);
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
  bindThemeSelector();
  DrawerController.bind();
  LoginModal.bind?.();
  SignupModal.bind?.();
  ForgotModal.bind?.();

  initPasswordToggles();

  bindDrawerLinkClosing();
  initScrollSpy();
  initLearnAnchors();
  initLearnCarousel();
  initContactForm();
  setCurrentYear();
  bindGlobalTriggers();

  restoreSessionAuth();
  initAuthForms();
  initForgotPassword();
  initResetPasswordPage();
  bindLogout();
  checkEmailVerification();
  loadAppEnvironment().then(() => {
    if (demoModeEnabled) enableDemoMode();
  });
}

init();

export { authFetch, savePlot, logout, toast, getCurrentUser, refreshCurrentUser, eventStream };
