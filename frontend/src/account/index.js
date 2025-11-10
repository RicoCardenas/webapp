import { toast, getCurrentUser, refreshCurrentUser } from '/static/app.js';
import { hasSessionToken } from '../lib/session.js';
import { createDashboardManager } from './dashboard.js';
import { createHistorySection } from './sections/history.js';
import { createLearningSection } from './sections/learning.js';
import { createNotificationsSection } from './sections/notifications.js';
import { createSecuritySection } from './sections/security.js';
import { createTicketsSection } from './sections/tickets.js';
import { createTwoFactorSection } from './sections/twofa.js';
import { createRolesSection, getNormalizedRoles } from './sections/roles.js';
import { ui } from './ui.js';
import { accountState } from './state.js';
import { initialsFrom } from './utils.js';
import { setUnauthorizedHandler } from './api-client.js';

let unauthorizedHandled = false;

const dashboard = createDashboardManager();
const historySection = createHistorySection();
const learningSection = createLearningSection();
const notificationsSection = createNotificationsSection();
const ticketsSection = createTicketsSection();
const securitySection = createSecuritySection();
const twofaSection = createTwoFactorSection();
const rolesSection = createRolesSection({ dashboard });

setUnauthorizedHandler(handleUnauthorized);

const ROLE_LABELS = {
  admin: 'Admin',
  teacher: 'Docente',
  student: 'Estudiante',
  development: 'Development',
  invitado: 'Invitado',
};

function setAuthVisibility(isAuthenticated) {
  if (ui.authShell) ui.authShell.hidden = !isAuthenticated;
  if (ui.guestShell) ui.guestShell.hidden = isAuthenticated;
  document.body.classList.toggle('account--guest', !isAuthenticated);
}

function resetAccountUI() {
  const placeholders = {
    '#user-name': '—',
    '#user-email': '—',
    '#user-created-at': '—',
    '#user-status': '—',
    '#user-visible-id': '—',
    '#user-internal-id': '—',
  };
  Object.entries(placeholders).forEach(([selector, value]) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  });
  const avatar = document.querySelector('#user-avatar');
  if (avatar) avatar.textContent = 'EC';
  const roleList = ui.userRoleList || document.querySelector('#user-role-list');
  if (roleList) {
    roleList.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'account-role-chip account-role-chip--muted';
    item.textContent = 'Sin rol asignado';
    roleList.appendChild(item);
  }
  if (ui.userInternalIdRow) ui.userInternalIdRow.hidden = true;
  historySection.reset();
  historySection.toggle(false);
  learningSection.reset();
  notificationsSection.reset();
  ticketsSection.reset();
  securitySection.reset();
  twofaSection.reset();
  rolesSection.reset();
  dashboard.reset();
}

function formatRoleLabel(role) {
  const key = String(role || '').toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  if (!key) return 'Sin rol';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function renderAccountDetails(user) {
  if (!user) return;
  unauthorizedHandled = false;
  setAuthVisibility(true);
  const roles = getNormalizedRoles(user);
  accountState.user = user;
  accountState.roles = roles;

  const nameEl = document.querySelector('#user-name');
  if (nameEl) nameEl.textContent = user.name ?? '—';

  const emailEl = document.querySelector('#user-email');
  if (emailEl) emailEl.textContent = user.email ?? '—';

  const roleList = ui.userRoleList || document.querySelector('#user-role-list');
  if (roleList) {
    roleList.innerHTML = '';
    if (!roles.size) {
      const item = document.createElement('li');
      item.className = 'account-role-chip account-role-chip--muted';
      item.textContent = 'Sin rol asignado';
      roleList.appendChild(item);
    } else {
      roles.forEach((role) => {
        const item = document.createElement('li');
        item.className = `account-role-chip account-role-chip--${role}`;
        item.dataset.role = role;
        const label = formatRoleLabel(role);
        item.textContent = label;
        item.setAttribute('aria-label', `Rol ${label}`);
        roleList.appendChild(item);
      });
    }
  }

  const createdAt = user.created_at ? new Date(user.created_at) : null;
  const createdLabel = createdAt
    ? createdAt.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  const createdEl = document.querySelector('#user-created-at');
  if (createdEl) createdEl.textContent = createdLabel;

  const statusEl = document.querySelector('#user-status');
  if (statusEl) statusEl.textContent = user.is_verified ? 'Verificado' : 'Pendiente de verificación';

  const labelEl = document.querySelector('.account-user__label');
  if (labelEl) labelEl.textContent = user.is_verified ? 'Cuenta verificada' : 'Cuenta pendiente';

  if (ui.userVisibleId) ui.userVisibleId.textContent = user.public_id || '—';
  if (ui.userInternalId) ui.userInternalId.textContent = user.id || '—';
  if (ui.userInternalIdRow) ui.userInternalIdRow.hidden = !user.id;

  const avatar = document.querySelector('#user-avatar');
  if (avatar) avatar.textContent = initialsFrom(user.name, user.email);

  rolesSection.renderPanels(user, roles);
  rolesSection.renderAdminRequestSection(user, roles);
  dashboard.updateContext(user, roles);
}

async function loadAccountDetails() {
  const cached = getCurrentUser();
  if (cached) renderAccountDetails(cached);

  const { user, status } = await refreshCurrentUser();
  if (user) {
    renderAccountDetails(user);
    return;
  }

  if (status === 401) {
    handleUnauthorized(false);
    return;
  }

  if (status && status >= 400) {
    toast?.error?.('No se pudieron cargar los datos de tu cuenta.');
  }
}

async function loadAllSections(options = {}) {
  const { silentLearning = false, forceSecurity = false } = options;
  await Promise.allSettled([
    learningSection.load({ silent: silentLearning }),
    historySection.load(),
    ticketsSection.load(),
    securitySection.load({ force: forceSecurity }),
    twofaSection.load(),
    notificationsSection.load({ fetch: true, resetPage: true }),
  ]);
}

function handleUnauthorized(showToast = true) {
  resetAccountUI();
  rolesSection.teardown();
  if (learningSection.teardown) learningSection.teardown();
  setAuthVisibility(false);
  accountState.user = null;
  accountState.roles = new Set();
  if (!unauthorizedHandled && showToast) {
    unauthorizedHandled = true;
    toast?.error?.('Debes iniciar sesión para ver esta sección. Usa el botón o vuelve al inicio.');
  }
  return null;
}

function bindGuestOverlay() {
  if (!ui.guestShell) return;
  ui.guestShell.addEventListener('click', (event) => {
    if (event.target === ui.guestShell) {
      toast?.info?.('Inicia sesión o vuelve al inicio para salir de esta pantalla.');
    }
  });
}

function initAccountPage() {
  historySection.init();
  learningSection.init();
  notificationsSection.init();
  ticketsSection.init();
  securitySection.init();
  twofaSection.init();
  bindGuestOverlay();
  dashboard.init();

  const hasToken = hasSessionToken();
  if (!hasToken) {
    handleUnauthorized(false);
    return;
  }

  loadAccountDetails();
  loadAllSections();
}

document.addEventListener('DOMContentLoaded', initAccountPage);

window.addEventListener('ecuplot:user', (event) => {
  const user = event.detail;
  if (user) {
    renderAccountDetails(user);
    securitySection.load({ force: true });
  } else {
    handleUnauthorized(false);
  }
});

window.addEventListener('ecuplot:logout', () => {
  handleUnauthorized(false);
});

window.addEventListener('ecuplot:login', () => {
  unauthorizedHandled = false;
  loadAccountDetails();
  loadAllSections({ silentLearning: true, forceSecurity: true });
});
