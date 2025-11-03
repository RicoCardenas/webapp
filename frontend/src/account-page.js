import { authFetch, toast, getCurrentUser, refreshCurrentUser } from '/static/app.js';
import { qs, qsa } from './lib/dom.js';
import { on } from './lib/events.js';
const SESSION_KEY = 'ecuplot_session_token';

let unauthorizedHandled = false;
const teacherState = { bound: false };
const adminState = { bound: false };
const developmentState = { bound: false };
const adminRequestState = { bound: false, loading: false, status: 'none' };
const historyState = {
  bound: false,
  loading: false,
  exporting: false,
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 0,
  q: '',
  from: '',
  to: '',
  tags: [],
  order: 'desc',
};
const ticketsState = {
  bound: false,
  loading: false,
  page: 1,
  pageSize: 5,
  totalPages: 0,
};
const twoFAState = {
  bound: false,
  loading: false,
  enabled: false,
  secret: null,
  otpauthUrl: null,
  qrImage: null,
  backupCodes: [],
};

const numberFormatter = new Intl.NumberFormat('es-CO');

const ui = {
  authShell: qs('#account-authenticated'),
  guestShell: qs('#account-guest'),
  historyPanel: qs('#history-panel'),
  historyToggle: qs('#history-toggle'),
  historyCTA: qs('#account-history-cta'),
  historyCount: qs('#history-count'),
  historyEmpty: qs('#history-empty'),
  historyList: qs('#plot-history-list'),
  historyLoading: qs('#history-loading'),
  historyCard: qs('#account-history-box'),
  historyCollapsed: qs('#history-collapsed'),
  historyFiltersForm: qs('#history-filters'),
  historySearch: qs('#history-search'),
  historyFrom: qs('#history-from'),
  historyTo: qs('#history-to'),
  historyTags: qs('#history-tags'),
  historyError: qs('#history-error'),
  historyPagination: qs('#history-pagination'),
  historyPrev: qs('#history-prev'),
  historyNext: qs('#history-next'),
  historyPageInfo: qs('#history-page-info'),
  historyExportButtons: Array.from(qsa('[data-history-export]')),
  userVisibleId: qs('#user-visible-id'),
  userInternalId: qs('#user-internal-id'),
  userInternalIdRow: qs('#user-internal-id-row'),
  userRoleList: qs('#user-role-list'),
  teacherPanel: qs('#teacher-panel'),
  teacherCreateGroupBtn: qs('#teacher-create-group'),
  teacherGroupList: qs('#teacher-group-list'),
  teacherGroupsEmpty: qs('#teacher-groups-empty'),
  adminPanel: qs('#admin-panel'),
  adminUserList: qs('#admin-user-list'),
  adminGroupList: qs('#admin-group-list'),
  adminAssignForm: qs('#admin-assign-teacher-form'),
  adminAssignUserId: qs('#admin-assign-user-id'),
  adminAssignVisibleId: qs('#admin-assign-visible-id'),
  developmentPanel: qs('#development-panel'),
  developmentAssignForm: qs('#development-assign-admin-form'),
  developmentUserId: qs('#development-user-id'),
  developmentVisibleId: qs('#development-visible-id'),
  developmentRequestId: qs('#development-request-id'),
  developmentBackupBtn: qs('#development-create-backup'),
  developmentRestoreForm: qs('#development-restore-form'),
  developmentBackupName: qs('#development-backup-name'),
  developmentRequestsList: qs('#development-role-requests'),
  adminRequestBox: qs('#admin-request-box'),
  adminRequestButton: qs('#btn-request-admin'),
  adminRequestStatus: qs('#admin-request-status'),
  adminStats: qs('#admin-stats'),
  adminStatsUsersTotal: qs('#admin-stats-users-total'),
  adminStatsUsersActive: qs('#admin-stats-users-active'),
  adminStatsUsersRoles: qs('#admin-stats-users-roles'),
  adminStatsRequestsOpen: qs('#admin-stats-requests-open'),
  adminStatsRequestsPending: qs('#admin-stats-requests-pending'),
  adminStatsRequestsResolved: qs('#admin-stats-requests-resolved'),
  adminStatsPlotsTotal: qs('#admin-stats-plots-total'),
  adminStatsPlotsToday: qs('#admin-stats-plots-today'),
  adminStatsPlotsWeek: qs('#admin-stats-plots-week'),
  ticketsSection: qs('#account-tickets-box'),
  ticketsForm: qs('#ticket-form'),
  ticketsType: qs('#ticket-type'),
  ticketsTitle: qs('#ticket-title'),
  ticketsDescription: qs('#ticket-description'),
  ticketsSubmit: qs('#ticket-submit'),
  ticketsFeedback: qs('#ticket-feedback'),
  ticketsList: qs('#tickets-list'),
  ticketsEmpty: qs('#tickets-empty'),
  ticketsPagination: qs('#tickets-pagination'),
  ticketsPrev: qs('#tickets-prev'),
  ticketsNext: qs('#tickets-next'),
  ticketsPageInfo: qs('#tickets-page-info'),
  twofaSection: qs('#account-2fa-box'),
  twofaStatus: qs('#twofa-status'),
  twofaSetupButton: qs('#twofa-setup'),
  twofaSetupPanel: qs('#twofa-setup-panel'),
  twofaQr: qs('#twofa-qr'),
  twofaSecret: qs('#twofa-secret'),
  twofaVerifyForm: qs('#twofa-verify-form'),
  twofaVerifyInput: qs('#twofa-verify-code'),
  twofaVerifySubmit: qs('#twofa-verify-submit'),
  twofaEnabledActions: qs('#twofa-enabled-actions'),
  twofaShowDisable: qs('#twofa-show-disable'),
  twofaShowRegenerate: qs('#twofa-show-regenerate'),
  twofaDisableForm: qs('#twofa-disable-form'),
  twofaDisableInput: qs('#twofa-disable-code'),
  twofaDisableSubmit: qs('#twofa-disable-submit'),
  twofaRegenerateForm: qs('#twofa-regenerate-form'),
  twofaRegenerateInput: qs('#twofa-regenerate-code'),
  twofaRegenerateSubmit: qs('#twofa-regenerate-submit'),
  twofaBackupCodes: qs('#twofa-backup-codes'),
  twofaCodesList: qs('#twofa-codes-list'),
  twofaFeedback: qs('#twofa-feedback'),
};

function initialsFrom(name = '', email = '') {
  const source = name || email;
  if (!source) return 'EC';
  const chunks = source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return chunks.join('') || source.charAt(0).toUpperCase() || 'EC';
}

function setAuthVisibility(isAuthenticated) {
  if (ui.authShell) ui.authShell.hidden = !isAuthenticated;
  if (ui.guestShell) ui.guestShell.hidden = isAuthenticated;
  document.body.classList.toggle('account--guest', !isAuthenticated);
}

function resetAccountUI() {
  hideRolePanels();
  const placeholders = {
    '#user-name': '—',
    '#user-email': '—',
    '#user-created-at': '—',
    '#user-status': '—',
    '#user-visible-id': '—',
    '#user-internal-id': '—',
  };
  Object.entries(placeholders).forEach(([sel, value]) => {
    const el = qs(sel);
    if (el) el.textContent = value;
  });
  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = 'EC';
  const roleList = ui.userRoleList || qs('#user-role-list');
  if (roleList) {
    roleList.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'account-role-chip account-role-chip--muted';
    item.textContent = 'Sin rol asignado';
    roleList.appendChild(item);
  }
  if (ui.userInternalIdRow) ui.userInternalIdRow.hidden = true;
  if (ui.historyCount) ui.historyCount.textContent = '—';
  if (ui.historyList) ui.historyList.replaceChildren();
  if (ui.historyEmpty) {
    ui.historyEmpty.hidden = false;
    const message = qs('p', ui.historyEmpty);
    if (message) message.textContent = 'Inicia sesión para ver tu historial.';
  }
  if (ui.historyFiltersForm) ui.historyFiltersForm.reset();
  if (ui.historyError) {
    ui.historyError.textContent = '';
    ui.historyError.hidden = true;
  }
  if (ui.historyPagination) ui.historyPagination.hidden = true;
  if (ui.historyPrev instanceof HTMLButtonElement) ui.historyPrev.disabled = true;
  if (ui.historyNext instanceof HTMLButtonElement) ui.historyNext.disabled = true;
  if (ui.historyPageInfo) ui.historyPageInfo.textContent = 'Página 1 de 1';
  historyState.page = 1;
  historyState.total = 0;
  historyState.totalPages = 0;
  historyState.q = '';
  historyState.from = '';
  historyState.to = '';
  historyState.tags = [];
  historyState.loading = false;
  historyState.exporting = false;
  resetAdminStats();
  resetTickets();
  resetTwoFactor();
  if (ui.adminRequestBox) ui.adminRequestBox.hidden = true;
  if (ui.adminRequestStatus) {
    ui.adminRequestStatus.textContent = '';
    ui.adminRequestStatus.hidden = true;
    ui.adminRequestStatus.removeAttribute('data-state');
  }
  if (ui.adminRequestButton) {
    const defaultLabel = ui.adminRequestButton.dataset.defaultLabel || ui.adminRequestButton.textContent;
    ui.adminRequestButton.disabled = false;
    ui.adminRequestButton.textContent = defaultLabel || 'Solicitar rol de administrador';
  }
  adminRequestState.status = 'none';
  adminRequestState.loading = false;

  toggleHistoryPanel(false);
}

function resetAdminStats() {
  if (ui.adminStatsUsersTotal) ui.adminStatsUsersTotal.textContent = '—';
  if (ui.adminStatsUsersActive) ui.adminStatsUsersActive.textContent = '—';
  if (ui.adminStatsRequestsOpen) ui.adminStatsRequestsOpen.textContent = '—';
  if (ui.adminStatsRequestsPending) ui.adminStatsRequestsPending.textContent = '—';
  if (ui.adminStatsRequestsResolved) ui.adminStatsRequestsResolved.textContent = '—';
  if (ui.adminStatsPlotsTotal) ui.adminStatsPlotsTotal.textContent = '—';
  if (ui.adminStatsPlotsToday) ui.adminStatsPlotsToday.textContent = '—';
  if (ui.adminStatsPlotsWeek) ui.adminStatsPlotsWeek.textContent = '—';
  if (ui.adminStatsUsersRoles) {
    ui.adminStatsUsersRoles.replaceChildren();
    const item = document.createElement('li');
    item.textContent = 'Sin datos disponibles';
    ui.adminStatsUsersRoles.appendChild(item);
  }
  if (ui.adminStats) ui.adminStats.hidden = true;
}

function resetTickets() {
  ticketsState.page = 1;
  ticketsState.totalPages = 0;
  ticketsState.loading = false;
  if (ui.ticketsList) ui.ticketsList.replaceChildren();
  if (ui.ticketsEmpty) {
    ui.ticketsEmpty.hidden = false;
    const message = qs('p', ui.ticketsEmpty);
    if (message) message.textContent = 'Aún no has enviado solicitudes.';
  }
  if (ui.ticketsPagination) ui.ticketsPagination.hidden = true;
  if (ui.ticketsPrev instanceof HTMLButtonElement) ui.ticketsPrev.disabled = true;
  if (ui.ticketsNext instanceof HTMLButtonElement) ui.ticketsNext.disabled = true;
  if (ui.ticketsPageInfo) ui.ticketsPageInfo.textContent = 'Página 1 de 1';
  if (ui.ticketsForm) ui.ticketsForm.reset();
  if (ui.ticketsFeedback) {
    ui.ticketsFeedback.textContent = '';
    ui.ticketsFeedback.hidden = true;
    ui.ticketsFeedback.removeAttribute('data-variant');
  }
}

function resetTwoFactor() {
  twoFAState.loading = false;
  twoFAState.secret = null;
  twoFAState.otpauthUrl = null;
  twoFAState.qrImage = null;
  twoFAState.backupCodes = [];
  if (ui.twofaSetupPanel) ui.twofaSetupPanel.hidden = true;
  if (ui.twofaEnabledActions) ui.twofaEnabledActions.hidden = true;
  if (ui.twofaBackupCodes) ui.twofaBackupCodes.hidden = true;
  if (ui.twofaQr instanceof HTMLImageElement) ui.twofaQr.src = '';
  if (ui.twofaSecret) ui.twofaSecret.textContent = '';
  if (ui.twofaVerifyForm) ui.twofaVerifyForm.reset();
  if (ui.twofaDisableForm) ui.twofaDisableForm.reset();
  if (ui.twofaRegenerateForm) ui.twofaRegenerateForm.reset();
  if (ui.twofaFeedback) {
    ui.twofaFeedback.textContent = '';
    ui.twofaFeedback.hidden = true;
    ui.twofaFeedback.removeAttribute('data-variant');
  }
}

function getNormalizedRoles(user) {
  const roles = new Set();
  if (!user) return roles;
  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      if (!role) return;
      roles.add(String(role).toLowerCase());
    });
  }
  if (user.role) roles.add(String(user.role).toLowerCase());
  return roles;
}

const ROLE_LABELS = {
  admin: 'Admin',
  teacher: 'Docente',
  student: 'Estudiante',
  development: 'Development',
  invitado: 'Invitado',
};

const TICKET_TYPE_LABELS = {
  soporte: 'Soporte',
  rol: 'Rol',
  consulta: 'Consulta',
  otro: 'Otro',
};

const TICKET_STATUS_LABELS = {
  pendiente: 'Pendiente',
  atendida: 'Atendida',
  rechazada: 'Rechazada',
};

function formatRoleLabel(role) {
  const key = String(role || '').toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  if (!key) return 'Sin rol';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatTicketType(value) {
  const key = String(value || '').toLowerCase();
  if (TICKET_TYPE_LABELS[key]) return TICKET_TYPE_LABELS[key];
  if (!key) return 'General';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatTicketStatus(value) {
  const key = String(value || '').toLowerCase();
  if (TICKET_STATUS_LABELS[key]) return TICKET_STATUS_LABELS[key];
  if (!key) return 'Pendiente';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function renderAccountDetails(user) {
  if (!user) return;

  unauthorizedHandled = false;
  setAuthVisibility(true);
  const roles = getNormalizedRoles(user);

  const nameEl = qs('#user-name');
  if (nameEl) nameEl.textContent = user.name ?? '—';

  const emailEl = qs('#user-email');
  if (emailEl) emailEl.textContent = user.email ?? '—';

  const roleList = ui.userRoleList || qs('#user-role-list');
  if (roleList) {
    roleList.innerHTML = '';
    if (roles.size === 0) {
      const item = document.createElement('li');
      item.className = 'account-role-chip account-role-chip--muted';
      item.textContent = 'Sin rol asignado';
      item.setAttribute('aria-label', 'Sin rol asignado');
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
  const createdEl = qs('#user-created-at');
  if (createdEl) createdEl.textContent = createdLabel;

  const statusEl = qs('#user-status');
  if (statusEl) statusEl.textContent = user.is_verified ? 'Verificado' : 'Pendiente de verificación';

  const labelEl = qs('.account-user__label');
  if (labelEl) labelEl.textContent = user.is_verified ? 'Cuenta verificada' : 'Cuenta pendiente';

  if (ui.userVisibleId) ui.userVisibleId.textContent = user.public_id ?? '—';
  const showInternalId = roles.has('admin') || roles.has('development');
  if (ui.userInternalIdRow) ui.userInternalIdRow.hidden = !showInternalId;
  if (ui.userInternalId) ui.userInternalId.textContent = showInternalId ? user.id ?? '—' : '—';

  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = initialsFrom(user.name, user.email);

  renderRolePanels(user, roles);
  renderAdminRequestSection(user, roles);
}

function hideRolePanels() {
  if (ui.teacherPanel) {
    ui.teacherPanel.hidden = true;
    if (ui.teacherGroupList) ui.teacherGroupList.innerHTML = '';
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Aún no has creado grupos.';
      ui.teacherGroupsEmpty.hidden = true;
    }
  }
  if (ui.adminPanel) {
    ui.adminPanel.hidden = true;
    if (ui.adminUserList) ui.adminUserList.innerHTML = '';
    if (ui.adminGroupList) ui.adminGroupList.innerHTML = '';
  }
  if (ui.developmentPanel) {
    ui.developmentPanel.hidden = true;
    if (ui.developmentRequestsList) ui.developmentRequestsList.innerHTML = '';
  }
}

function renderRolePanels(user, precomputedRoles) {
  hideRolePanels();
  if (!user) return;

  const roles = precomputedRoles ?? getNormalizedRoles(user);

  if (roles.has('teacher')) renderTeacherPanel();
  if (roles.has('admin')) renderAdminPanel();
  if (roles.has('development')) renderDevelopmentPanel();
}

function renderAdminRequestSection(user, precomputedRoles) {
  if (!ui.adminRequestBox) return;
  const roles = precomputedRoles ?? getNormalizedRoles(user);
  const hasElevatedRole = roles.has('admin') || roles.has('development');
  const shouldShow = Boolean(user) && !hasElevatedRole;
  ui.adminRequestBox.hidden = !shouldShow;

  if (!shouldShow) {
    updateAdminRequestStatus('none');
    return;
  }

  if (!adminRequestState.bound) {
    bindAdminRequestSection();
    adminRequestState.bound = true;
  }

  loadAdminRequestStatus();
}

function bindAdminRequestSection() {
  const button = ui.adminRequestButton;
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || 'Solicitar rol de administrador';
  }
  on(button, 'click', handleAdminRoleRequestClick);
}

function formatRequestTimestamp(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadAdminRequestStatus() {
  if (!ui.adminRequestBox || ui.adminRequestBox.hidden) return;
  if (adminRequestState.loading) return;
  adminRequestState.loading = true;

  const res = await requestWithAuth('/api/role-requests/me');
  adminRequestState.loading = false;
  if (!res) return;

  if (!res.ok) {
    updateAdminRequestStatus('error', 'No se pudo consultar el estado de tu solicitud.');
    return;
  }

  const data = await res.json().catch(() => ({}));
  const req = data?.request;

  if (!req) {
    updateAdminRequestStatus('none');
    return;
  }

  const createdLabel = formatRequestTimestamp(req.created_at);
  let message = '';

  switch (req.status) {
    case 'pending':
      message = createdLabel
        ? `Solicitud pendiente desde ${createdLabel}. Te avisaremos por correo.`
        : 'Solicitud pendiente. Te avisaremos por correo.';
      break;
    case 'rejected': {
      const resolverInfo = req.resolver?.name ? ` Resolver: ${req.resolver.name}.` : '';
      message = `Tu última solicitud fue rechazada.${resolverInfo} Puedes intentar nuevamente cuando estés listo.`;
      break;
    }
    case 'approved':
      message = 'Tu solicitud fue aprobada. Recarga la página para ver los permisos actualizados.';
      break;
    default:
      message = `Estado de solicitud: ${req.status}.`;
      break;
  }

  updateAdminRequestStatus(req.status, message, req);
}

function updateAdminRequestStatus(status, message = '', request = null) {
  adminRequestState.status = status || 'none';

  if (ui.adminRequestStatus) {
    if (!status || status === 'none') {
      ui.adminRequestStatus.textContent = '';
      ui.adminRequestStatus.hidden = true;
      ui.adminRequestStatus.removeAttribute('data-state');
    } else {
      ui.adminRequestStatus.textContent = message || `Estado de solicitud: ${status}`;
      ui.adminRequestStatus.hidden = false;
      ui.adminRequestStatus.dataset.state = status;
    }
  }

  const button = ui.adminRequestButton;
  if (!button) return;
  const defaultLabel = button.dataset.defaultLabel || button.textContent || 'Solicitar rol de administrador';

  switch (status) {
    case 'pending':
      button.disabled = true;
      button.textContent = 'Solicitud enviada';
      break;
    case 'approved':
      button.disabled = true;
      button.textContent = 'Solicitud aprobada';
      break;
    case 'error':
      button.disabled = false;
      button.textContent = defaultLabel;
      break;
    case 'rejected':
      button.disabled = false;
      button.textContent = defaultLabel;
      break;
    case 'none':
    default:
      button.disabled = false;
      button.textContent = defaultLabel;
      break;
  }

  if (request && (request.id || request.request_id)) {
    button.dataset.requestId = String(request.id || request.request_id);
  } else if (button.dataset.requestId) {
    delete button.dataset.requestId;
  }
}

async function handleAdminRoleRequestClick(event) {
  event.preventDefault();
  const button = event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : ui.adminRequestButton;
  if (!button) return;

  const defaultLabel = button.dataset.defaultLabel || button.textContent || 'Solicitar rol de administrador';
  button.disabled = true;
  button.textContent = 'Enviando...';

  try {
    const res = await requestWithAuth('/api/role-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    if (!res) {
      button.disabled = false;
      button.textContent = defaultLabel;
      return;
    }

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const message = data?.message || 'Solicitud registrada. Te avisaremos cuando sea revisada.';
      toast?.success?.(message);
      updateAdminRequestStatus('pending', message, data);
      await loadAdminRequestStatus();
      return;
    }

    const errorMsg = data?.error || 'No se pudo registrar la solicitud.';

    if (res.status === 409) {
      toast?.info?.(errorMsg);
      updateAdminRequestStatus('pending', errorMsg);
      return;
    }

    toast?.error?.(errorMsg);
    updateAdminRequestStatus('error', errorMsg);
  } catch (err) {
    console.error('[account] Error al solicitar rol admin', err);
    toast?.error?.('No se pudo enviar tu solicitud en este momento.');
    updateAdminRequestStatus('error', 'No se pudo enviar la solicitud. Intenta de nuevo.');
  } finally {
    const currentStatus = adminRequestState.status;
    if (!button) return;
    if (currentStatus === 'pending') {
      button.disabled = true;
      button.textContent = 'Solicitud enviada';
    } else if (currentStatus === 'approved') {
      button.disabled = true;
      button.textContent = 'Solicitud aprobada';
    } else {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  }
}

function renderTeacherPanel() {
  if (!ui.teacherPanel) return;
  ui.teacherPanel.hidden = false;
  if (!teacherState.bound) {
    bindTeacherPanel();
    teacherState.bound = true;
  }
  loadTeacherGroups();
}

function bindTeacherPanel() {
  if (ui.teacherCreateGroupBtn) {
    on(ui.teacherCreateGroupBtn, 'click', () => {
      handleTeacherCreateGroup();
    });
  }
}

async function handleTeacherCreateGroup() {
  const name = prompt('Nombre del grupo:');
  const trimmedName = name?.trim();
  if (!trimmedName) return;
  const descriptionPrompt = prompt('Descripción del grupo (opcional):');
  const description = descriptionPrompt?.trim() || undefined;

  const res = await requestWithAuth('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: trimmedName, description }),
  });
  if (!res) return;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo crear el grupo.');
    return;
  }

  toast?.success?.('Grupo creado.');
  await loadTeacherGroups();
}

async function loadTeacherGroups() {
  if (!ui.teacherGroupList) return;
  ui.teacherGroupList.innerHTML = '';
  if (ui.teacherGroupsEmpty) {
    ui.teacherGroupsEmpty.textContent = 'Cargando grupos...';
    ui.teacherGroupsEmpty.hidden = false;
  }

  const res = await requestWithAuth('/api/groups');
  if (!res) {
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'No se pudieron cargar los grupos. Intenta nuevamente.';
      ui.teacherGroupsEmpty.hidden = false;
    }
    return;
  }

  if (res.status === 403) {
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Esta sección es exclusiva para cuentas con rol docente.';
      ui.teacherGroupsEmpty.hidden = false;
    }
    return;
  }

  if (res.status === 204) {
    renderTeacherGroups([]);
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar los grupos.');
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Se produjo un error al consultar los grupos.';
      ui.teacherGroupsEmpty.hidden = false;
    }
    return;
  }

  const data = await res.json().catch(() => ({}));
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  renderTeacherGroups(groups);
}

function renderTeacherGroups(groups) {
  if (!ui.teacherGroupList) return;
  ui.teacherGroupList.innerHTML = '';

  if (!groups.length) {
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Aún no has creado grupos.';
      ui.teacherGroupsEmpty.hidden = false;
    }
    return;
  }

  if (ui.teacherGroupsEmpty) ui.teacherGroupsEmpty.hidden = true;
  groups.forEach((group) => {
    ui.teacherGroupList.appendChild(createTeacherGroupCard(group));
  });
}

function createTeacherGroupCard(group) {
  const card = document.createElement('article');
  card.className = 'role-panel__card';
  card.dataset.groupId = String(group?.id ?? '');

  const header = document.createElement('header');
  header.className = 'role-panel__header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'role-panel__header-main';

  const title = document.createElement('h3');
  title.className = 'role-panel__title';
  title.textContent = group?.name || 'Grupo';

  const description = document.createElement('p');
  description.className = 'role-panel__meta';
  if (group?.description) {
    description.textContent = group.description;
  } else {
    description.textContent = 'Sin descripción';
    description.classList.add('role-panel__meta--muted');
  }

  titleWrap.appendChild(title);
  titleWrap.appendChild(description);

  const metaBar = document.createElement('div');
  metaBar.className = 'role-panel__bar';

  const teacherInfo = document.createElement('span');
  teacherInfo.className = 'role-panel__meta role-panel__meta--muted';
  const teacher = group?.teacher;
  if (teacher) {
    const email = teacher.email ? ` · ${teacher.email}` : '';
    teacherInfo.textContent = `Docente: ${teacher.name || 'N/D'}${email}`;
  } else {
    teacherInfo.textContent = 'Docente: Tú';
  }

  const members = Array.isArray(group?.members) ? group.members : [];
  const memberCount = typeof group?.member_count === 'number' ? group.member_count : members.length;

  const countPill = document.createElement('span');
  countPill.className = 'role-panel__pill';
  countPill.textContent = `${memberCount} estudiante${memberCount === 1 ? '' : 's'}`;

  metaBar.appendChild(teacherInfo);
  metaBar.appendChild(countPill);

  header.appendChild(titleWrap);
  header.appendChild(metaBar);

  const table = document.createElement('table');
  table.className = 'role-panel__table';
  table.setAttribute('aria-label', `Estudiantes del grupo ${title.textContent}`);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['#', 'Estudiante', 'ID', 'Acciones'].forEach((label) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (!members.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'role-panel__table-empty';
    cell.textContent = 'El grupo no tiene estudiantes asignados.';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    members.forEach((member, index) => {
      tbody.appendChild(createTeacherMemberRow(group.id, member, index));
    });
  }
  table.appendChild(tbody);

  const form = document.createElement('form');
  form.className = 'role-form role-form--inline role-form--compact';
  form.dataset.groupId = String(group?.id || '');
  form.noValidate = true;

  const field = document.createElement('div');
  field.className = 'form__field form__field--compact';

  const inputId = `teacher-add-${group?.id ?? ''}`;
  const label = document.createElement('label');
  label.className = 'form__label';
  label.setAttribute('for', inputId);
  label.textContent = 'Agregar estudiante (ID)';

  const input = document.createElement('input');
  input.className = 'form__input';
  input.type = 'text';
  input.id = inputId;
  input.placeholder = 'ID del estudiante';
  input.autocomplete = 'off';

  field.appendChild(label);
  field.appendChild(input);
  form.appendChild(field);

  const actions = document.createElement('div');
  actions.className = 'form__actions form__actions--compact';

  const submit = document.createElement('button');
  submit.className = 'btn btn--primary btn--sm';
  submit.type = 'submit';
  submit.textContent = 'Agregar';

  actions.appendChild(submit);
  form.appendChild(actions);

  on(form, 'submit', onTeacherAddMember);

  card.appendChild(header);
  card.appendChild(table);
  card.appendChild(form);

  return card;
}

function createTeacherMemberRow(groupId, member, index) {
  const row = document.createElement('tr');

  const indexCell = document.createElement('td');
  indexCell.textContent = String(index + 1);
  row.appendChild(indexCell);

  const nameCell = document.createElement('td');
  nameCell.textContent = member?.student_name || 'Sin nombre';
  row.appendChild(nameCell);

  const idCell = document.createElement('td');
  idCell.textContent = member?.student_visible_id || '—';
  row.appendChild(idCell);

  const actionsCell = document.createElement('td');
  actionsCell.className = 'role-panel__table-actions';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--ghost btn--sm';
  removeBtn.type = 'button';
  removeBtn.textContent = 'Eliminar';
  removeBtn.dataset.groupId = String(groupId || '');
  removeBtn.dataset.visibleId = String(member?.student_visible_id || '');
  on(removeBtn, 'click', onTeacherRemoveMember);

  actionsCell.appendChild(removeBtn);
  row.appendChild(actionsCell);

  return row;
}

function onTeacherAddMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const groupId = form.dataset.groupId;
  if (!groupId) return;
  const input = form.querySelector('input');
  const submit = form.querySelector('button[type="submit"]');
  if (!(input instanceof HTMLInputElement)) return;

  const visibleId = input.value.trim();
  if (!visibleId) {
    toast?.error?.('Ingresa un ID.');
    return;
  }

  input.disabled = true;
  if (submit instanceof HTMLButtonElement) submit.disabled = true;

  handleTeacherAddMember(groupId, visibleId).finally(() => {
    input.disabled = false;
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleTeacherAddMember(groupId, visibleId) {
  const res = await requestWithAuth(`/api/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible_id: visibleId }),
  });
  if (!res) return;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo agregar el estudiante.');
    return;
  }

  toast?.success?.('Estudiante agregado al grupo.');
  await loadTeacherGroups();
}

function onTeacherRemoveMember(event) {
  event.preventDefault();
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const { groupId, visibleId } = button.dataset;
  if (!groupId || !visibleId) return;
  button.disabled = true;
  handleTeacherRemoveMember(groupId, visibleId, button);
}

async function handleTeacherRemoveMember(groupId, visibleId, button) {
  try {
    const res = await requestWithAuth(`/api/groups/${groupId}/members/${encodeURIComponent(visibleId)}`, {
      method: 'DELETE',
    });
    if (!res) return;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast?.error?.(err?.error || 'No se pudo eliminar al estudiante.');
      return;
    }
    toast?.success?.('Estudiante eliminado del grupo.');
    await loadTeacherGroups();
  } finally {
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

function renderAdminRoleStats(stats) {
  if (!ui.adminStatsUsersRoles) return;
  ui.adminStatsUsersRoles.replaceChildren();
  const entries = Object.entries(stats || {});
  if (!entries.length) {
    const item = document.createElement('li');
    item.textContent = 'Sin datos disponibles';
    ui.adminStatsUsersRoles.appendChild(item);
    return;
  }
  entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([role, count]) => {
      const item = document.createElement('li');
      const label = formatRoleLabel(role);
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      labelSpan.className = 'admin-stat__list-label';
      const valueSpan = document.createElement('span');
      valueSpan.textContent = formatNumber(count);
      valueSpan.className = 'admin-stat__list-value';
      item.appendChild(labelSpan);
      item.appendChild(valueSpan);
      ui.adminStatsUsersRoles.appendChild(item);
    });
}

async function loadAdminStats() {
  if (!ui.adminStats) return;
  ui.adminStats.hidden = false;

  try {
    const [usersRes, requestsRes, plotsRes] = await Promise.all([
      requestWithAuth('/api/admin/stats/users'),
      requestWithAuth('/api/admin/stats/requests'),
      requestWithAuth('/api/admin/stats/plots'),
    ]);

    if (usersRes?.ok) {
      const data = await usersRes.json().catch(() => ({}));
      if (ui.adminStatsUsersTotal) ui.adminStatsUsersTotal.textContent = formatNumber(data?.total ?? 0);
      if (ui.adminStatsUsersActive) ui.adminStatsUsersActive.textContent = formatNumber(data?.activos_7d ?? 0);
      renderAdminRoleStats(data?.por_rol || {});
    } else if (usersRes) {
      toast?.error?.('No se pudieron cargar las estadísticas de usuarios.');
    }

    if (requestsRes?.ok) {
      const data = await requestsRes.json().catch(() => ({}));
      if (ui.adminStatsRequestsOpen) ui.adminStatsRequestsOpen.textContent = formatNumber(data?.abiertas ?? 0);
      if (ui.adminStatsRequestsPending) ui.adminStatsRequestsPending.textContent = formatNumber(data?.pendientes ?? 0);
      if (ui.adminStatsRequestsResolved) ui.adminStatsRequestsResolved.textContent = formatNumber(data?.atendidas ?? 0);
    } else if (requestsRes) {
      toast?.error?.('No se pudieron cargar las estadísticas de solicitudes.');
    }

    if (plotsRes?.ok) {
      const data = await plotsRes.json().catch(() => ({}));
      if (ui.adminStatsPlotsTotal) ui.adminStatsPlotsTotal.textContent = formatNumber(data?.total ?? 0);
      if (ui.adminStatsPlotsToday) ui.adminStatsPlotsToday.textContent = formatNumber(data?.hoy ?? 0);
      if (ui.adminStatsPlotsWeek) ui.adminStatsPlotsWeek.textContent = formatNumber(data?.ultimos_7d ?? 0);
    } else if (plotsRes) {
      toast?.error?.('No se pudieron cargar las métricas de gráficas.');
    }
  } catch (error) {
    console.error('[account] Error al cargar métricas admin', error);
    toast?.error?.('No se pudieron cargar las métricas administrativas.');
  }
}

function bindTicketsSection() {
  if (ticketsState.bound) return;
  ticketsState.bound = true;

  if (ui.ticketsForm) {
    on(ui.ticketsForm, 'submit', handleTicketSubmit);
  }
  if (ui.ticketsPrev) {
    on(ui.ticketsPrev, 'click', handleTicketsPrev);
  }
  if (ui.ticketsNext) {
    on(ui.ticketsNext, 'click', handleTicketsNext);
  }
}

function setTicketsLoading(isLoading) {
  ticketsState.loading = Boolean(isLoading);
  if (ui.ticketsType instanceof HTMLSelectElement) ui.ticketsType.disabled = ticketsState.loading;
  if (ui.ticketsTitle instanceof HTMLInputElement) ui.ticketsTitle.disabled = ticketsState.loading;
  if (ui.ticketsDescription instanceof HTMLTextAreaElement) ui.ticketsDescription.disabled = ticketsState.loading;
  if (ui.ticketsSubmit instanceof HTMLButtonElement) ui.ticketsSubmit.disabled = ticketsState.loading;
  if (ui.ticketsPrev instanceof HTMLButtonElement) ui.ticketsPrev.disabled = ticketsState.loading || ticketsState.page <= 1;
  if (ui.ticketsNext instanceof HTMLButtonElement) ui.ticketsNext.disabled = ticketsState.loading || (ticketsState.totalPages > 0 && ticketsState.page >= ticketsState.totalPages);
}

function clearTicketFeedback() {
  if (!ui.ticketsFeedback) return;
  ui.ticketsFeedback.textContent = '';
  ui.ticketsFeedback.hidden = true;
  ui.ticketsFeedback.removeAttribute('data-variant');
}

function showTicketFeedback(message, variant = 'info') {
  if (!ui.ticketsFeedback) return;
  ui.ticketsFeedback.textContent = message;
  ui.ticketsFeedback.dataset.variant = variant;
  ui.ticketsFeedback.hidden = false;
}

function updateTicketsPagination(meta) {
  ticketsState.totalPages = Number(meta?.total_pages ?? ticketsState.totalPages ?? 0);
  const pageFromMeta = Number(meta?.page);
  if (!Number.isNaN(pageFromMeta) && pageFromMeta > 0) {
    ticketsState.page = pageFromMeta;
  }
  const sizeFromMeta = Number(meta?.page_size);
  if (!Number.isNaN(sizeFromMeta) && sizeFromMeta > 0) {
    ticketsState.pageSize = sizeFromMeta;
  }

  if (ui.ticketsPagination) {
    const hidden = ticketsState.totalPages <= 1 && ticketsState.page <= 1;
    ui.ticketsPagination.hidden = hidden;
  }
  if (ui.ticketsPageInfo) {
    const totalPages = ticketsState.totalPages || 1;
    const current = ticketsState.page || 1;
    ui.ticketsPageInfo.textContent = `Página ${current} de ${totalPages}`;
  }
  if (ui.ticketsPrev instanceof HTMLButtonElement) {
    ui.ticketsPrev.disabled = ticketsState.loading || ticketsState.page <= 1;
  }
  if (ui.ticketsNext instanceof HTMLButtonElement) {
    const atEnd = ticketsState.totalPages === 0 || ticketsState.page >= ticketsState.totalPages;
    ui.ticketsNext.disabled = ticketsState.loading || atEnd;
  }
}

function renderTickets(items) {
  if (!ui.ticketsList) return;
  ui.ticketsList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    if (ui.ticketsEmpty) {
      ui.ticketsEmpty.hidden = false;
      const message = qs('p', ui.ticketsEmpty);
      if (message) message.textContent = 'Aún no has enviado solicitudes.';
    }
    return;
  }

  if (ui.ticketsEmpty) ui.ticketsEmpty.hidden = true;

  items.forEach((ticket) => {
    const li = document.createElement('li');
    li.className = 'ticket-item';

    const header = document.createElement('div');
    header.className = 'ticket-item__header';

    const title = document.createElement('h4');
    title.className = 'ticket-item__title';
    title.textContent = ticket?.title || 'Solicitud';
    header.appendChild(title);

    const statusBadge = document.createElement('span');
    statusBadge.className = `ticket-status ticket-status--${ticket?.status || 'pendiente'}`;
    statusBadge.textContent = formatTicketStatus(ticket?.status);
    header.appendChild(statusBadge);

    li.appendChild(header);

    const typeLabel = document.createElement('p');
    typeLabel.className = 'ticket-item__type';
    typeLabel.textContent = `Tipo: ${formatTicketType(ticket?.type)}`;
    li.appendChild(typeLabel);

    if (ticket?.description) {
      const description = document.createElement('p');
      description.className = 'ticket-item__description';
      description.textContent = ticket.description;
      li.appendChild(description);
    }

    const meta = document.createElement('p');
    meta.className = 'ticket-item__meta';
    const createdLabel = formatHistoryDate(ticket?.created_at);
    meta.textContent = createdLabel ? `Creado: ${createdLabel}` : 'Creado recientemente';
    li.appendChild(meta);

    ui.ticketsList.appendChild(li);
  });
}

async function handleTicketSubmit(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (!(ui.ticketsType instanceof HTMLSelectElement)) return;
  if (!(ui.ticketsTitle instanceof HTMLInputElement)) return;
  if (!(ui.ticketsDescription instanceof HTMLTextAreaElement)) return;

  const payload = {
    type: ui.ticketsType.value.trim().toLowerCase(),
    title: ui.ticketsTitle.value.trim(),
    description: ui.ticketsDescription.value.trim(),
  };

  if (!payload.type || !payload.title || payload.description.length < 10) {
    showTicketFeedback('Revisa el tipo, título y describe tu solicitud con más detalle.', 'error');
    return;
  }

  setTicketsLoading(true);
  clearTicketFeedback();

  try {
    const res = await requestWithAuth('/api/account/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res) return;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMsg = data?.error || 'No se pudo registrar tu solicitud.';
      showTicketFeedback(errorMsg, 'error');
      return;
    }

    showTicketFeedback(data?.message || 'Solicitud enviada correctamente.', 'success');
    if (ui.ticketsForm) ui.ticketsForm.reset();
    ticketsState.page = 1;
    await loadTickets();
  } catch (err) {
    console.error('[account] Error al crear solicitud', err);
    showTicketFeedback('No se pudo registrar tu solicitud. Intenta de nuevo más tarde.', 'error');
  } finally {
    setTicketsLoading(false);
  }
}

function handleTicketsPrev(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (ticketsState.page <= 1) return;
  ticketsState.page -= 1;
  loadTickets();
}

function handleTicketsNext(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (ticketsState.totalPages && ticketsState.page >= ticketsState.totalPages) return;
  ticketsState.page += 1;
  loadTickets();
}

function bindTwoFactorSection() {
  if (twoFAState.bound) return;
  twoFAState.bound = true;

  if (ui.twofaSetupButton) {
    on(ui.twofaSetupButton, 'click', async (event) => {
      event.preventDefault();
      await startTwoFactorSetup();
    });
  }
  if (ui.twofaVerifyForm) {
    on(ui.twofaVerifyForm, 'submit', handleTwoFactorVerify);
  }
  if (ui.twofaShowDisable) {
    on(ui.twofaShowDisable, 'click', (event) => {
      event.preventDefault();
      if (ui.twofaDisableForm) {
        ui.twofaDisableForm.hidden = !ui.twofaDisableForm.hidden;
        if (!ui.twofaDisableForm.hidden) ui.twofaRegenerateForm && (ui.twofaRegenerateForm.hidden = true);
        const input = ui.twofaDisableForm.querySelector('input');
        if (input instanceof HTMLInputElement) input.focus();
      }
    });
  }
  if (ui.twofaShowRegenerate) {
    on(ui.twofaShowRegenerate, 'click', (event) => {
      event.preventDefault();
      if (ui.twofaRegenerateForm) {
        ui.twofaRegenerateForm.hidden = !ui.twofaRegenerateForm.hidden;
        if (!ui.twofaRegenerateForm.hidden) ui.twofaDisableForm && (ui.twofaDisableForm.hidden = true);
        const input = ui.twofaRegenerateForm.querySelector('input');
        if (input instanceof HTMLInputElement) input.focus();
      }
    });
  }
  if (ui.twofaDisableForm) {
    on(ui.twofaDisableForm, 'submit', handleTwoFactorDisable);
    const cancel = ui.twofaDisableForm.querySelector('[data-twofa-cancel]');
    if (cancel instanceof HTMLButtonElement) {
      on(cancel, 'click', (event) => {
        event.preventDefault();
        ui.twofaDisableForm.hidden = true;
        ui.twofaDisableForm.reset();
      });
    }
  }
  if (ui.twofaRegenerateForm) {
    on(ui.twofaRegenerateForm, 'submit', handleTwoFactorRegenerate);
    const cancel = ui.twofaRegenerateForm.querySelector('[data-twofa-cancel]');
    if (cancel instanceof HTMLButtonElement) {
      on(cancel, 'click', (event) => {
        event.preventDefault();
        ui.twofaRegenerateForm.hidden = true;
        ui.twofaRegenerateForm.reset();
      });
    }
  }
}

function setTwoFactorLoading(isLoading) {
  twoFAState.loading = Boolean(isLoading);
  if (ui.twofaSetupButton instanceof HTMLButtonElement) ui.twofaSetupButton.disabled = twoFAState.loading;
  if (ui.twofaVerifySubmit instanceof HTMLButtonElement) ui.twofaVerifySubmit.disabled = twoFAState.loading;
  if (ui.twofaDisableSubmit instanceof HTMLButtonElement) ui.twofaDisableSubmit.disabled = twoFAState.loading;
  if (ui.twofaRegenerateSubmit instanceof HTMLButtonElement) ui.twofaRegenerateSubmit.disabled = twoFAState.loading;
}

function showTwoFactorFeedback(message, variant = 'info') {
  if (!ui.twofaFeedback) return;
  ui.twofaFeedback.textContent = message;
  ui.twofaFeedback.dataset.variant = variant;
  ui.twofaFeedback.hidden = false;
}

function clearTwoFactorFeedback() {
  if (!ui.twofaFeedback) return;
  ui.twofaFeedback.textContent = '';
  ui.twofaFeedback.hidden = true;
  ui.twofaFeedback.removeAttribute('data-variant');
}

function renderTwoFactorStatus() {
  if (ui.twofaStatus) {
    ui.twofaStatus.textContent = twoFAState.enabled
      ? 'Autenticación en dos pasos activada'
      : 'Autenticación en dos pasos desactivada';
  }
  if (ui.twofaSetupButton) ui.twofaSetupButton.hidden = twoFAState.enabled;
  if (ui.twofaEnabledActions) ui.twofaEnabledActions.hidden = !twoFAState.enabled;
  if (ui.twofaSetupPanel) {
    ui.twofaSetupPanel.hidden = !twoFAState.secret || twoFAState.enabled;
  }
}

function renderTwoFactorSetup() {
  if (!ui.twofaSetupPanel) return;
  ui.twofaSetupPanel.hidden = false;
  if (ui.twofaSecret) ui.twofaSecret.textContent = twoFAState.secret || '';
  if (ui.twofaQr instanceof HTMLImageElement) {
    ui.twofaQr.src = twoFAState.qrImage || '';
    ui.twofaQr.hidden = !twoFAState.qrImage;
  }
  if (ui.twofaVerifyForm) ui.twofaVerifyForm.reset();
}

function renderBackupCodes(codes) {
  if (!ui.twofaBackupCodes || !ui.twofaCodesList) return;
  ui.twofaCodesList.innerHTML = '';
  if (!Array.isArray(codes) || !codes.length) {
    ui.twofaBackupCodes.hidden = true;
    return;
  }
  codes.forEach((code) => {
    const li = document.createElement('li');
    li.textContent = code;
    ui.twofaCodesList.appendChild(li);
  });
  ui.twofaBackupCodes.hidden = false;
}

async function loadTwoFactorStatus() {
  if (!ui.twofaSection) return;
  try {
    const res = await requestWithAuth('/api/account/2fa/status');
    if (!res) return;
    if (!res.ok) {
      showTwoFactorFeedback('No se pudo consultar el estado de 2FA.', 'error');
      return;
    }
    const data = await res.json().catch(() => ({}));
    twoFAState.enabled = Boolean(data?.enabled);
    renderTwoFactorStatus();
    renderBackupCodes([]);
    if (ui.twofaDisableForm) {
      ui.twofaDisableForm.hidden = true;
      ui.twofaDisableForm.reset();
    }
    if (ui.twofaRegenerateForm) {
      ui.twofaRegenerateForm.hidden = true;
      ui.twofaRegenerateForm.reset();
    }
  } catch (err) {
    console.error('[account] Error al cargar estado 2FA', err);
    showTwoFactorFeedback('No se pudo consultar el estado de 2FA.', 'error');
  }
}

async function startTwoFactorSetup() {
  clearTwoFactorFeedback();
  setTwoFactorLoading(true);
  try {
    const res = await requestWithAuth('/api/account/2fa/setup', { method: 'POST' });
    if (!res) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showTwoFactorFeedback(data?.error || 'No se pudo iniciar la configuración de 2FA.', 'error');
      return;
    }
    const data = await res.json().catch(() => ({}));
    twoFAState.secret = data?.secret || null;
    twoFAState.otpauthUrl = data?.otpauth_url || null;
    twoFAState.qrImage = data?.qr_image || null;
    twoFAState.enabled = false;
    renderTwoFactorStatus();
    renderTwoFactorSetup();
  } catch (err) {
    console.error('[account] Error al preparar 2FA', err);
    showTwoFactorFeedback('No se pudo iniciar la configuración de 2FA.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorVerify(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  if (!(ui.twofaVerifyInput instanceof HTMLInputElement)) return;
  const code = ui.twofaVerifyInput.value.trim();
  if (!code) {
    showTwoFactorFeedback('Ingresa el código generado por tu aplicación 2FA.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'El código proporcionado no es válido.', 'error');
      return;
    }
    twoFAState.enabled = true;
    twoFAState.backupCodes = Array.isArray(data?.backup_codes) ? data.backup_codes : [];
    renderTwoFactorStatus();
    if (ui.twofaSetupPanel) ui.twofaSetupPanel.hidden = true;
    renderBackupCodes(twoFAState.backupCodes);
    showTwoFactorFeedback(data?.message || 'Autenticación en dos pasos activada.', 'success');
  } catch (err) {
    console.error('[account] Error al activar 2FA', err);
    showTwoFactorFeedback('No se pudo activar la autenticación en dos pasos.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorDisable(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  const codeInput = ui.twofaDisableInput instanceof HTMLInputElement ? ui.twofaDisableInput.value.trim() : '';
  if (!codeInput) {
    showTwoFactorFeedback('Ingresa un código para desactivar la autenticación en dos pasos.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'No se pudo desactivar la autenticación en dos pasos.', 'error');
      return;
    }
    twoFAState.enabled = false;
    twoFAState.secret = null;
    twoFAState.otpauthUrl = null;
    twoFAState.qrImage = null;
    twoFAState.backupCodes = [];
    if (ui.twofaDisableForm) {
      ui.twofaDisableForm.hidden = true;
      ui.twofaDisableForm.reset();
    }
    renderTwoFactorStatus();
    renderBackupCodes([]);
    showTwoFactorFeedback(data?.message || 'Autenticación en dos pasos desactivada.', 'success');
    await loadTwoFactorStatus();
  } catch (err) {
    console.error('[account] Error al desactivar 2FA', err);
    showTwoFactorFeedback('No se pudo desactivar la autenticación en dos pasos.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorRegenerate(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  const codeInput = ui.twofaRegenerateInput instanceof HTMLInputElement ? ui.twofaRegenerateInput.value.trim() : '';
  if (!codeInput) {
    showTwoFactorFeedback('Ingresa un código para regenerar los códigos de respaldo.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/backup-codes/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'No se pudieron regenerar los códigos de respaldo.', 'error');
      return;
    }
    twoFAState.backupCodes = Array.isArray(data?.backup_codes) ? data.backup_codes : [];
    if (ui.twofaRegenerateForm) {
      ui.twofaRegenerateForm.hidden = true;
      ui.twofaRegenerateForm.reset();
    }
    renderBackupCodes(twoFAState.backupCodes);
    showTwoFactorFeedback(data?.message || 'Códigos de respaldo regenerados.', 'success');
  } catch (err) {
    console.error('[account] Error al regenerar códigos de respaldo', err);
    showTwoFactorFeedback('No se pudieron regenerar los códigos de respaldo.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

function renderAdminPanel() {
  if (!ui.adminPanel) return;
  ui.adminPanel.hidden = false;
  if (!adminState.bound) {
    bindAdminPanel();
    adminState.bound = true;
  }
  loadAdminStats();
  loadAdminUsers();
  loadAdminGroups();
}

function bindAdminPanel() {
  if (ui.adminAssignForm) {
    on(ui.adminAssignForm, 'submit', onAdminAssignTeacher);
  }
}

function onAdminAssignTeacher(event) {
  event.preventDefault();
  const userIdInput = ui.adminAssignUserId;
  const visibleIdInput = ui.adminAssignVisibleId;
  const userId = userIdInput instanceof HTMLInputElement ? userIdInput.value.trim() : '';
  const visibleId = visibleIdInput instanceof HTMLInputElement ? visibleIdInput.value.trim() : '';

  if (!userId && !visibleId) {
    toast?.error?.('Ingresa el ID del usuario.');
    return;
  }

  const submit = ui.adminAssignForm?.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  if (userIdInput instanceof HTMLInputElement) userIdInput.disabled = true;
  if (visibleIdInput instanceof HTMLInputElement) visibleIdInput.disabled = true;

  const payload = {};
  if (userId) payload.user_id = userId;
  if (visibleId) payload.visible_id = visibleId;

  handleAdminAssignTeacher(payload).finally(() => {
    if (userIdInput instanceof HTMLInputElement) userIdInput.disabled = false;
    if (visibleIdInput instanceof HTMLInputElement) visibleIdInput.disabled = false;
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleAdminAssignTeacher(payload) {
  const res = await requestWithAuth('/api/admin/users/assign-teacher', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res) return;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo asignar el rol docente.');
    return;
  }

  toast?.success?.('Rol docente asignado.');
  if (ui.adminAssignUserId instanceof HTMLInputElement) ui.adminAssignUserId.value = '';
  if (ui.adminAssignVisibleId instanceof HTMLInputElement) ui.adminAssignVisibleId.value = '';
  loadAdminUsers();
  loadAdminGroups();
  loadAdminStats();
}

async function loadAdminUsers() {
  if (!ui.adminUserList) return;
  ui.adminUserList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando usuarios...';
  ui.adminUserList.appendChild(loading);

  const res = await requestWithAuth('/api/admin/teachers');
  if (!res) {
    ui.adminUserList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudo cargar el listado de usuarios.';
    ui.adminUserList.appendChild(errorMsg);
    return;
  }

  if (res.status === 403) {
    ui.adminUserList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Esta sección está limitada a cuentas con rol administrador.';
    ui.adminUserList.appendChild(errorMsg);
    return;
  }

  if (res.status === 204) {
    renderAdminUsers([]);
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudo obtener el listado de usuarios.');
    ui.adminUserList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Se produjo un error al cargar los usuarios.';
    ui.adminUserList.appendChild(errorMsg);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const users = Array.isArray(data?.teachers) ? data.teachers : [];
  renderAdminUsers(users);
}

function renderAdminUsers(users) {
  if (!ui.adminUserList) return;
  ui.adminUserList.innerHTML = '';

  if (!users.length) {
    const empty = document.createElement('p');
    empty.className = 'role-panel__empty';
    empty.textContent = 'No hay docentes registrados.';
    ui.adminUserList.appendChild(empty);
    return;
  }

  users.forEach((user) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = user?.name || 'Usuario';

    const meta = document.createElement('p');
    meta.className = 'role-panel__meta';
    meta.textContent = user?.email || '';

    const details = document.createElement('p');
    details.className = 'role-panel__meta role-panel__meta--muted';
    details.textContent = `UUID: ${user?.id || 'N/D'} | ID: ${user?.public_id || 'N/D'}`;

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(details);

    ui.adminUserList.appendChild(card);
  });
}

async function loadAdminGroups() {
  if (!ui.adminGroupList) return;
  ui.adminGroupList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando grupos...';
  ui.adminGroupList.appendChild(loading);

  const res = await requestWithAuth('/api/admin/teacher-groups');
  if (!res) {
    ui.adminGroupList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar los grupos.';
    ui.adminGroupList.appendChild(errorMsg);
    return;
  }

  if (res.status === 403) {
    ui.adminGroupList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Necesitas privilegios de administrador para ver los grupos docentes.';
    ui.adminGroupList.appendChild(errorMsg);
    return;
  }

  if (res.status === 204) {
    renderAdminGroups([]);
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar los grupos.');
    ui.adminGroupList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Se produjo un error al consultar los grupos.';
    ui.adminGroupList.appendChild(errorMsg);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  renderAdminGroups(groups);
}

function renderAdminGroups(groups) {
  if (!ui.adminGroupList) return;
  ui.adminGroupList.innerHTML = '';

  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'role-panel__empty';
    empty.textContent = 'No hay grupos registrados.';
    ui.adminGroupList.appendChild(empty);
    return;
  }

  groups.forEach((group) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = group?.name || 'Grupo';

    const meta = document.createElement('p');
    meta.className = 'role-panel__meta';
    meta.textContent = group?.description || 'Sin descripción';

    const teacherInfo = document.createElement('p');
    teacherInfo.className = 'role-panel__meta role-panel__meta--muted';
    const teacher = group?.teacher;
    if (teacher) {
      teacherInfo.textContent = `Docente: ${teacher.name || 'N/D'} (${teacher.email || 'sin correo'})`;
    } else {
      teacherInfo.textContent = 'Docente no disponible.';
    }

    const totals = document.createElement('p');
    totals.className = 'role-panel__meta role-panel__meta--muted';
    totals.textContent = `Estudiantes: ${group?.member_count ?? 0}`;

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(teacherInfo);
    card.appendChild(totals);

    ui.adminGroupList.appendChild(card);
  });
}

function renderDevelopmentPanel() {
  if (!ui.developmentPanel) return;
  ui.developmentPanel.hidden = false;
  if (!developmentState.bound) {
    bindDevelopmentPanel();
    developmentState.bound = true;
  }
  loadDevelopmentRequests();
}

function bindDevelopmentPanel() {
  if (ui.developmentAssignForm) {
    on(ui.developmentAssignForm, 'submit', onDevelopmentAssignAdmin);
  }
  if (ui.developmentBackupBtn) {
    on(ui.developmentBackupBtn, 'click', onDevelopmentCreateBackup);
  }
  if (ui.developmentRestoreForm) {
    on(ui.developmentRestoreForm, 'submit', onDevelopmentRestore);
  }
}

function onDevelopmentAssignAdmin(event) {
  event.preventDefault();
  const userId = ui.developmentUserId instanceof HTMLInputElement ? ui.developmentUserId.value.trim() : '';
  const visibleId = ui.developmentVisibleId instanceof HTMLInputElement ? ui.developmentVisibleId.value.trim() : '';
  const requestId = ui.developmentRequestId instanceof HTMLInputElement ? ui.developmentRequestId.value.trim() : '';

  if (!userId && !visibleId) {
    toast?.error?.('Ingresa el ID del usuario.');
    return;
  }

  const submit = ui.developmentAssignForm?.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;

  handleDevelopmentAssignAdmin({ user_id: userId || undefined, visible_id: visibleId || undefined, request_id: requestId || undefined }).finally(() => {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleDevelopmentAssignAdmin(payload) {
  const res = await requestWithAuth('/api/development/users/assign-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res) return;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo asignar el rol admin.');
    return;
  }

  toast?.success?.('Rol admin asignado.');
  if (ui.developmentAssignForm instanceof HTMLFormElement) ui.developmentAssignForm.reset();
  await loadDevelopmentRequests();
}

function onDevelopmentCreateBackup() {
  handleDevelopmentCreateBackup();
}

async function handleDevelopmentCreateBackup() {
  const desiredName = ui.developmentBackupName instanceof HTMLInputElement ? ui.developmentBackupName.value.trim() : '';
  const options = { method: 'POST' };
  if (desiredName) options.body = JSON.stringify({ backup_name: desiredName });

  const res = await requestWithAuth('/api/development/backups/run', options);
  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err?.error || 'No se pudo iniciar el backup.';
    if (res.status === 403) toast?.info?.(message);
    else toast?.error?.(message);
    return;
  }
  const data = await res.json().catch(() => ({}));
  const label = data?.backup?.filename ? ` (${data.backup.filename})` : '';
  toast?.success?.(`${data?.message || 'Backup generado.'}${label}`);
}

function onDevelopmentRestore(event) {
  event.preventDefault();
  const backupName = ui.developmentBackupName instanceof HTMLInputElement ? ui.developmentBackupName.value.trim() : '';

  const submit = ui.developmentRestoreForm?.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;

  handleDevelopmentRestore(backupName).finally(() => {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleDevelopmentRestore(backupName) {
  if (!backupName) {
    toast?.error?.('Ingresa el nombre del backup a restaurar.');
    return;
  }

  const res = await requestWithAuth('/api/development/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup_name: backupName || undefined }),
  });
  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err?.error || 'No se pudo iniciar la restauración.';
    if (res.status === 403) toast?.info?.(message);
    else toast?.error?.(message);
    return;
  }
  const data = await res.json().catch(() => ({}));
  const label = data?.backup?.filename ? ` (${data.backup.filename})` : '';
  toast?.success?.(`${data?.message || 'Restauración completada.'}${label}`);
  if (ui.developmentRestoreForm instanceof HTMLFormElement) ui.developmentRestoreForm.reset();
}

async function loadDevelopmentRequests() {
  if (!ui.developmentRequestsList) return;
  ui.developmentRequestsList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando solicitudes...';
  ui.developmentRequestsList.appendChild(loading);

  const res = await requestWithAuth('/api/development/role-requests');
  if (!res) {
    ui.developmentRequestsList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar las solicitudes.';
    ui.developmentRequestsList.appendChild(errorMsg);
    return;
  }

  if (res.status === 403) {
    ui.developmentRequestsList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Esta sección es exclusiva para el equipo de desarrollo.';
    ui.developmentRequestsList.appendChild(errorMsg);
    return;
  }

  if (res.status === 204) {
    renderDevelopmentRequests([]);
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar las solicitudes de roles.');
    ui.developmentRequestsList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Se produjo un error al consultar las solicitudes.';
    ui.developmentRequestsList.appendChild(errorMsg);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  renderDevelopmentRequests(requests);
}

function renderDevelopmentRequests(requests) {
  if (!ui.developmentRequestsList) return;
  ui.developmentRequestsList.innerHTML = '';

  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'role-panel__empty';
    empty.textContent = 'No hay solicitudes pendientes.';
    ui.developmentRequestsList.appendChild(empty);
    return;
  }

  requests.forEach((req) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = req?.user?.name || 'Usuario';

    const meta = document.createElement('p');
    meta.className = 'role-panel__meta';
    meta.textContent = `Solicita: ${req?.requested_role || 'rol'} | Estado: ${req?.status || 'pendiente'}`;

    const details = document.createElement('p');
    details.className = 'role-panel__meta role-panel__meta--muted';
    const visible = req?.user?.public_id ? `ID: ${req.user.public_id}` : 'ID: N/D';
    details.textContent = `${visible} | UUID solicitud: ${req?.id || 'N/D'}`;

    let notes = null;
    if (req?.notes) {
      notes = document.createElement('p');
      notes.className = 'role-panel__meta';
      notes.textContent = `Notas: ${req.notes}`;
    }

    const actions = document.createElement('div');
    actions.className = 'role-panel__member-actions';

    if (req?.status === 'pending') {
      const approve = document.createElement('button');
      approve.className = 'btn btn--primary btn--sm';
      approve.type = 'button';
      approve.textContent = 'Aprobar';
      approve.dataset.requestId = req?.id || '';
      approve.dataset.action = 'approve';
      on(approve, 'click', onDevelopmentResolveRequest);

      const reject = document.createElement('button');
      reject.className = 'btn btn--ghost btn--sm';
      reject.type = 'button';
      reject.textContent = 'Rechazar';
      reject.dataset.requestId = req?.id || '';
      reject.dataset.action = 'reject';
      on(reject, 'click', onDevelopmentResolveRequest);

      actions.appendChild(approve);
      actions.appendChild(reject);
    } else if (req?.resolver) {
      const resolver = document.createElement('p');
      resolver.className = 'role-panel__meta role-panel__meta--muted';
      resolver.textContent = `Resuelto por: ${req.resolver.name}`;
      actions.appendChild(resolver);
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(details);
    if (notes) card.appendChild(notes);
    card.appendChild(actions);

    ui.developmentRequestsList.appendChild(card);
  });
}

function onDevelopmentResolveRequest(event) {
  event.preventDefault();
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const requestId = button.dataset.requestId;
  const action = button.dataset.action;
  if (!requestId || !action) return;
  button.disabled = true;
  handleDevelopmentResolveRequest(requestId, action).finally(() => {
    button.disabled = false;
  });
}

async function handleDevelopmentResolveRequest(requestId, action) {
  const res = await requestWithAuth(`/api/development/role-requests/${requestId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo actualizar la solicitud.');
    return;
  }

  const data = await res.json().catch(() => ({}));
  toast?.success?.(data?.message || 'Solicitud actualizada.');
  await loadDevelopmentRequests();
}

function handleUnauthorized(showToast = true) {
  resetAccountUI();
  setAuthVisibility(false);
  if (!unauthorizedHandled && showToast) {
    unauthorizedHandled = true;
    toast?.error?.('Debes iniciar sesión para ver esta sección. Usa el botón o vuelve al inicio.');
  }
  return null;
}

async function requestWithAuth(url, options) {
  try {
    const res = await authFetch(url, options);
    if (res?.status === 401) return handleUnauthorized();
    return res;
  } catch (err) {
    console.error('[account] Error de red', err);
    toast?.error?.('Error de red al contactar la API.');
    return null;
  }
}

function toggleHistoryPanel(force) {
  if (!ui.historyPanel || !ui.historyToggle) return false;
  const shouldOpen = force ?? ui.historyPanel.hidden;
  ui.historyPanel.hidden = !shouldOpen;
  ui.historyToggle.setAttribute('aria-expanded', String(shouldOpen));
  ui.historyToggle.textContent = shouldOpen ? 'Ocultar historial' : 'Mostrar historial';
  if (ui.historyCard) ui.historyCard.setAttribute('data-history-open', shouldOpen ? 'true' : 'false');
  if (ui.historyCollapsed) {
    ui.historyCollapsed.hidden = shouldOpen;
    ui.historyCollapsed.setAttribute('aria-hidden', String(shouldOpen));
  }
  return shouldOpen;
}

function bindHistoryToggle() {
  if (!ui.historyToggle) return;
  ui.historyToggle.setAttribute('aria-expanded', 'false');
  on(ui.historyToggle, 'click', () => {
    const opened = toggleHistoryPanel();
    if (opened) ui.historyPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  if (ui.historyCTA) {
    on(ui.historyCTA, 'click', () => {
      if (toggleHistoryPanel(true)) {
        ui.historyPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
}

function bindHistoryPanel() {
  if (historyState.bound) return;
  historyState.bound = true;

  if (ui.historyFiltersForm) {
    on(ui.historyFiltersForm, 'submit', handleHistoryFiltersSubmit);
    on(ui.historyFiltersForm, 'reset', handleHistoryFiltersReset);
  }
  if (ui.historyPrev) {
    on(ui.historyPrev, 'click', handleHistoryPrev);
  }
  if (ui.historyNext) {
    on(ui.historyNext, 'click', handleHistoryNext);
  }
  if (ui.historyExportButtons?.length) {
    ui.historyExportButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        on(button, 'click', handleHistoryExportClick);
      }
    });
  }
}

function parseTagsInput(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatNumber(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return numberFormatter.format(num);
}

function buildHistoryParams() {
  const params = new URLSearchParams();
  params.set('page', String(historyState.page));
  params.set('page_size', String(historyState.pageSize));
  if (historyState.q) params.set('q', historyState.q);
  if (historyState.from) params.set('from', historyState.from);
  if (historyState.to) params.set('to', historyState.to);
  if (historyState.tags.length) params.set('tags', historyState.tags.join(','));
  if (historyState.order && historyState.order !== 'desc') {
    params.set('order', historyState.order);
  }
  return params;
}

function setHistoryLoading(isLoading) {
  historyState.loading = Boolean(isLoading);
  if (ui.historyLoading) ui.historyLoading.hidden = !historyState.loading;
  if (ui.historyList) {
    ui.historyList.classList.toggle('history-list--loading', historyState.loading);
    ui.historyList.setAttribute('aria-busy', historyState.loading ? 'true' : 'false');
  }
  if (ui.historyFiltersForm) {
    const submitBtn = ui.historyFiltersForm.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = historyState.loading;
  }
  ui.historyExportButtons?.forEach((button) => {
    if (button instanceof HTMLButtonElement && !historyState.exporting) {
      button.disabled = historyState.loading;
    }
  });
  if (ui.historyPrev instanceof HTMLButtonElement) {
    ui.historyPrev.disabled = historyState.loading || historyState.page <= 1;
  }
  if (ui.historyNext instanceof HTMLButtonElement) {
    const atEnd = historyState.totalPages > 0 && historyState.page >= historyState.totalPages;
    ui.historyNext.disabled = historyState.loading || atEnd;
  }
}

function clearHistoryError() {
  if (!ui.historyError) return;
  ui.historyError.textContent = '';
  ui.historyError.hidden = true;
}

function showHistoryError(message) {
  if (!ui.historyError) return;
  ui.historyError.textContent = message;
  ui.historyError.hidden = false;
}

function updateHistoryPagination(meta) {
  historyState.total = Number(meta?.total ?? historyState.total ?? 0);
  historyState.totalPages = Number(meta?.total_pages ?? historyState.totalPages ?? 0);
  const pageFromMeta = Number(meta?.page);
  if (!Number.isNaN(pageFromMeta) && pageFromMeta > 0) {
    historyState.page = pageFromMeta;
  }
  const pageSizeFromMeta = Number(meta?.page_size);
  if (!Number.isNaN(pageSizeFromMeta) && pageSizeFromMeta > 0) {
    historyState.pageSize = pageSizeFromMeta;
  }

  const totalPages = historyState.totalPages || 0;
  const paginationHidden = totalPages <= 1 && historyState.page <= 1;
  if (ui.historyPagination) ui.historyPagination.hidden = paginationHidden;

  if (ui.historyPageInfo) {
    const pagesLabel = totalPages > 0 ? totalPages : 1;
    const currentPage = historyState.page > 0 ? historyState.page : 1;
    ui.historyPageInfo.textContent = `Página ${currentPage} de ${pagesLabel}`;
  }

  if (ui.historyPrev instanceof HTMLButtonElement) {
    ui.historyPrev.disabled = historyState.loading || historyState.page <= 1;
  }
  if (ui.historyNext instanceof HTMLButtonElement) {
    const atEnd = totalPages === 0 || historyState.page >= totalPages;
    ui.historyNext.disabled = historyState.loading || atEnd;
  }
}

function renderHistoryItems(items) {
  if (!ui.historyList) return;
  ui.historyList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    if (ui.historyEmpty) {
      ui.historyEmpty.hidden = false;
      const message = qs('p', ui.historyEmpty);
      if (message) message.textContent = 'No encontramos registros para los filtros actuales.';
    }
    return;
  }

  if (ui.historyEmpty) ui.historyEmpty.hidden = true;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-item__main';

    const expr = document.createElement('span');
    expr.className = 'history-expr';
    const expressionValue = item?.expression ?? '';
    expr.textContent = expressionValue || 'Expresión sin nombre';
    if (expressionValue) expr.title = expressionValue;
    main.appendChild(expr);

    if (item?.deleted) {
      const badge = document.createElement('span');
      badge.className = 'history-badge history-badge--deleted';
      badge.textContent = 'Eliminado';
      main.appendChild(badge);
    }

    const dateLabel = document.createElement('time');
    dateLabel.className = 'history-date';
    const formatted = formatHistoryDate(item?.created_at);
    if (formatted) {
      dateLabel.textContent = formatted;
      if (item?.created_at) dateLabel.dateTime = item.created_at;
    } else {
      dateLabel.textContent = 'Sin fecha';
    }
    main.appendChild(dateLabel);
    li.appendChild(main);

    const metaContainer = document.createElement('div');
    metaContainer.className = 'history-item__meta';

    if (Array.isArray(item?.tags) && item.tags.length) {
      const tagList = document.createElement('ul');
      tagList.className = 'history-tags';
      item.tags.forEach((tagValue) => {
        if (!tagValue) return;
        const tagItem = document.createElement('li');
        tagItem.className = 'history-tag';
        tagItem.textContent = tagValue;
        tagList.appendChild(tagItem);
      });
      metaContainer.appendChild(tagList);
    }

    li.appendChild(metaContainer);
    ui.historyList.appendChild(li);
  });
}

function formatHistoryDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function handleHistoryFiltersSubmit(event) {
  event.preventDefault();
  historyState.page = 1;
  historyState.q = ui.historySearch instanceof HTMLInputElement ? ui.historySearch.value.trim() : '';
  historyState.from = ui.historyFrom instanceof HTMLInputElement ? ui.historyFrom.value : '';
  historyState.to = ui.historyTo instanceof HTMLInputElement ? ui.historyTo.value : '';
  historyState.tags = ui.historyTags instanceof HTMLInputElement ? parseTagsInput(ui.historyTags.value) : [];
  clearHistoryError();
  loadPlotHistory();
}

function handleHistoryFiltersReset(event) {
  event.preventDefault();
  if (ui.historyFiltersForm) ui.historyFiltersForm.reset();
  historyState.page = 1;
  historyState.q = '';
  historyState.from = '';
  historyState.to = '';
  historyState.tags = [];
  clearHistoryError();
  loadPlotHistory();
}

function handleHistoryPrev(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.page <= 1) return;
  historyState.page -= 1;
  loadPlotHistory();
}

function handleHistoryNext(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.totalPages && historyState.page >= historyState.totalPages) return;
  historyState.page += 1;
  loadPlotHistory();
}

async function handleHistoryExportClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const format = button.dataset.historyExport;
  if (!format || historyState.exporting) return;
  await exportHistory(format, button);
}

async function exportHistory(format, button) {
  historyState.exporting = true;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Generando...';
  clearHistoryError();

  try {
    const params = buildHistoryParams();
    params.set('format', format);
    const res = await requestWithAuth(`/api/plot/history/export?${params.toString()}`);
    if (!res) return;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data?.error || 'No se pudo exportar el historial.';
      showHistoryError(message);
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const fallbackName = `plot-history-${Date.now()}.${format}`;
    const filename = match ? match[1] : fallbackName;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  } catch (err) {
    console.error('[account] Error al exportar historial', err);
    showHistoryError('No se pudo exportar el historial. Intenta nuevamente.');
  } finally {
    historyState.exporting = false;
    button.disabled = false;
    button.textContent = originalLabel || 'Exportar';
  }
}

function bindGuestOverlay() {
  if (!ui.guestShell) return;
  on(ui.guestShell, 'click', (event) => {
    if (event.target === ui.guestShell) {
      toast?.info?.('Inicia sesión o vuelve al inicio para salir de esta pantalla.');
    }
  });
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

async function loadPlotHistory() {
  if (historyState.loading) return;
  clearHistoryError();
  setHistoryLoading(true);

  try {
    const params = buildHistoryParams();
    const res = await requestWithAuth(`/api/plot/history?${params.toString()}`);
    if (!res) return;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data?.error || 'No se pudo cargar el historial de gráficas.';
      showHistoryError(message);
      renderHistoryItems([]);
      updateHistoryPagination({ page: historyState.page, total: 0, total_pages: 0, page_size: historyState.pageSize });
      if (ui.historyCount) ui.historyCount.textContent = '—';
      if (ui.historyEmpty) {
        ui.historyEmpty.hidden = false;
        const msg = qs('p', ui.historyEmpty);
        if (msg) msg.textContent = 'Error al cargar el historial.';
      }
      return;
    }

    const payload = await res.json().catch(() => ({}));
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const meta = payload?.meta || {};

    updateHistoryPagination(meta);
    renderHistoryItems(items);

    const total = Number(meta?.total);
    if (ui.historyCount) {
      if (!Number.isNaN(total) && total >= 0) {
        ui.historyCount.textContent = total === 1 ? '1 registro' : `${total} registros`;
      } else {
        const count = items.length;
        ui.historyCount.textContent = count === 1 ? '1 registro' : `${count} registros`;
      }
    }
  } finally {
    setHistoryLoading(false);
  }
}

async function loadTickets() {
  if (!ui.ticketsList) return;
  setTicketsLoading(true);
  clearTicketFeedback();

  try {
    const params = new URLSearchParams();
    params.set('page', String(ticketsState.page));
    params.set('page_size', String(ticketsState.pageSize));

    const res = await requestWithAuth(`/api/account/requests?${params.toString()}`);
    if (!res) return;

    if (!res.ok) {
      showTicketFeedback('No se pudieron cargar tus solicitudes.', 'error');
      renderTickets([]);
      return;
    }

    const payload = await res.json().catch(() => ({}));
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const meta = payload?.meta || {};
    updateTicketsPagination(meta);
    renderTickets(items);
  } finally {
    setTicketsLoading(false);
  }
}

function initAccountPage() {
  bindHistoryToggle();
  bindHistoryPanel();
  bindTicketsSection();
  bindTwoFactorSection();
  bindGuestOverlay();
  const hasToken = Boolean(localStorage.getItem(SESSION_KEY));
  if (!hasToken) {
    handleUnauthorized(false);
    return;
  }
  loadAccountDetails();
  loadPlotHistory();
  loadTickets();
  loadTwoFactorStatus();
}

document.addEventListener('DOMContentLoaded', initAccountPage);

window.addEventListener('ecuplot:user', (event) => {
  const user = event.detail;
  if (user) {
    renderAccountDetails(user);
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
  loadPlotHistory();
  loadTickets();
  loadTwoFactorStatus();
});
