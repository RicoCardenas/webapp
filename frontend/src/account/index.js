import { toast, getCurrentUser, refreshCurrentUser } from '/static/app.js';
import { hasSessionToken } from '../lib/session.js';
import { createDashboardManager } from './dashboard.js';
import { getNormalizedRoles } from './sections/roles.js';
import { ui } from './ui.js';
import { accountState } from './state.js';
import { initialsFrom } from './utils.js';
import { setUnauthorizedHandler } from './api-client.js';

let unauthorizedHandled = false;

// Dashboard se carga siempre porque está visible por defecto
const dashboard = createDashboardManager();

// Caché de módulos cargados: cada sección se importa dinámicamente solo cuando se necesita
const moduleCache = {
  history: null,
  learning: null,
  notifications: null,
  tickets: null,
  security: null,
  twofa: null,
  roles: null,
};

// Rastrear qué módulos ya fueron inicializados (init() solo debe llamarse una vez)
const initializedModules = new Set();

/**
 * Carga bajo demanda una sección específica.
 * Si ya fue cargada antes, devuelve la instancia del caché.
 * 
 * @param {'history'|'learning'|'notifications'|'tickets'|'security'|'twofa'|'roles'} sectionName
 * @returns {Promise<any>} La instancia de la sección
 */
async function loadSection(sectionName) {
  if (moduleCache[sectionName]) {
    return moduleCache[sectionName];
  }

  let module;
  switch (sectionName) {
    case 'history':
      module = await import('./sections/history.js');
      moduleCache.history = module.createHistorySection();
      break;
    case 'learning':
      module = await import('./sections/learning.js');
      moduleCache.learning = module.createLearningSection();
      break;
    case 'notifications':
      module = await import('./sections/notifications.js');
      moduleCache.notifications = module.createNotificationsSection();
      break;
    case 'tickets':
      module = await import('./sections/tickets.js');
      moduleCache.tickets = module.createTicketsSection();
      break;
    case 'security':
      module = await import('./sections/security.js');
      moduleCache.security = module.createSecuritySection();
      break;
    case 'twofa':
      module = await import('./sections/twofa.js');
      moduleCache.twofa = module.createTwoFactorSection();
      break;
    case 'roles':
      module = await import('./sections/roles.js');
      moduleCache.roles = module.createRolesSection({ dashboard });
      break;
  }

  return moduleCache[sectionName];
}

/**
 * Verifica si una sección ya ha sido cargada.
 */
function isSectionLoaded(sectionName) {
  return moduleCache[sectionName] !== null;
}

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
  
  // Reset solo las secciones que ya fueron cargadas
  if (moduleCache.history) {
    moduleCache.history.reset();
    moduleCache.history.toggle(false);
  }
  if (moduleCache.learning) moduleCache.learning.reset();
  if (moduleCache.notifications) moduleCache.notifications.reset();
  if (moduleCache.tickets) moduleCache.tickets.reset();
  if (moduleCache.security) moduleCache.security.reset();
  if (moduleCache.twofa) moduleCache.twofa.reset();
  if (moduleCache.roles) moduleCache.roles.reset();
  
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

  // Solo actualizar roles si ya fue cargado
  if (moduleCache.roles) {
    moduleCache.roles.renderPanels(user, roles);
    moduleCache.roles.renderAdminRequestSection(user, roles);
  }
  
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

/**
 * Ya no se cargan automáticamente todas las secciones al inicio.
 * Cada una se inicializa bajo demanda al interactuar con su panel.
 * Esta función queda vacía pero se mantiene por compatibilidad.
 */
async function loadAllSections(options = {}) {
  // Las secciones ahora se cargan de forma diferida (lazy loading)
  // al hacer clic en sus respectivos controles o al abrir sus paneles.
  // Se conserva esta función por si en el futuro se requiere pre-cargar algo.
}

function handleUnauthorized(showToast = true) {
  resetAccountUI();
  
  // Teardown solo en módulos que están cargados
  if (moduleCache.roles) moduleCache.roles.teardown();
  if (moduleCache.learning && moduleCache.learning.teardown) {
    moduleCache.learning.teardown();
  }
  
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

/**
 * Carga e inicializa una sección bajo demanda.
 * Se asegura de que el módulo esté cargado, lo inicializa si es su primera vez,
 * y opcionalmente dispara la carga de datos.
 */
async function ensureSectionReady(sectionName, loadData = true) {
  const section = await loadSection(sectionName);
  if (!section) return null;

  // Inicializar la sección SOLO la primera vez (bind de eventos, setup de UI)
  if (!initializedModules.has(sectionName)) {
    if (section.init && typeof section.init === 'function') {
      section.init();
      initializedModules.add(sectionName);
    }
  }

  // Cargar datos si es necesario (esto puede llamarse múltiples veces)
  if (loadData && section.load && typeof section.load === 'function') {
    await section.load();
  }

  return section;
}

/**
 * Configura listeners para carga bajo demanda usando Intersection Observer.
 * Cada sección se carga cuando entra al viewport por primera vez.
 */
function setupLazyLoadingSections() {
  const sectionMap = {
    'account-history-box': 'history',
    'account-notifications-box': 'notifications',
    'account-learning-box': 'learning',
    'account-tickets-box': 'tickets',
    'account-2fa-box': 'security',
  };

  // Map para rastrear qué ya se observó
  const observed = new Set();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      const sectionId = entry.target.id;
      const sectionName = sectionMap[sectionId];

      // Si la sección es visible y aún no se cargó
      if (entry.isIntersecting && sectionName && !observed.has(sectionName)) {
        observed.add(sectionName);
        await ensureSectionReady(sectionName, true);
      }
    });
  }, {
    root: null,
    rootMargin: '50px', // Pre-cargar cuando esté cerca del viewport
    threshold: 0.1,
  });

  // Observar cada tarjeta de sección
  Object.keys(sectionMap).forEach((sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      observer.observe(element);
    }
  });

  // Listener especial para el botón de historial (toggle)
  if (ui.historyToggle) {
    ui.historyToggle.addEventListener('click', async () => {
      if (!isSectionLoaded('history')) {
        await ensureSectionReady('history', true);
      }
    }, { once: true });
  }

  // Listener para 2FA (también tiene un toggle)
  const twofaCard = document.getElementById('account-2fa-box');
  if (twofaCard) {
    const twofaToggle = twofaCard.querySelector('[data-twofa-toggle]');
    if (twofaToggle) {
      twofaToggle.addEventListener('click', async () => {
        if (!isSectionLoaded('twofa')) {
          await ensureSectionReady('twofa', true);
        }
      }, { once: true });
    }
  }
}

async function initAccountPage() {
  bindGuestOverlay();
  dashboard.init();

  const hasToken = hasSessionToken();
  if (!hasToken) {
    handleUnauthorized(false);
    return;
  }

  await loadAccountDetails();
  
  // En lugar de cargar todas las secciones al inicio,
  // configurar carga bajo demanda
  setupLazyLoadingSections();
  
  // Roles se carga inmediatamente porque puede afectar la UI principal
  await ensureSectionReady('roles', false);
  
  // Después de cargar roles, renderizar los paneles con el usuario actual
  if (moduleCache.roles && accountState.user) {
    moduleCache.roles.renderPanels(accountState.user, accountState.roles);
    moduleCache.roles.renderAdminRequestSection(accountState.user, accountState.roles);
  }
  
  // 2FA también se carga inmediatamente para mostrar el estado correcto
  await ensureSectionReady('twofa', true);
  if (moduleCache.twofa) {
    await moduleCache.twofa.load();
  }
}

document.addEventListener('DOMContentLoaded', initAccountPage);

/**
 * Evento global cuando cambia el usuario.
 * Solo reenvía el evento a módulos que ya están cargados.
 */
window.addEventListener('ecuplot:user', async (event) => {
  const user = event.detail;
  if (user) {
    renderAccountDetails(user);
    
    // Si security ya está cargado, refrescar sus datos
    if (moduleCache.security) {
      await moduleCache.security.load({ force: true });
    }
  } else {
    handleUnauthorized(false);
  }
});

/**
 * Evento global de logout.
 * Las secciones que ya están en caché se resetean en handleUnauthorized.
 */
window.addEventListener('ecuplot:logout', () => {
  handleUnauthorized(false);
});

/**
 * Evento global de login.
 * Recarga detalles de cuenta y refresca solo las secciones que ya están cargadas.
 */
window.addEventListener('ecuplot:login', async () => {
  unauthorizedHandled = false;
  await loadAccountDetails();
  
  // Recargar solo las secciones que el usuario ya había abierto
  const loadPromises = [];
  
  if (moduleCache.learning) {
    loadPromises.push(moduleCache.learning.load({ silent: true }));
  }
  if (moduleCache.history) {
    loadPromises.push(moduleCache.history.load());
  }
  if (moduleCache.tickets) {
    loadPromises.push(moduleCache.tickets.load());
  }
  if (moduleCache.security) {
    loadPromises.push(moduleCache.security.load({ force: true }));
  }
  
  // Asegurar que el módulo 2FA se carga automáticamente
  if (!moduleCache.twofa) {
    await ensureSectionReady('twofa', true);
  }
  if (moduleCache.twofa) {
    loadPromises.push(moduleCache.twofa.load());
  }
  
  if (moduleCache.notifications) {
    loadPromises.push(moduleCache.notifications.load({ fetch: true, resetPage: true }));
  }
  
  await Promise.allSettled(loadPromises);
});
