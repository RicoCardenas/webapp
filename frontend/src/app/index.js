import { initGlobalErrorHandlers } from './core/errors.js';
import { initLayout } from './ui/layout.js';
import { restoreSessionAuth, getCurrentUser } from './core/user-state.js';
import { authFetch } from './core/http.js';
import { toast } from './core/toast.js';
import { eventStream } from './core/stream.js';

function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

ready(async () => {
  initGlobalErrorHandlers();
  initLayout();
  restoreSessionAuth();

  // Backend status (landing)
  if (document.querySelector('[data-status]')) {
    const { initBackendStatus } = await import('./ui/backend-status.js');
    initBackendStatus();
  }

  // Learn carousel (landing)
  if (document.querySelector('.learn__carousel')) {
    const { initLearnCarousel } = await import('./ui/learn.js');
    initLearnCarousel();
  }

  // Bind logout in header if present
  bindLogout();
  // Initial sync for header auth links with current user (if any)
  syncHeaderAuthLinks(getCurrentUser());
  // Sync header auth links on user change
  window.addEventListener('ecuplot:user', syncHeaderAuthLinks);

  // Cargas diferidas por presencia en el DOM
  if (document.querySelector('#contact-form')) {
    const { initContactForm } = await import('./contact.js');
    initContactForm();
  }
  if (document.querySelector('#forgot-form')) {
    const { initForgotPassword } = await import('./auth/forgot.js');
    initForgotPassword();
  }
  if (document.querySelector('#reset-password-form')) {
    const { initResetPasswordPage } = await import('./auth/reset.js');
    initResetPasswordPage();
  }
  if (document.querySelector('#signup-form') || document.querySelector('#login-form')) {
    const { initAuthForms } = await import('./auth/forms.js');
    initAuthForms();
  }
});

function bindLogout() {
  const btn = document.getElementById('btn-logout');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await authFetch('/api/logout', { method: 'POST' });
    } catch {}
    try { sessionStorage.removeItem('ecuplot.2fa-reminder'); } catch {}
    eventStream.disconnect?.();
    window.dispatchEvent(new CustomEvent('ecuplot:logout'));
    toast.success('Sesión cerrada.');
    // Opcional: refrescar UI actual
    syncHeaderAuthLinks(null);
  });
}

function syncHeaderAuthLinks(payload) {
  const user = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : payload;
  const isAuth = !!user;
  const toggleDisplay = (nodes, show) => {
    nodes.forEach((node) => {
      if (node instanceof HTMLElement) node.style.display = show ? '' : 'none';
    });
  };

  toggleDisplay(Array.from(document.querySelectorAll('[data-auth-link="login"]')), !isAuth);
  toggleDisplay(Array.from(document.querySelectorAll('[data-auth-link="signup"]')), !isAuth);
  toggleDisplay(Array.from(document.querySelectorAll('[data-auth-link="account"]')), isAuth);

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn instanceof HTMLElement) logoutBtn.style.display = isAuth ? '' : 'none';
}
