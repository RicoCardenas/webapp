import { authFetch, toast, getCurrentUser, refreshCurrentUser, eventStream } from '/static/app.js';
import { qs, qsa } from './lib/dom.js';
import { on } from './lib/events.js';
import { ensureHistoryStore } from './lib/history-store-singleton.js';
import { createNotificationsStore } from './lib/notifications-store.js';
import { hasSessionToken } from './lib/session.js';
import {
  DEFAULT_EXERCISES,
  mergeLearningCatalog,
  readLocalLearningProgress,
  updateLocalLearningEntry,
  writeLocalLearningProgress,
  buildProgressMapFromExercises,
} from './lib/learning-data.js';

let unauthorizedHandled = false;
const teacherState = { bound: false };
const adminState = { bound: false };
const developmentState = {
  bound: false,
  admins: [],
  adminsTotal: 0,
  adminsLoading: false,
  opsLoading: false,
  opsEvents: [],
  opsTotal: 0,
  opsPage: 1,
  opsPageSize: 20,
  opsHasNext: false,
  opsHasPrev: false,
  opsPaginationBound: false,
  opsNeedsRefresh: false,
  opsUnsubscribe: null,
};
const developmentRemovalState = { target: null, loading: false };
const adminRequestState = { bound: false, loading: false, status: 'none' };
const DASHBOARD_WIDGET_META = {
  stats: { id: 'account-details-box', label: 'Resumen' },
  history: { id: 'account-history-box', label: 'Historial' },
  notifications: { id: 'account-notifications-box', label: 'Notificaciones' },
  tickets: { id: 'account-tickets-box', label: 'Solicitudes' },
  security: { id: 'account-2fa-box', label: 'Seguridad' },
  learning: { id: 'account-learning-box', label: 'Aprendizaje' },
};
const DEFAULT_DASHBOARD_LAYOUT = {
  order: Object.keys(DASHBOARD_WIDGET_META),
  hidden: [],
  hiddenPanels: [],
};
const DASHBOARD_ROLE_WIDGETS = {
  teacher: { id: 'teacher-panel', label: 'Panel docente', role: 'teacher' },
  admin: { id: 'admin-panel', label: 'Panel administrador', role: 'admin' },
  development: { id: 'development-panel', label: 'Panel desarrollo', role: 'development' },
};
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
  initialized: false,
  items: [],
  pendingDeletes: new Set(),
  listActionsBound: false,
};
const historyStore = ensureHistoryStore({
  authFetch,
  eventStream,
  initialFilters: {
    page: historyState.page,
    pageSize: historyState.pageSize,
    order: historyState.order,
    q: historyState.q,
  },
});
const notificationsState = {
  bound: false,
  loading: false,
  page: 1,
  totalPages: 0,
  includeRead: false,
  category: '',
  unread: 0,
  items: [],
  preferences: {},
  categories: {},
  knownIds: new Set(),
  error: null,
};
const notificationsStore = createNotificationsStore({
  authFetch,
  eventStream,
});
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
const securityState = {
  loading: false,
  bound: false,
  last: null,
  fetched: false,
  error: null,
};
const dashboardState = {
  layout: getDefaultDashboardLayout(),
  draft: null,
  bound: false,
  key: null,
};
const learningProgressState = {
  bound: false,
  items: [],
  loading: false,
  localProgress: readLocalLearningProgress(),
  unsubscribe: null,
};
const learningDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatLearningDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return learningDateFormatter.format(date);
}

function renderLearningProgress(exercises) {
  if (!ui.learningList) return;
  const list = ui.learningList;
  const items = Array.isArray(exercises) ? exercises : [];
  learningProgressState.items = items;

  list.innerHTML = '';

  const completedCount = items.reduce((acc, item) => (item?.completed ? acc + 1 : acc), 0);

  if (!items.length) {
    if (ui.learningEmpty) {
      ui.learningEmpty.hidden = false;
      ui.learningEmpty.textContent = 'No hay ejercicios disponibles en este momento.';
    }
    if (ui.learningCard) {
      delete ui.learningCard.dataset.completedCount;
      delete ui.learningCard.dataset.totalCount;
    }
    return;
  }

  items.forEach((exercise) => {
    if (!exercise || !exercise.id) return;
    const li = document.createElement('li');
    li.className = 'learning-progress__item';
    li.dataset.exerciseId = exercise.id;
    if (exercise.completed) li.classList.add('is-completed');

    const title = document.createElement('span');
    title.className = 'learning-progress__title';
    title.textContent = exercise.title || exercise.id;
    if (exercise.description) title.title = exercise.description;

    const status = document.createElement('span');
    status.className = 'learning-progress__status';
    status.textContent = exercise.completed ? 'Completado' : 'Pendiente';
    if (exercise.completed) status.classList.add('is-success');

    const meta = document.createElement('span');
    meta.className = 'learning-progress__meta';
    if (exercise.completed && exercise.completed_at) {
      const formatted = formatLearningDate(exercise.completed_at);
      meta.textContent = formatted ? `Completado el ${formatted}` : 'Completado';
    } else if (exercise.expression) {
      meta.textContent = exercise.expression;
    } else if (exercise.description) {
      meta.textContent = exercise.description;
    }

    li.appendChild(title);
    li.appendChild(status);
    if (meta.textContent) li.appendChild(meta);

    list.appendChild(li);
  });

  if (ui.learningEmpty) {
    ui.learningEmpty.hidden = completedCount > 0;
    if (!completedCount) ui.learningEmpty.textContent = 'No has completado ejercicios todavía.';
  }

  if (ui.learningCard) {
    ui.learningCard.dataset.completedCount = String(completedCount);
    ui.learningCard.dataset.totalCount = String(items.length);
  }
}

function applyLearningProgress(exercises, { persist = true } = {}) {
  const catalog = mergeLearningCatalog(DEFAULT_EXERCISES, exercises, learningProgressState.localProgress);
  if (persist) {
    const serverProgress = buildProgressMapFromExercises(exercises);
    const merged = { ...learningProgressState.localProgress, ...serverProgress };
    learningProgressState.localProgress = merged;
    writeLocalLearningProgress(merged);
  }
  renderLearningProgress(catalog);
}

async function loadLearningProgress(options = {}) {
  if (!ui.learningList) return;
  if (learningProgressState.loading) return;

  ensureLearningSubscription();

  learningProgressState.loading = true;

  if (!options.skipLocal) {
    const localCatalog = mergeLearningCatalog(DEFAULT_EXERCISES, [], learningProgressState.localProgress);
    renderLearningProgress(localCatalog);
  }

  try {
    const res = await requestWithAuth('/api/learning/exercises');
    if (!res) return;
    if (!res.ok) {
      if (!options.silent) {
        toast?.error?.('No se pudo cargar el progreso de aprendizaje.');
      }
      return;
    }
    const payload = await res.json().catch(() => ({}));
    const exercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
    const serverProgress = buildProgressMapFromExercises(exercises);
    const mergedProgress = { ...learningProgressState.localProgress, ...serverProgress };
    learningProgressState.localProgress = mergedProgress;
    writeLocalLearningProgress(mergedProgress);
    applyLearningProgress(exercises, { persist: false });
  } finally {
    learningProgressState.loading = false;
  }
}

function ensureLearningSubscription() {
  if (!eventStream || learningProgressState.unsubscribe) return;
  learningProgressState.unsubscribe = eventStream.subscribeChannel('learning', handleLearningProgressEvent);
  eventStream.ensure?.();
}

function clearLearningSubscription() {
  if (typeof learningProgressState.unsubscribe === 'function') {
    learningProgressState.unsubscribe();
  }
  learningProgressState.unsubscribe = null;
}

function handleLearningProgressEvent(payload) {
  const event = payload?.data || {};
  const exerciseId = event.exercise_id;
  if (!exerciseId) return;

  const completedAt = event.completed_at || new Date().toISOString();
  if (event.completed) {
    learningProgressState.localProgress = updateLocalLearningEntry(exerciseId, { completedAt });
  }

  const current = learningProgressState.items.slice();
  let updated = false;
  let changed = false;
  for (let index = 0; index < current.length; index += 1) {
    const item = current[index];
    if (item.id !== exerciseId) continue;
    if (item.completed && item.completed_at === completedAt) {
      updated = true;
      break;
    }
    current[index] = {
      ...item,
      completed: Boolean(event.completed),
      completed_at: completedAt,
    };
    updated = true;
    changed = true;
    break;
  }

  if (!updated) {
    const fallback = DEFAULT_EXERCISES.find((exercise) => exercise.id === exerciseId) || { id: exerciseId, title: exerciseId };
    current.push({
      ...fallback,
      completed: Boolean(event.completed),
      completed_at: completedAt,
    });
    changed = true;
  }

  if (!changed) return;

  renderLearningProgress(current);

  if (event.completed) {
    const exercise = learningProgressState.items.find((item) => item.id === exerciseId);
    const label = exercise?.title || exerciseId;
    toast?.success?.(`Ejercicio completado: ${label}`);
  }
}

function resetLearningProgressUI() {
  learningProgressState.items = [];
  if (ui.learningList) ui.learningList.innerHTML = '';
  if (ui.learningEmpty) {
    ui.learningEmpty.hidden = false;
    ui.learningEmpty.textContent = 'Inicia sesión para ver tu progreso.';
  }
  if (ui.learningCard) {
    delete ui.learningCard.dataset.completedCount;
    delete ui.learningCard.dataset.totalCount;
  }
}
const accountState = {
  user: null,
  roles: new Set(),
};

const OPS_EVENT_LABELS = {
  'auth.login.failed': 'Inicio de sesión fallido',
  'auth.account.locked': 'Cuenta bloqueada',
  'auth.login.succeeded': 'Inicio de sesión exitoso',
  'role.admin.assigned': 'Asignación de rol administrador',
  'role.admin.removed': 'Revocación de rol administrador',
  'security.2fa.enabled': '2FA activada',
  'security.2fa.disabled': '2FA desactivada',
  'security.2fa.backup_regenerated': 'Códigos 2FA regenerados',
  'ops.backup.created': 'Backup ejecutado',
};

const numberFormatter = new Intl.NumberFormat('es-CO');
const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

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
  historyOrder: qs('#history-order'),
  dashboardCustomize: qs('#dashboard-customize'),
  dashboardModal: qs('#dashboard-modal'),
  dashboardWidgetsList: qs('#dashboard-widgets-list'),
  dashboardSave: qs('#dashboard-save'),
  dashboardCancelButtons: Array.from(qsa('[data-dashboard-cancel]')),
  dashboardLayout: qs('.account-layout'),
  dashboardPanels: qs('.account-panels'),
  securityCard: qs('#account-2fa-box'),
  securitySummary: qs('#security-summary'),
  securityRefresh: qs('#security-refresh'),
  securityLastLogin: qs('#security-last-login'),
  securityFailedAttempts: qs('#security-failed-attempts'),
  securityLockouts: qs('#security-lockouts'),
  securityActiveSessions: qs('#security-active-sessions'),
  securityRecommendations: qs('#security-recommendations'),
  notificationsCard: qs('#account-notifications-box'),
  notificationsList: qs('#notifications-list'),
  notificationsEmpty: qs('#notifications-empty'),
  notificationsUnread: qs('#notifications-unread'),
  notificationsCategory: qs('#notifications-category'),
  notificationsIncludeRead: qs('#notifications-include-read'),
  notificationsPagination: qs('#notifications-pagination'),
  notificationsPrev: qs('#notifications-prev'),
  notificationsNext: qs('#notifications-next'),
  notificationsPageInfo: qs('#notifications-page-info'),
  notificationsPrefsToggle: qs('#notifications-prefs-toggle'),
  notificationsPrefsForm: qs('#notifications-preferences-form'),
  notificationsPrefsFields: qs('#notifications-preferences-fields'),
  notificationsRefresh: qs('#notifications-refresh'),
  notificationsMarkAll: qs('#notifications-mark-all'),
  learningCard: qs('#account-learning-box'),
  learningList: qs('#learning-progress-list'),
  learningEmpty: qs('#learning-progress-empty'),
  learningOpenGraph: qs('#learning-open-graph'),
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
  opsBackupStatus: qs('#development-backup-status'),
  opsBackupMeta: qs('#development-backup-meta'),
  opsEventsList: qs('#development-ops-events'),
  opsEventsEmpty: qs('#development-ops-events-empty'),
  opsEventsPagination: qs('#development-ops-pagination'),
  opsEventsPrev: qs('#development-ops-prev'),
  opsEventsNext: qs('#development-ops-next'),
  opsEventsPageInfo: qs('#development-ops-page-info'),
  developmentAdminList: qs('#development-admin-list'),
  developmentAdminEmpty: qs('#development-admin-empty'),
  developmentRemoveModal: qs('#development-remove-modal'),
  developmentRemoveMessage: qs('#development-remove-message'),
  developmentRemoveConfirm: qs('#development-remove-confirm'),
  developmentRemoveCancel: qs('[data-development-remove-cancel]'),
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

notificationsStore.subscribe(handleNotificationsSnapshot);
historyStore.subscribe(handleHistorySnapshot);

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

function openModal(modal) {
  if (!modal || modal.classList.contains('is-open')) return;
  modal.hidden = false;
  modal.classList.add('is-open');
  document.body.classList.add('has-modal');
  modal.__lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable = modal.querySelector(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

function closeModal(modal) {
  if (!modal || !modal.classList.contains('is-open')) return;
  modal.classList.remove('is-open');
  modal.hidden = true;
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
  resetSecuritySummary();
  resetTwoFactor();
  developmentState.opsEvents = [];
  developmentState.opsTotal = 0;
  developmentState.opsPage = 1;
  developmentState.opsHasNext = false;
  developmentState.opsHasPrev = false;
  developmentState.opsNeedsRefresh = false;
  if (ui.opsEventsList) ui.opsEventsList.innerHTML = '';
  if (ui.opsEventsEmpty) {
    ui.opsEventsEmpty.hidden = false;
    ui.opsEventsEmpty.textContent = 'No hay eventos recientes.';
  }
  if (ui.opsEventsPagination) ui.opsEventsPagination.hidden = true;
  if (ui.opsBackupStatus) ui.opsBackupStatus.textContent = 'Último backup: sin registros';
  if (ui.opsBackupMeta) ui.opsBackupMeta.textContent = '';
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

function resetSecuritySummary() {
  securityState.loading = false;
  securityState.last = null;
  securityState.fetched = false;
  securityState.error = null;
  if (ui.securitySummary) ui.securitySummary.setAttribute('aria-busy', 'false');
  if (ui.securityLastLogin) ui.securityLastLogin.textContent = 'Cargando...';
  if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = '—';
  if (ui.securityLockouts) ui.securityLockouts.textContent = '—';
  if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = '—';
  if (ui.securityRecommendations) {
    ui.securityRecommendations.replaceChildren();
    const item = document.createElement('li');
    item.textContent = 'Sin recomendaciones disponibles.';
    ui.securityRecommendations.appendChild(item);
  }
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    const label = ui.securityRefresh.dataset.defaultLabel || ui.securityRefresh.textContent || 'Actualizar seguridad';
    ui.securityRefresh.disabled = false;
    ui.securityRefresh.textContent = label;
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
  updateDashboardContext(user, roles);
}

function hideRolePanels() {
  if (ui.teacherPanel) {
    ui.teacherPanel.hidden = true;
    ui.teacherPanel.dataset.roleAvailable = 'false';
    if (ui.teacherGroupList) ui.teacherGroupList.innerHTML = '';
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Aún no has creado grupos.';
      ui.teacherGroupsEmpty.hidden = true;
    }
  }
  if (ui.adminPanel) {
    ui.adminPanel.hidden = true;
    ui.adminPanel.dataset.roleAvailable = 'false';
    if (ui.adminUserList) ui.adminUserList.innerHTML = '';
    if (ui.adminGroupList) ui.adminGroupList.innerHTML = '';
  }
  if (ui.developmentPanel) {
    ui.developmentPanel.hidden = true;
    ui.developmentPanel.dataset.roleAvailable = 'false';
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
  ui.teacherPanel.dataset.roleAvailable = 'true';
  const hiddenByLayout = isDashboardPanelHidden('teacher');
  ui.teacherPanel.hidden = hiddenByLayout;
  if (hiddenByLayout) {
    ui.teacherPanel.setAttribute('aria-hidden', 'true');
  } else {
    ui.teacherPanel.removeAttribute('aria-hidden');
  }
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

function bindLearningSection() {
  if (learningProgressState.bound) return;
  learningProgressState.bound = true;
  if (ui.learningOpenGraph) {
    on(ui.learningOpenGraph, 'click', (event) => {
      event.preventDefault();
      handleLearningOpenGraph();
    });
  }
  ensureLearningSubscription();
}

function handleLearningOpenGraph() {
  const button = ui.learningOpenGraph;
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    window.location.assign('/graph');
  } finally {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
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

function bindSecuritySection() {
  if (securityState.bound) return;
  securityState.bound = true;
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    if (!ui.securityRefresh.dataset.defaultLabel) {
      ui.securityRefresh.dataset.defaultLabel = ui.securityRefresh.textContent || 'Actualizar seguridad';
    }
    on(ui.securityRefresh, 'click', async (event) => {
      event.preventDefault();
      await loadSecuritySummary({ force: true });
    });
  }
}

function setSecurityLoading(isLoading) {
  securityState.loading = Boolean(isLoading);
  if (ui.securitySummary) ui.securitySummary.setAttribute('aria-busy', securityState.loading ? 'true' : 'false');
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    ui.securityRefresh.disabled = securityState.loading;
    if (securityState.loading) {
      ui.securityRefresh.textContent = 'Actualizando...';
    } else {
      const label = ui.securityRefresh.dataset.defaultLabel || 'Actualizar seguridad';
      ui.securityRefresh.textContent = label;
    }
  }
}

function formatSecurityDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Number.isFinite(diffMs) && diffMs >= 0) {
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'Hace instantes';
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `Hace ${diffDays} día${diffDays === 1 ? '' : 's'}`;
  }
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeSecurityLastLogin(entry) {
  if (!entry) return 'Sin registros de inicio de sesión reciente.';
  const formatted = formatSecurityDate(entry.at);
  const absolute = entry.at
    ? new Date(entry.at).toLocaleString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const relativeLabel = formatted || absolute;
  const parts = [];
  if (relativeLabel) parts.push(relativeLabel);
  if (absolute && formatted && formatted !== absolute) parts.push(`(${absolute})`);
  if (entry.ip) parts.push(`IP: ${entry.ip}`);
  return parts.length ? parts.join(' · ') : 'Sin registros de inicio de sesión reciente.';
}

function describeSecurityAttempts(summary) {
  const count = Number(summary?.count ?? 0);
  if (!count) return 'Sin intentos recientes.';
  const windowHours = Number(summary?.window_hours ?? 24);
  const countLabel = `${formatNumber(count)} intento${count === 1 ? '' : 's'} fallido${count === 1 ? '' : 's'}`;
  const windowLabel = windowHours > 0 ? `en las últimas ${windowHours} h` : '';
  const lastLabel = formatSecurityDate(summary?.last_at);
  return [countLabel, windowLabel, lastLabel ? `Último: ${lastLabel}` : null]
    .filter(Boolean)
    .join(' · ');
}

function describeSecurityLockouts(summary) {
  const count = Number(summary?.count ?? 0);
  if (!count) return 'Sin bloqueos recientes.';
  const windowDays = Number(summary?.window_days ?? 90);
  const countLabel = `${formatNumber(count)} bloqueo${count === 1 ? '' : 's'}`;
  const windowLabel = windowDays > 0 ? `en los últimos ${windowDays} días` : '';
  const lastLabel = formatSecurityDate(summary?.last_at);
  return [countLabel, windowLabel, lastLabel ? `Último: ${lastLabel}` : null]
    .filter(Boolean)
    .join(' · ');
}

function describeSecuritySessions(value) {
  const active = Number(value ?? 0);
  if (Number.isFinite(active) && active > 0) {
    return `${formatNumber(active)} sesión${active === 1 ? '' : 'es'} activa${active === 1 ? '' : 's'}`;
  }
  return '1 sesión activa (esta sesión)';
}

function renderSecurityRecommendations(recommendations) {
  if (!ui.securityRecommendations) return;
  ui.securityRecommendations.replaceChildren();
  const items = Array.isArray(recommendations) ? recommendations.filter(Boolean) : [];
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin recomendaciones adicionales.';
    ui.securityRecommendations.appendChild(li);
    return;
  }
  items.forEach((tip) => {
    const li = document.createElement('li');
    li.textContent = tip;
    ui.securityRecommendations.appendChild(li);
  });
}

function renderSecuritySummary(summary) {
  securityState.last = summary || null;
  securityState.fetched = Boolean(summary);
  securityState.error = null;
  if (!summary) {
    if (ui.securityLastLogin) ui.securityLastLogin.textContent = 'Sin registros.';
    if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = 'Sin intentos recientes.';
    if (ui.securityLockouts) ui.securityLockouts.textContent = 'Sin bloqueos recientes.';
    if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = '1 sesión activa (esta sesión)';
    renderSecurityRecommendations([]);
    return;
  }

  if (ui.securityLastLogin) ui.securityLastLogin.textContent = describeSecurityLastLogin(summary.last_login);
  if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = describeSecurityAttempts(summary.failed_attempts);
  if (ui.securityLockouts) ui.securityLockouts.textContent = describeSecurityLockouts(summary.lockouts);
  if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = describeSecuritySessions(summary.active_sessions);
  renderSecurityRecommendations(summary.recommendations);
}

async function loadSecuritySummary(options = {}) {
  const { force = false } = options;
  if (!ui.securityCard) return;
  if (securityState.loading) return;
  if (securityState.fetched && !force) return;

  setSecurityLoading(true);
  try {
    const res = await requestWithAuth('/api/account/security/summary');
    if (!res) return;
    if (!res.ok) {
      renderSecuritySummary(null);
      securityState.error = true;
      toast?.error?.('No se pudo cargar el resumen de seguridad.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    renderSecuritySummary(data || null);
  } catch (error) {
    console.error('[account] Error al cargar resumen de seguridad', error);
    renderSecuritySummary(null);
    securityState.error = true;
    toast?.error?.('No se pudo cargar el resumen de seguridad.');
  } finally {
    setSecurityLoading(false);
  }
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
  ui.adminPanel.dataset.roleAvailable = 'true';
  const hiddenByLayout = isDashboardPanelHidden('admin');
  ui.adminPanel.hidden = hiddenByLayout;
  if (hiddenByLayout) {
    ui.adminPanel.setAttribute('aria-hidden', 'true');
  } else {
    ui.adminPanel.removeAttribute('aria-hidden');
  }
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
  ui.developmentPanel.dataset.roleAvailable = 'true';
  const hiddenByLayout = isDashboardPanelHidden('development');
  ui.developmentPanel.hidden = hiddenByLayout;
  if (hiddenByLayout) {
    ui.developmentPanel.setAttribute('aria-hidden', 'true');
  } else {
    ui.developmentPanel.removeAttribute('aria-hidden');
  }
  if (!developmentState.bound) {
    bindDevelopmentPanel();
    developmentState.bound = true;
  }
  ensureOpsPaginationBindings();
  ensureOpsSubscription();
  developmentState.opsPage = 1;
  loadDevelopmentAdmins();
  loadDevelopmentRequests();
  loadOperationsSummary({ page: 1 });
}

function setOpsLoading(isLoading) {
  developmentState.opsLoading = Boolean(isLoading);
  if (ui.opsEventsList) {
    ui.opsEventsList.setAttribute('aria-busy', developmentState.opsLoading ? 'true' : 'false');
  }
  if (developmentState.opsLoading && ui.opsEventsPagination) {
    ui.opsEventsPagination.hidden = true;
  }
}

function showOpsPlaceholder(message) {
  if (!ui.opsEventsList) return;
  ui.opsEventsList.innerHTML = '';
  const placeholder = document.createElement('li');
  placeholder.className = 'ops-events__item ops-events__item--placeholder';
  placeholder.textContent = message || 'Cargando...';
  ui.opsEventsList.appendChild(placeholder);
  if (ui.opsEventsEmpty) ui.opsEventsEmpty.hidden = true;
}

function formatOpsTimestamp(value) {
  if (!value) return { label: '—', iso: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: '—', iso: '' };
  }
  return { label: dateTimeFormatter.format(date), iso: date.toISOString() };
}

function normalizeOpsEvent(event) {
  if (!event) return null;
  const id = event.id || event.uuid;
  if (!id) return null;
  const normalized = {
    id: String(id),
    action: event.action || '',
    created_at: event.created_at || event.at || null,
    ip_address: event.ip_address || '',
    details: typeof event.details === 'object' && event.details !== null ? { ...event.details } : {},
    user: null,
    target: null,
  };
  if (event.user) {
    normalized.user = {
      id: event.user.id ? String(event.user.id) : undefined,
      email: event.user.email || '',
      name: event.user.name || '',
    };
  }
  if (event.target) {
    normalized.target = {
      type: event.target.type || '',
      id: event.target.id ? String(event.target.id) : null,
    };
  }
  return normalized;
}

function ensureOpsPaginationBindings() {
  if (developmentState.opsPaginationBound) return;
  if (ui.opsEventsPrev instanceof HTMLButtonElement) {
    on(ui.opsEventsPrev, 'click', (event) => {
      event.preventDefault();
      if (!developmentState.opsHasPrev || developmentState.opsLoading) return;
      const nextPage = Math.max(1, (developmentState.opsPage || 1) - 1);
      loadOperationsSummary({ page: nextPage });
    });
  }
  if (ui.opsEventsNext instanceof HTMLButtonElement) {
    on(ui.opsEventsNext, 'click', (event) => {
      event.preventDefault();
      if (!developmentState.opsHasNext || developmentState.opsLoading) return;
      const nextPage = (developmentState.opsPage || 1) + 1;
      loadOperationsSummary({ page: nextPage });
    });
  }
  developmentState.opsPaginationBound = true;
}

function updateOpsPagination(meta = {}) {
  if (!ui.opsEventsPagination) return;
  const total = Number.isFinite(meta.total) ? Number(meta.total) : Number(developmentState.opsTotal || 0);
  const pageSize = Number.isFinite(meta.page_size) ? Number(meta.page_size) : Number(developmentState.opsPageSize || 20);
  const page = Number.isFinite(meta.page) ? Number(meta.page) : Number(developmentState.opsPage || 1);
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  developmentState.opsHasPrev = page > 1;
  developmentState.opsHasNext = totalPages > 1 && page < totalPages;

  if (ui.opsEventsPrev instanceof HTMLButtonElement) {
    ui.opsEventsPrev.disabled = developmentState.opsLoading || !developmentState.opsHasPrev;
  }
  if (ui.opsEventsNext instanceof HTMLButtonElement) {
    ui.opsEventsNext.disabled = developmentState.opsLoading || !developmentState.opsHasNext;
  }
  if (ui.opsEventsPageInfo) {
    ui.opsEventsPageInfo.textContent = total > 0 ? `Página ${page} de ${totalPages}` : 'Sin registros';
  }

  ui.opsEventsPagination.hidden = total <= pageSize || totalPages <= 1;
}

function renderOpsBackup(backup) {
  if (ui.opsBackupStatus) {
    if (backup && backup.created_at) {
      const { label } = formatOpsTimestamp(backup.created_at);
      ui.opsBackupStatus.textContent = `Último backup: ${label}`;
    } else {
      ui.opsBackupStatus.textContent = 'Último backup: sin registros';
    }
  }
  if (ui.opsBackupMeta) {
    if (backup && (backup.filename || backup.engine)) {
      const parts = [];
      if (backup.filename) parts.push(backup.filename);
      if (backup.engine) parts.push(backup.engine);
      ui.opsBackupMeta.textContent = parts.join(' · ');
    } else {
      ui.opsBackupMeta.textContent = '';
    }
  }
}

function renderOpsEvents(events) {
  if (!ui.opsEventsList) return;
  ui.opsEventsList.innerHTML = '';
  const source = Array.isArray(events) ? events : [];
  const hasEvents = source.length > 0;
  if (ui.opsEventsEmpty) {
    ui.opsEventsEmpty.hidden = hasEvents;
    if (!hasEvents) {
      ui.opsEventsEmpty.textContent = developmentState.opsLoading ? 'Cargando eventos...' : 'No hay eventos recientes.';
    }
  }
  if (!hasEvents) return;

  source.forEach((raw) => {
    const event = normalizeOpsEvent(raw);
    if (!event) return;
    const item = document.createElement('li');
    item.className = 'ops-events__item';
    item.dataset.action = event.action;

    const top = document.createElement('div');
    top.className = 'ops-events__top';

    const action = document.createElement('span');
    action.className = 'ops-events__action';
    action.textContent = OPS_EVENT_LABELS[event.action] || event.action || 'Evento';
    top.appendChild(action);

    const time = document.createElement('time');
    time.className = 'ops-events__time';
    const { label, iso } = formatOpsTimestamp(event.created_at);
    time.textContent = label;
    if (iso) time.dateTime = iso;
    top.appendChild(time);

    const meta = document.createElement('div');
    meta.className = 'ops-events__meta';
    const actor = event.user?.email || event.user?.name || 'Sistema';
    const ip = event.ip_address ? `IP: ${event.ip_address}` : '';
    meta.textContent = [actor, ip].filter(Boolean).join(' · ');

    item.appendChild(top);
    item.appendChild(meta);

    const detailText = describeOpsEventDetails(event);
    if (detailText) {
      const detail = document.createElement('div');
      detail.className = 'ops-events__detail';
      detail.textContent = detailText;
      item.appendChild(detail);
    }

    ui.opsEventsList.appendChild(item);
  });
}

function renderOpsSummary(summary) {
  renderOpsBackup(summary?.backup);
  const events = Array.isArray(summary?.events) ? summary.events : [];
  developmentState.opsEvents = events.map((event) => normalizeOpsEvent(event)).filter(Boolean);
  const meta = summary?.meta || {};
  developmentState.opsTotal = Number.isFinite(meta.total) ? Number(meta.total) : developmentState.opsEvents.length;
  developmentState.opsPage = Number.isFinite(meta.page) ? Number(meta.page) : developmentState.opsPage || 1;
  developmentState.opsPageSize = Number.isFinite(meta.page_size) ? Number(meta.page_size) : developmentState.opsPageSize || 20;
  updateOpsPagination({
    total: developmentState.opsTotal,
    page: developmentState.opsPage,
    page_size: developmentState.opsPageSize,
  });
  renderOpsEvents(developmentState.opsEvents);
  developmentState.opsNeedsRefresh = false;
}

function loadOperationsSummary(options = {}) {
  if (!ui.opsBackupStatus && !ui.opsEventsList) return;
  const page = options.page != null ? Math.max(1, Number(options.page) || 1) : developmentState.opsPage || 1;
  const pageSize = Math.max(5, Number(developmentState.opsPageSize || 20));

  developmentState.opsPage = page;
  developmentState.opsPageSize = pageSize;

  setOpsLoading(true);
  showOpsPlaceholder('Cargando eventos...');
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));

  return requestWithAuth(`/api/admin/ops/summary?${params.toString()}`)
    .then(async (res) => {
      if (!res) {
        showOpsPlaceholder('No se pudo obtener el resumen.');
        return;
      }
      if (res.status === 403) {
        if (ui.opsBackupStatus) ui.opsBackupStatus.textContent = 'Sin permisos para consultar.';
        developmentState.opsEvents = [];
        developmentState.opsTotal = 0;
        updateOpsPagination({ total: 0, page: 1, page_size: pageSize });
        if (ui.opsEventsList) ui.opsEventsList.innerHTML = '';
        if (ui.opsEventsEmpty) {
          ui.opsEventsEmpty.hidden = false;
          ui.opsEventsEmpty.textContent = 'Sin permisos para consultar eventos.';
        }
        return;
      }
      if (!res.ok) {
        const errorMessage = 'No se pudo cargar la actividad operativa.';
        showOpsPlaceholder(errorMessage);
        if (ui.opsEventsEmpty) {
          ui.opsEventsEmpty.hidden = false;
          ui.opsEventsEmpty.textContent = errorMessage;
        }
        return;
      }
      const data = await res.json().catch(() => ({}));
      renderOpsSummary(data);
    })
    .catch(() => {
      showOpsPlaceholder('No se pudo obtener el resumen.');
    })
    .finally(() => setOpsLoading(false));
}

function ensureOpsSubscription() {
  if (!eventStream || developmentState.opsUnsubscribe) return;
  developmentState.opsUnsubscribe = eventStream.subscribeChannel('ops', (payload) => {
    const event = payload?.data?.event;
    if (!event) return;
    handleOpsNewEvent(event);
  });
  eventStream.ensure?.();
}

function handleOpsNewEvent(rawEvent) {
  const event = normalizeOpsEvent(rawEvent);
  if (!event) return;
  const exists = developmentState.opsEvents.some((item) => item.id === event.id);
  if (exists) return;

  developmentState.opsTotal = (developmentState.opsTotal || 0) + 1;

  if (developmentState.opsPage === 1) {
    developmentState.opsEvents = [event, ...developmentState.opsEvents];
    if (developmentState.opsEvents.length > developmentState.opsPageSize) {
      developmentState.opsEvents = developmentState.opsEvents.slice(0, developmentState.opsPageSize);
    }
    renderOpsEvents(developmentState.opsEvents);
  } else if (!developmentState.opsNeedsRefresh) {
    developmentState.opsNeedsRefresh = true;
    toast?.info?.('Hay nuevos eventos operativos. Regresa a la primera página para verlos.');
  }

  updateOpsPagination({
    total: developmentState.opsTotal,
    page: developmentState.opsPage,
    page_size: developmentState.opsPageSize,
  });
}

function clearOpsSubscription() {
  if (typeof developmentState.opsUnsubscribe === 'function') {
    developmentState.opsUnsubscribe();
  }
  developmentState.opsUnsubscribe = null;
}

function describeOpsEventDetails(event) {
  const details = event?.details || {};
  switch (event?.action) {
    case 'auth.login.failed':
      return `Intentos fallidos acumulados: ${details.failed_attempts ?? 'N/D'}${details.locked ? '. Cuenta bloqueada.' : ''}`;
    case 'auth.account.locked':
      return 'La cuenta fue bloqueada por intentos fallidos.';
    case 'auth.login.succeeded':
      return details.used_backup_code ? 'Inicio de sesión con código de respaldo.' : 'Inicio de sesión con credenciales.';
    case 'role.admin.assigned':
      return details.target_public_id ? `Asignado a ID público ${details.target_public_id}.` : 'Rol admin asignado.';
    case 'role.admin.removed':
      return details.remaining_admins != null ? `Administradores restantes: ${details.remaining_admins}.` : 'Rol admin eliminado.';
    case 'security.2fa.enabled': {
      const issued = Number.isFinite(details.backup_codes_issued) ? Number(details.backup_codes_issued) : null;
      return issued != null ? `Códigos de respaldo emitidos: ${issued}.` : '2FA activada.';
    }
    case 'security.2fa.disabled':
      return '2FA desactivada por el usuario.';
    case 'security.2fa.backup_regenerated': {
      const count = Number.isFinite(details.count) ? Number(details.count) : null;
      return count != null ? `Se generaron ${count} códigos nuevos.` : 'Códigos de respaldo regenerados.';
    }
    case 'ops.backup.created': {
      const filename = details.filename ? `Archivo: ${details.filename}` : '';
      const engine = details.engine ? `Motor: ${details.engine}` : '';
      return [filename, engine].filter(Boolean).join(' · ') || 'Backup ejecutado.';
    }
    default:
      return '';
  }
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
  if (ui.developmentAdminList) {
    on(ui.developmentAdminList, 'click', onDevelopmentAdminListClick);
  }
  if (ui.developmentRemoveModal) {
    on(ui.developmentRemoveModal, 'click', onDevelopmentRemoveModalClick);
  }
  if (ui.developmentRemoveCancel) {
    on(ui.developmentRemoveCancel, 'click', (event) => {
      event.preventDefault();
      closeDevelopmentRemoveModal();
    });
  }
  if (ui.developmentRemoveConfirm) {
    on(ui.developmentRemoveConfirm, 'click', onDevelopmentRemoveConfirm);
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
  await loadDevelopmentAdmins();
  await loadDevelopmentRequests();
}

async function loadDevelopmentAdmins() {
  if (!ui.developmentAdminList) return;

  developmentState.adminsLoading = true;
  if (ui.developmentAdminEmpty) ui.developmentAdminEmpty.hidden = true;
  ui.developmentAdminList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando administradores...';
  ui.developmentAdminList.appendChild(loading);

  const res = await requestWithAuth('/api/development/admins');
  developmentState.adminsLoading = false;

  if (!res) {
    developmentState.admins = [];
    developmentState.adminsTotal = 0;
    ui.developmentAdminList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar los administradores.';
    ui.developmentAdminList.appendChild(errorMsg);
    return;
  }

  if (res.status === 403) {
    developmentState.admins = [];
    developmentState.adminsTotal = 0;
    ui.developmentAdminList.innerHTML = '';
    const info = document.createElement('p');
    info.className = 'role-panel__empty';
    info.textContent = 'Esta sección es exclusiva para el equipo de desarrollo.';
    ui.developmentAdminList.appendChild(info);
    return;
  }

  if (res.status === 204) {
    developmentState.admins = [];
    developmentState.adminsTotal = 0;
    renderDevelopmentAdmins([], 0);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo cargar el listado de administradores.');
    developmentState.admins = [];
    developmentState.adminsTotal = 0;
    ui.developmentAdminList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Se produjo un error al consultar los administradores.';
    ui.developmentAdminList.appendChild(errorMsg);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const admins = Array.isArray(data?.admins) ? data.admins : [];
  const totalRaw = Number(data?.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : admins.length;
  developmentState.admins = admins;
  developmentState.adminsTotal = total;
  renderDevelopmentAdmins(admins, total);
}

function renderDevelopmentAdmins(admins, total = Array.isArray(admins) ? admins.length : 0) {
  if (!ui.developmentAdminList) return;
  ui.developmentAdminList.innerHTML = '';

  const count = Array.isArray(admins) ? admins.length : 0;
  if (count === 0) {
    if (ui.developmentAdminEmpty) ui.developmentAdminEmpty.hidden = false;
    return;
  }

  if (ui.developmentAdminEmpty) ui.developmentAdminEmpty.hidden = true;

  const totalAdmins = Number.isFinite(total) ? total : count;

  admins.forEach((admin) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';

    const header = document.createElement('div');
    header.className = 'role-panel__bar';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'role-panel__header-main';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = admin?.name || admin?.email || 'Usuario';

    const badge = document.createElement('span');
    badge.className = 'role-panel__pill';
    badge.textContent = 'Admin activo';

    titleWrap.appendChild(title);
    titleWrap.appendChild(badge);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--ghost btn--sm';
    removeBtn.dataset.removeAdmin = 'true';
    removeBtn.dataset.userId = admin?.id || '';
    removeBtn.dataset.userName = admin?.name || '';
    removeBtn.dataset.userEmail = admin?.email || '';
    removeBtn.dataset.userPublicId = admin?.public_id || '';
    removeBtn.textContent = 'Quitar rol';

    const isRemovable = totalAdmins > 1 && !!(admin?.removable ?? true);
    if (!isRemovable) {
      removeBtn.disabled = true;
      removeBtn.title = 'Mantén al menos un administrador activo.';
      removeBtn.textContent = 'No disponible';
    }

    header.appendChild(titleWrap);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const emailMeta = document.createElement('p');
    emailMeta.className = 'role-panel__meta';
    emailMeta.textContent = admin?.email || 'Correo no registrado';
    card.appendChild(emailMeta);

  const detailMeta = document.createElement('p');
  detailMeta.className = 'role-panel__meta role-panel__meta--muted';
  const uuidLabel = admin?.id ? `UUID: ${admin.id}` : 'UUID: N/D';
  const publicLabel = admin?.public_id ? `ID: ${admin.public_id}` : 'ID: N/D';
  detailMeta.textContent = `${uuidLabel} | ${publicLabel}`;
    card.appendChild(detailMeta);

    if (Array.isArray(admin?.roles) && admin.roles.length) {
      const rolesMeta = document.createElement('p');
      rolesMeta.className = 'role-panel__meta role-panel__meta--muted';
      rolesMeta.textContent = `Roles: ${admin.roles.join(', ')}`;
      card.appendChild(rolesMeta);
    }

    if (admin?.is_self) {
      const selfMeta = document.createElement('p');
      selfMeta.className = 'role-panel__meta role-panel__meta--muted';
      selfMeta.textContent = 'Esta es tu cuenta actual.';
      card.appendChild(selfMeta);
    }

    if (!isRemovable) {
      const warning = document.createElement('p');
      warning.className = 'role-panel__meta role-panel__meta--muted';
      warning.textContent = 'No es posible quitar el rol al último administrador.';
      card.appendChild(warning);
    }

    ui.developmentAdminList.appendChild(card);
  });
}

function onDevelopmentAdminListClick(event) {
  const trigger = event.target instanceof Element ? event.target.closest('[data-remove-admin]') : null;
  if (!trigger) return;
  if (trigger instanceof HTMLButtonElement && trigger.disabled) return;
  event.preventDefault();

  const admin = {
    id: trigger.dataset.userId || '',
    name: trigger.dataset.userName || '',
    email: trigger.dataset.userEmail || '',
    publicId: trigger.dataset.userPublicId || '',
  };

  openDevelopmentRemoveModal(admin);
}

function openDevelopmentRemoveModal(admin) {
  if (!admin || !admin.id) return;
  developmentRemovalState.target = admin;
  developmentRemovalState.loading = false;

  if (ui.developmentRemoveMessage) {
    const parts = [];
    if (admin.name) parts.push(admin.name);
    if (admin.email) parts.push(`(${admin.email})`);
    const label = parts.length ? parts.join(' ') : 'este usuario';
    const idLabel = admin.publicId ? `ID público: ${admin.publicId}.` : '';
    ui.developmentRemoveMessage.textContent = `Vas a quitar el rol administrador de ${label}. ${idLabel}`.trim();
  }

  if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
    ui.developmentRemoveConfirm.disabled = false;
    ui.developmentRemoveConfirm.textContent = 'Quitar rol';
  }

  openModal(ui.developmentRemoveModal);
}

function closeDevelopmentRemoveModal() {
  if (developmentRemovalState.loading) return;
  developmentRemovalState.target = null;
  if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
    ui.developmentRemoveConfirm.disabled = false;
    ui.developmentRemoveConfirm.textContent = 'Quitar rol';
  }
  closeModal(ui.developmentRemoveModal);
}

function onDevelopmentRemoveModalClick(event) {
  const closeTrigger = event.target instanceof Element ? event.target.closest('[data-modal-close]') : null;
  if (!closeTrigger) return;
  event.preventDefault();
  closeDevelopmentRemoveModal();
}

function onDevelopmentRemoveConfirm(event) {
  event.preventDefault();
  handleDevelopmentRemoveAdmin();
}

async function handleDevelopmentRemoveAdmin() {
  if (developmentRemovalState.loading) return;
  const target = developmentRemovalState.target;
  if (!target || !target.id) {
    closeDevelopmentRemoveModal();
    return;
  }

  if (!(ui.developmentRemoveConfirm instanceof HTMLButtonElement)) return;

  const originalLabel = ui.developmentRemoveConfirm.textContent;
  ui.developmentRemoveConfirm.disabled = true;
  ui.developmentRemoveConfirm.textContent = 'Quitando...';
  developmentRemovalState.loading = true;

  const res = await requestWithAuth(`/api/development/users/${encodeURIComponent(target.id)}/roles/admin`, {
    method: 'DELETE',
  });

  if (!res) {
    developmentRemovalState.loading = false;
    if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
      ui.developmentRemoveConfirm.disabled = false;
      ui.developmentRemoveConfirm.textContent = originalLabel || 'Quitar rol';
    }
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo quitar el rol admin.');
    developmentRemovalState.loading = false;
    if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
      ui.developmentRemoveConfirm.disabled = false;
      ui.developmentRemoveConfirm.textContent = originalLabel || 'Quitar rol';
    }
    return;
  }

  const data = await res.json().catch(() => ({}));
  toast?.success?.(data?.message || 'Rol admin removido.');

  developmentRemovalState.loading = false;
  if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
    ui.developmentRemoveConfirm.disabled = false;
    ui.developmentRemoveConfirm.textContent = originalLabel || 'Quitar rol';
  }

  closeDevelopmentRemoveModal();
  await loadDevelopmentAdmins();
  await loadDevelopmentRequests();

  const currentUser = getCurrentUser();
  if (currentUser && currentUser.id === target.id) {
    const { user, status } = await refreshCurrentUser();
    if (user) renderAccountDetails(user);
    else if (status === 401) handleUnauthorized(false);
  }
}

function onDevelopmentCreateBackup() {
  handleDevelopmentCreateBackup();
}

async function handleDevelopmentCreateBackup() {
  const desiredName = ui.developmentBackupName instanceof HTMLInputElement ? ui.developmentBackupName.value.trim() : '';
  const options = { method: 'POST' };
  if (desiredName) options.body = JSON.stringify({ backup_name: desiredName });

  if (ui.developmentBackupBtn instanceof HTMLButtonElement) {
    ui.developmentBackupBtn.disabled = true;
    ui.developmentBackupBtn.textContent = 'Ejecutando…';
  }

  const res = await requestWithAuth('/api/development/backups/run', options);
  if (ui.developmentBackupBtn instanceof HTMLButtonElement) {
    ui.developmentBackupBtn.disabled = false;
    ui.developmentBackupBtn.textContent = 'Ejecutar backup';
  }
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
  if (ui.developmentBackupName instanceof HTMLInputElement) ui.developmentBackupName.value = '';
  developmentState.opsPage = 1;
  await loadOperationsSummary({ page: 1 });
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
  clearOpsSubscription();
  clearLearningSubscription();
  resetLearningProgressUI();
  setAuthVisibility(false);
  accountState.user = null;
  accountState.roles = new Set();
  dashboardState.key = null;
  dashboardState.layout = getDefaultDashboardLayout();
  updateDashboardButtonState();
  applyDashboardLayout();
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
  if (ui.historyOrder instanceof HTMLSelectElement) {
    on(ui.historyOrder, 'change', handleHistoryOrderChange);
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

  if (ui.historyList && !historyState.listActionsBound) {
    historyState.listActionsBound = true;
    on(ui.historyList, 'click', handleHistoryListClick);
  }
}

function parseTagsInput(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function syncHistoryFormInputs() {
  if (ui.historySearch instanceof HTMLInputElement && ui.historySearch.value !== historyState.q) {
    ui.historySearch.value = historyState.q;
  }
  if (ui.historyFrom instanceof HTMLInputElement && ui.historyFrom.value !== historyState.from) {
    ui.historyFrom.value = historyState.from;
  }
  if (ui.historyTo instanceof HTMLInputElement && ui.historyTo.value !== historyState.to) {
    ui.historyTo.value = historyState.to;
  }
  if (ui.historyTags instanceof HTMLInputElement) {
    const current = historyState.tags.join(', ');
    if (ui.historyTags.value !== current) ui.historyTags.value = current;
  }
  if (ui.historyOrder instanceof HTMLSelectElement) {
    const desired = historyState.order || 'desc';
    if (ui.historyOrder.value !== desired) ui.historyOrder.value = desired;
  }
}

function formatNumber(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return numberFormatter.format(num);
}

function buildHistoryParams() {
  return historyStore.buildQueryParams();
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

function handleHistorySnapshot(snapshot) {
  const filters = snapshot.filters || {};
  const meta = snapshot.meta || {};

  historyState.page = Number(filters.page ?? historyState.page ?? 1) || 1;
  historyState.pageSize = Number(filters.pageSize ?? historyState.pageSize ?? 10) || 10;
  historyState.q = filters.q || '';
  historyState.from = filters.from || '';
  historyState.to = filters.to || '';
  historyState.tags = Array.isArray(filters.tags) ? [...filters.tags] : [];
  historyState.order = filters.order || 'desc';
  const totalFromMeta = Number(meta.total ?? meta.count);
  if (Number.isFinite(totalFromMeta) && totalFromMeta >= 0) {
    historyState.total = totalFromMeta;
  } else if (Array.isArray(snapshot.items)) {
    historyState.total = snapshot.items.length;
  }

  const totalPagesFromMeta = Number(meta.totalPages ?? meta.total_pages);
  if (Number.isFinite(totalPagesFromMeta) && totalPagesFromMeta >= 0) {
    historyState.totalPages = totalPagesFromMeta;
  }

  setHistoryLoading(snapshot.loading);

  if (snapshot.error) {
    const message = describeHistoryError(snapshot.error);
    showHistoryError(message);
  } else {
    clearHistoryError();
  }

  historyState.items = Array.isArray(snapshot.items)
    ? snapshot.items.map((item) => ({ ...item, tags: Array.isArray(item?.tags) ? [...item.tags] : [] }))
    : [];
  if (!snapshot.loading) historyState.initialized = true;
  const validIds = new Set(historyState.items.map((item) => String(item?.id ?? '')));
  Array.from(historyState.pendingDeletes).forEach((id) => {
    if (!validIds.has(id)) {
      historyState.pendingDeletes.delete(id);
    }
  });

  renderHistoryItems(historyState.items);
  updateHistoryPagination({
    total: historyState.total,
    total_pages: historyState.totalPages,
    page: historyState.page,
    page_size: historyState.pageSize,
  });

  if (ui.historyCount) {
    if (Number.isFinite(historyState.total) && historyState.total > 0) {
      ui.historyCount.textContent = historyState.total === 1 ? '1 registro' : `${historyState.total} registros`;
    } else {
      const count = historyState.items.length;
      ui.historyCount.textContent = count === 1 ? '1 registro' : `${count} registros`;
    }
  }

  syncHistoryFormInputs();
}

function describeHistoryError(code) {
  if (!code) return '';
  if (typeof code === 'string') {
    if (code.startsWith('history:')) return 'No se pudo cargar el historial.';
    if (code === 'network') return 'Error de red al cargar el historial.';
    if (code === 'no-auth-fetch' || code === 'no-auth') return 'Inicia sesión para ver el historial.';
  }
  return typeof code === 'string' ? code : 'Error al cargar el historial.';
}

function handleNotificationsSnapshot(snapshot = {}) {
  notificationsState.bound = true;
  const filters = snapshot.filters || {};
  const meta = snapshot.meta || {};

  const pageFromFilters = Number(filters.page ?? meta.page ?? notificationsState.page ?? 1);
  notificationsState.page = Number.isFinite(pageFromFilters) && pageFromFilters > 0 ? pageFromFilters : 1;
  const totalPagesFromMeta = Number(meta.total_pages ?? meta.totalPages ?? notificationsState.totalPages ?? 0);
  notificationsState.totalPages = Number.isFinite(totalPagesFromMeta) && totalPagesFromMeta >= 0 ? totalPagesFromMeta : 0;

  if (filters.includeRead !== undefined) {
    notificationsState.includeRead = Boolean(filters.includeRead);
  } else if (filters.include_read !== undefined) {
    notificationsState.includeRead = Boolean(filters.include_read);
  }

  notificationsState.category = typeof filters.category === 'string' ? filters.category : '';
  notificationsState.loading = Boolean(snapshot.loading);
  notificationsState.error = snapshot.error || null;
  notificationsState.unread = Number(meta.unread ?? meta.unread_count ?? meta.total_unread ?? snapshot.unread ?? notificationsState.unread ?? 0) || 0;
  notificationsState.items = Array.isArray(snapshot.items) ? snapshot.items.slice() : [];

  if (snapshot.preferences && typeof snapshot.preferences === 'object') {
    notificationsState.preferences = { ...snapshot.preferences };
  }
  if (snapshot.categories && typeof snapshot.categories === 'object') {
    notificationsState.categories = { ...snapshot.categories };
    renderNotificationCategories(notificationsState.categories);
  }

  if (ui.notificationsList) {
    ui.notificationsList.setAttribute('aria-busy', notificationsState.loading ? 'true' : 'false');
  }

  if (ui.notificationsUnread) {
    let message;
    if (notificationsState.loading) {
      message = 'Cargando notificaciones…';
    } else if (notificationsState.unread > 0) {
      message = notificationsState.unread === 1 ? 'Tienes 1 notificación sin leer.' : `Tienes ${notificationsState.unread} notificaciones sin leer.`;
    } else {
      message = notificationsState.includeRead ? 'No hay notificaciones para los filtros seleccionados.' : 'Estás al día. No tienes notificaciones sin leer.';
    }
    ui.notificationsUnread.textContent = message;
  }

  syncNotificationsFilters();
  renderNotificationItems(notificationsState.items);
  updateNotificationsPagination();
}

function describeNotificationsEmptyMessage() {
  if (notificationsState.loading) return 'Cargando notificaciones…';
  if (notificationsState.includeRead) return 'No hay notificaciones para los filtros seleccionados.';
  return 'No tienes notificaciones por ahora.';
}

function renderNotificationItems(items) {
  if (!ui.notificationsList) return;
  ui.notificationsList.replaceChildren();

  if (!Array.isArray(items) || !items.length) {
    if (ui.notificationsEmpty) {
      ui.notificationsEmpty.hidden = false;
      ui.notificationsEmpty.textContent = describeNotificationsEmptyMessage();
    }
    return;
  }

  if (ui.notificationsEmpty) ui.notificationsEmpty.hidden = true;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'notifications-item';

    const header = document.createElement('div');
    header.className = 'notifications-item__header';

    const title = document.createElement('span');
    title.className = 'notifications-item__title';
    const heading = item?.title || item?.subject || item?.type || 'Notificación';
    title.textContent = heading;
    header.appendChild(title);

    if (!item?.read && !item?.seen) {
      const badge = document.createElement('span');
      badge.className = 'notifications-item__badge';
      badge.textContent = 'Nuevo';
      header.appendChild(badge);
    }

    if (item?.created_at) {
      const timestamp = document.createElement('time');
      timestamp.className = 'notifications-item__time';
      timestamp.dateTime = item.created_at;
      const dt = new Date(item.created_at);
      timestamp.textContent = Number.isNaN(dt.getTime()) ? item.created_at : dt.toLocaleString('es-CO');
      header.appendChild(timestamp);
    }

    li.appendChild(header);

    const body = document.createElement('p');
    body.className = 'notifications-item__message';
    const message = item?.message || item?.body || item?.summary || '';
    body.textContent = message || 'Sin detalles adicionales.';
    li.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'notifications-item__meta';
    if (item?.category) {
      const category = document.createElement('span');
      category.className = 'notifications-item__category';
      category.textContent = item.category;
      meta.appendChild(category);
    }
    if (item?.actions && Array.isArray(item.actions)) {
      const actions = document.createElement('div');
      actions.className = 'notifications-item__actions';
      item.actions.forEach((action) => {
        if (!action?.label || !action?.href) return;
        const link = document.createElement('a');
        link.className = 'btn btn--ghost btn--sm';
        link.href = action.href;
        link.textContent = action.label;
        link.rel = 'noopener noreferrer';
        actions.appendChild(link);
      });
      if (actions.childElementCount) meta.appendChild(actions);
    }
    if (meta.childElementCount) li.appendChild(meta);

    ui.notificationsList.appendChild(li);
  });
}

function syncNotificationsFilters() {
  if (ui.notificationsIncludeRead instanceof HTMLInputElement) {
    ui.notificationsIncludeRead.checked = Boolean(notificationsState.includeRead);
  }
  if (ui.notificationsCategory instanceof HTMLSelectElement) {
    const desired = notificationsState.category || '';
    if (ui.notificationsCategory.value !== desired) {
      ui.notificationsCategory.value = desired;
    }
  }
}

function renderNotificationCategories(categories) {
  if (!(ui.notificationsCategory instanceof HTMLSelectElement)) return;
  const current = categories && typeof categories === 'object' ? categories : {};
  const fragment = document.createDocumentFragment();
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Todas';
  fragment.appendChild(defaultOption);

  Object.entries(current)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([key, value]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${value || key}`;
      fragment.appendChild(option);
    });

  ui.notificationsCategory.replaceChildren(fragment);
}

function updateNotificationsPagination() {
  const totalPages = notificationsState.totalPages || 0;
  const currentPage = notificationsState.page || 1;
  const hidden = totalPages <= 1 && currentPage <= 1;
  if (ui.notificationsPagination) ui.notificationsPagination.hidden = hidden;

  if (ui.notificationsPageInfo) {
    const pages = totalPages > 0 ? totalPages : 1;
    ui.notificationsPageInfo.textContent = `Página ${currentPage} de ${pages}`;
  }

  if (ui.notificationsPrev instanceof HTMLButtonElement) {
    ui.notificationsPrev.disabled = notificationsState.loading || currentPage <= 1;
  }
  if (ui.notificationsNext instanceof HTMLButtonElement) {
    const atEnd = totalPages !== 0 && currentPage >= totalPages;
    ui.notificationsNext.disabled = notificationsState.loading || atEnd;
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

function getDashboardStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('[account] No se pudo acceder a localStorage para el panel.', error);
    return null;
  }
}

function computeDashboardStorageKey(user, rolesSet) {
  const roles = rolesSet instanceof Set ? Array.from(rolesSet) : Array.from(new Set(rolesSet || []));
  const rolesKey = roles.length ? roles.sort().join('|') : 'default';
  const baseKey = user?.id != null
    ? `id:${user.id}`
    : user?.public_id
      ? `pub:${user.public_id}`
      : user?.email
        ? `mail:${user.email}`
        : 'guest';
  return `ecuplot:dashboard:${baseKey}:${rolesKey}`;
}

function normalizeDashboardLayout(input = {}) {
  const normalized = {
    order: [],
    hidden: [],
    hiddenPanels: [],
  };

  const baseKeys = Object.keys(DASHBOARD_WIDGET_META);
  const orderSource = Array.isArray(input.order) ? input.order : [];
  orderSource.forEach((key) => {
    if (!DASHBOARD_WIDGET_META[key]) return;
    if (!normalized.order.includes(key)) normalized.order.push(key);
  });
  baseKeys.forEach((key) => {
    if (!normalized.order.includes(key)) normalized.order.push(key);
  });

  const hiddenSet = new Set();
  if (Array.isArray(input.hidden)) {
    input.hidden.forEach((key) => {
      if (DASHBOARD_WIDGET_META[key]) hiddenSet.add(key);
    });
  }
  normalized.hidden = Array.from(hiddenSet);

  const panelSet = new Set();
  if (Array.isArray(input.hiddenPanels)) {
    input.hiddenPanels.forEach((key) => {
      if (DASHBOARD_ROLE_WIDGETS[key]) panelSet.add(key);
    });
  }
  normalized.hiddenPanels = Array.from(panelSet);

  return normalized;
}

function getDefaultDashboardLayout() {
  return normalizeDashboardLayout({
    order: [...DEFAULT_DASHBOARD_LAYOUT.order],
    hidden: [...DEFAULT_DASHBOARD_LAYOUT.hidden],
    hiddenPanels: [...DEFAULT_DASHBOARD_LAYOUT.hiddenPanels],
  });
}

function cloneDashboardLayout(layout) {
  if (!layout) return getDefaultDashboardLayout();
  return normalizeDashboardLayout({
    order: Array.isArray(layout.order) ? [...layout.order] : [...DEFAULT_DASHBOARD_LAYOUT.order],
    hidden: Array.isArray(layout.hidden) ? [...layout.hidden] : [...DEFAULT_DASHBOARD_LAYOUT.hidden],
    hiddenPanels: Array.isArray(layout.hiddenPanels) ? [...layout.hiddenPanels] : [...DEFAULT_DASHBOARD_LAYOUT.hiddenPanels],
  });
}

function loadDashboardLayout(key) {
  if (!key) return getDefaultDashboardLayout();
  const storage = getDashboardStorage();
  if (!storage) return getDefaultDashboardLayout();
  const raw = storage.getItem(key);
  if (!raw) return getDefaultDashboardLayout();
  try {
    const parsed = JSON.parse(raw);
    return normalizeDashboardLayout(parsed);
  } catch (error) {
    console.warn('[account] No se pudo parsear la configuración del panel.', error);
    return getDefaultDashboardLayout();
  }
}

function saveDashboardLayout(layout) {
  if (!dashboardState.key) return;
  const storage = getDashboardStorage();
  if (!storage) return;
  try {
    storage.setItem(dashboardState.key, JSON.stringify(layout));
  } catch (error) {
    console.warn('[account] No se pudo guardar la configuración del panel.', error);
  }
}

function updateDashboardButtonState() {
  const button = ui.dashboardCustomize;
  if (!button) return;
  const canCustomize = Boolean(accountState.user);
  button.disabled = !canCustomize;
  button.setAttribute('aria-disabled', canCustomize ? 'false' : 'true');
  if (!canCustomize) {
    button.title = 'Inicia sesión para personalizar tu panel.';
  } else {
    button.removeAttribute('title');
  }
}

function isDashboardPanelHidden(panelKey) {
  if (!panelKey) return false;
  const layout = dashboardState.draft || dashboardState.layout;
  if (!layout) return false;
  return Array.isArray(layout.hiddenPanels) && layout.hiddenPanels.includes(panelKey);
}

function applyDashboardLayout() {
  dashboardState.layout = normalizeDashboardLayout(dashboardState.layout);
  const container = ui.dashboardLayout;
  if (container) {
    const order = dashboardState.layout.order.slice();
    const hiddenSet = new Set(dashboardState.layout.hidden);

    order.forEach((key) => {
      const meta = DASHBOARD_WIDGET_META[key];
      if (!meta) return;
      const element = document.getElementById(meta.id);
      if (!element) return;
      container.appendChild(element);
      const shouldHide = hiddenSet.has(key);
      element.hidden = shouldHide;
      element.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
      element.dataset.dashboardHidden = shouldHide ? 'true' : 'false';
    });

    Object.keys(DASHBOARD_WIDGET_META).forEach((key) => {
      if (order.includes(key)) return;
      const meta = DASHBOARD_WIDGET_META[key];
      const element = document.getElementById(meta.id);
      if (!element) return;
      container.appendChild(element);
      const shouldHide = hiddenSet.has(key);
      element.hidden = shouldHide;
      element.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
      element.dataset.dashboardHidden = shouldHide ? 'true' : 'false';
    });
  }

  const hiddenPanels = new Set(dashboardState.layout.hiddenPanels);
  Object.entries(DASHBOARD_ROLE_WIDGETS).forEach(([key, meta]) => {
    const panel = document.getElementById(meta.id);
    if (!panel) return;
    const available = panel.dataset.roleAvailable === 'true';
    const shouldHide = hiddenPanels.has(key) || !available;
    panel.dataset.dashboardHidden = shouldHide ? 'true' : 'false';
    panel.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');
    panel.hidden = shouldHide || panel.hidden === true;
    if (!shouldHide && available) {
      panel.hidden = false;
      panel.removeAttribute('aria-hidden');
    }
  });
}

function updateDashboardContext(user, rolesSet) {
  accountState.user = user || null;
  accountState.roles = rolesSet instanceof Set ? new Set(rolesSet) : new Set(rolesSet || []);
  const key = computeDashboardStorageKey(accountState.user, accountState.roles);
  if (dashboardState.key !== key) {
    dashboardState.key = key;
    dashboardState.layout = loadDashboardLayout(key);
  } else {
    dashboardState.layout = normalizeDashboardLayout(dashboardState.layout);
  }
  updateDashboardButtonState();
  applyDashboardLayout();
}

function getAvailableDashboardWidgets() {
  const draft = dashboardState.draft || dashboardState.layout || getDefaultDashboardLayout();
  const base = draft.order
    .map((key) => ({ key, meta: DASHBOARD_WIDGET_META[key] }))
    .filter((item) => Boolean(item.meta));
  const panels = Array.from(accountState.roles)
    .map((role) => ({ role, meta: DASHBOARD_ROLE_WIDGETS[role] }))
    .filter((item, index, arr) => Boolean(item.meta) && arr.findIndex((candidate) => candidate.role === item.role) === index);
  return { base, panels };
}

function renderDashboardWidgetsList() {
  if (!ui.dashboardWidgetsList) return;
  const draft = dashboardState.draft || dashboardState.layout || getDefaultDashboardLayout();
  const hiddenBase = new Set(draft.hidden || []);
  const hiddenPanels = new Set(draft.hiddenPanels || []);
  const { base, panels } = getAvailableDashboardWidgets();

  ui.dashboardWidgetsList.replaceChildren();

  if (!base.length && !panels.length) {
    const empty = document.createElement('p');
    empty.className = 'dashboard-widgets__empty';
    empty.textContent = 'Selecciona un rol o inicia sesión para personalizar tu panel.';
    ui.dashboardWidgetsList.appendChild(empty);
    return;
  }

  if (base.length) {
    const baseGroup = document.createElement('section');
    baseGroup.className = 'dashboard-widgets__group';

    const heading = document.createElement('h3');
    heading.className = 'dashboard-widgets__heading';
    heading.textContent = 'Secciones principales';
    baseGroup.appendChild(heading);

    base.forEach(({ key, meta }, index) => {
      const row = document.createElement('div');
      row.className = 'dashboard-widget';
      row.dataset.dashboardKey = key;
      row.dataset.dashboardGroup = 'base';

      const checkboxId = `dashboard-widget-${key}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'dashboard-widget__checkbox';
      checkbox.id = checkboxId;
      checkbox.dataset.dashboardKey = key;
      checkbox.dataset.dashboardGroup = 'base';
      checkbox.checked = !hiddenBase.has(key);

      const label = document.createElement('label');
      label.className = 'dashboard-widget__label';
      label.setAttribute('for', checkboxId);
      label.textContent = meta.label;

      const controls = document.createElement('div');
      controls.className = 'dashboard-widget__controls';

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'dashboard-widget__move';
      up.dataset.dashboardMove = 'up';
      up.dataset.dashboardKey = key;
      up.textContent = 'Subir';
      up.disabled = index === 0;

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'dashboard-widget__move';
      down.dataset.dashboardMove = 'down';
      down.dataset.dashboardKey = key;
      down.textContent = 'Bajar';
      down.disabled = index === base.length - 1;

      controls.append(up, down);

      row.append(checkbox, label, controls);
      baseGroup.appendChild(row);
    });

    ui.dashboardWidgetsList.appendChild(baseGroup);
  }

  if (panels.length) {
    const panelGroup = document.createElement('section');
    panelGroup.className = 'dashboard-widgets__group';

    const heading = document.createElement('h3');
    heading.className = 'dashboard-widgets__heading';
    heading.textContent = 'Paneles por rol';
    panelGroup.appendChild(heading);

    panels.forEach(({ role, meta }) => {
      const row = document.createElement('div');
      row.className = 'dashboard-widget';
      row.dataset.dashboardKey = role;
      row.dataset.dashboardGroup = 'panel';

      const checkboxId = `dashboard-panel-${role}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'dashboard-widget__checkbox';
      checkbox.id = checkboxId;
      checkbox.dataset.dashboardKey = role;
      checkbox.dataset.dashboardGroup = 'panel';
      checkbox.checked = !hiddenPanels.has(role);

      const label = document.createElement('label');
      label.className = 'dashboard-widget__label';
      label.setAttribute('for', checkboxId);
      label.textContent = meta.label;

      row.append(checkbox, label);
      panelGroup.appendChild(row);
    });

    ui.dashboardWidgetsList.appendChild(panelGroup);
  }
}

function openDashboardModal() {
  if (!ui.dashboardModal) return;
  if (!accountState.user) {
    toast?.info?.('Inicia sesión para personalizar tu panel.');
    return;
  }
  dashboardState.draft = cloneDashboardLayout(dashboardState.layout);
  renderDashboardWidgetsList();
  openModal(ui.dashboardModal);
}

function closeDashboardModal() {
  if (!ui.dashboardModal) return;
  dashboardState.draft = null;
  closeModal(ui.dashboardModal);
}

function handleDashboardWidgetsChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'checkbox') return;
  const key = target.dataset.dashboardKey;
  const group = target.dataset.dashboardGroup || 'base';
  if (!key || !dashboardState.draft) return;

  if (group === 'panel') {
    const hiddenPanels = new Set(dashboardState.draft.hiddenPanels || []);
    if (target.checked) {
      hiddenPanels.delete(key);
    } else {
      hiddenPanels.add(key);
    }
    dashboardState.draft.hiddenPanels = Array.from(hiddenPanels);
  } else {
    const hidden = new Set(dashboardState.draft.hidden || []);
    if (target.checked) {
      hidden.delete(key);
    } else {
      hidden.add(key);
    }
    dashboardState.draft.hidden = Array.from(hidden);
  }
}

function handleDashboardWidgetsClick(event) {
  const control = event.target instanceof Element ? event.target.closest('[data-dashboard-move]') : null;
  if (!control || !dashboardState.draft) return;
  event.preventDefault();
  const key = control.dataset.dashboardKey;
  const direction = control.dataset.dashboardMove;
  if (!key || !direction) return;
  const order = Array.isArray(dashboardState.draft.order) ? [...dashboardState.draft.order] : [];
  const index = order.indexOf(key);
  if (index === -1) return;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return;
  order.splice(index, 1);
  order.splice(targetIndex, 0, key);
  dashboardState.draft.order = order;
  renderDashboardWidgetsList();
}

function handleDashboardSave(event) {
  event.preventDefault();
  if (!dashboardState.draft) {
    closeDashboardModal();
    return;
  }
  dashboardState.layout = normalizeDashboardLayout(dashboardState.draft);
  saveDashboardLayout(dashboardState.layout);
  dashboardState.draft = null;
  applyDashboardLayout();
  closeDashboardModal();
  toast?.success?.('Panel actualizado.');
}

function bindDashboardCustomization() {
  if (dashboardState.bound) return;
  dashboardState.bound = true;

  if (ui.dashboardCustomize) {
    on(ui.dashboardCustomize, 'click', (event) => {
      event.preventDefault();
      openDashboardModal();
    });
  }

  if (ui.dashboardSave instanceof HTMLButtonElement) {
    on(ui.dashboardSave, 'click', handleDashboardSave);
  }

  ui.dashboardCancelButtons?.forEach((button) => {
    on(button, 'click', (event) => {
      event.preventDefault();
      closeDashboardModal();
    });
  });

  if (ui.dashboardModal) {
    const overlay = ui.dashboardModal.querySelector('[data-modal-close]');
    if (overlay) {
      on(overlay, 'click', (event) => {
        event.preventDefault();
        closeDashboardModal();
      });
    }
    const closeButton = ui.dashboardModal.querySelector('.modal__close');
    if (closeButton) {
      on(closeButton, 'click', (event) => {
        event.preventDefault();
        closeDashboardModal();
      });
    }
  }

  if (ui.dashboardWidgetsList) {
    on(ui.dashboardWidgetsList, 'change', handleDashboardWidgetsChange);
    on(ui.dashboardWidgetsList, 'click', handleDashboardWidgetsClick);
  }
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
    if (historyState.loading) {
      if (ui.historyEmpty) ui.historyEmpty.hidden = true;
      return;
    }
    if (!historyState.initialized) {
      if (ui.historyEmpty) ui.historyEmpty.hidden = true;
      return;
    }
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
    const id = item?.id != null ? String(item.id) : '';
    const isPendingDelete = id && historyState.pendingDeletes.has(id);
    if (id) {
      li.dataset.historyId = id;
    }
    if (isPendingDelete) {
      li.classList.add('history-item--pending');
    }

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

    if (id) {
      const actions = document.createElement('div');
      actions.className = 'history-item__actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn--ghost btn--sm history-item__delete';
      deleteBtn.dataset.historyAction = 'delete';
      deleteBtn.textContent = isPendingDelete ? 'Eliminando...' : item?.deleted ? 'Eliminado' : 'Eliminar';
      if (isPendingDelete || item?.deleted) {
        deleteBtn.disabled = true;
      }
      actions.appendChild(deleteBtn);
      metaContainer.appendChild(actions);
    }

    li.appendChild(metaContainer);
    ui.historyList.appendChild(li);
  });
}

function handleHistoryListClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-history-action]') : null;
  if (!target) return;
  const action = target.dataset.historyAction;
  if (action !== 'delete') return;

  event.preventDefault();
  const host = target.closest('[data-history-id]');
  const id = host?.dataset.historyId;
  if (!id || historyState.pendingDeletes.has(id)) return;

  requestHistoryDelete(id);
}

function describeHistoryDeleteError(result) {
  const failure = Array.isArray(result?.failures) && result.failures.length ? result.failures[0] : null;
  const reason = failure?.reason || result?.reason;
  switch (reason) {
    case 'no-auth-fetch':
    case 'no-auth':
    case 'no-auth-delete':
      return 'Inicia sesión para eliminar registros del historial.';
    case 'network':
      return 'Error de red al eliminar el registro del historial.';
    default:
      return 'No se pudo eliminar el registro del historial.';
  }
}

async function requestHistoryDelete(id) {
  const confirmMessage = '¿Deseas eliminar este registro del historial?';
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
  }

  historyState.pendingDeletes.add(id);
  renderHistoryItems(historyState.items);

  try {
    const result = await historyStore.deleteItems(id);
    if (!result?.ok) {
      historyState.pendingDeletes.delete(id);
      renderHistoryItems(historyState.items);
      const message = describeHistoryDeleteError(result);
      console.warn('history delete failed', result);
      toast?.error?.(message);
      showHistoryError(message);
      return;
    }
    clearHistoryError();
    toast?.success?.('Registro eliminado del historial.');
  } catch (error) {
    historyState.pendingDeletes.delete(id);
    renderHistoryItems(historyState.items);
    console.error('history delete error', error);
    const message = 'No se pudo eliminar el registro del historial.';
    toast?.error?.(message);
    showHistoryError(message);
  }
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
  clearHistoryError();
  const q = ui.historySearch instanceof HTMLInputElement ? ui.historySearch.value.trim() : '';
  const from = ui.historyFrom instanceof HTMLInputElement ? ui.historyFrom.value : '';
  const to = ui.historyTo instanceof HTMLInputElement ? ui.historyTo.value : '';
  const tags = ui.historyTags instanceof HTMLInputElement ? parseTagsInput(ui.historyTags.value) : [];
  const order = ui.historyOrder instanceof HTMLSelectElement ? ui.historyOrder.value : historyState.order;
  historyStore.setFilters({ page: 1, q, from, to, tags, order }, { resetPage: true, fetch: true });
}

function handleHistoryFiltersReset(event) {
  event.preventDefault();
  if (ui.historyFiltersForm) ui.historyFiltersForm.reset();
  clearHistoryError();
  if (ui.historyOrder instanceof HTMLSelectElement) {
    ui.historyOrder.value = 'desc';
  }
  historyStore.setFilters({ page: 1, q: '', from: '', to: '', tags: [], order: 'desc' }, { resetPage: true, fetch: true });
}

function handleHistoryPrev(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.page <= 1) return;
  historyStore.setFilters({ page: historyState.page - 1 }, { fetch: true });
}

function handleHistoryNext(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.totalPages && historyState.page >= historyState.totalPages) return;
  historyStore.setFilters({ page: historyState.page + 1 }, { fetch: true });
}

async function handleHistoryExportClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const format = button.dataset.historyExport;
  if (!format || historyState.exporting) return;
  await exportHistory(format, button);
}

function handleHistoryOrderChange(event) {
  const select = event?.currentTarget;
  if (!(select instanceof HTMLSelectElement)) return;
  const value = select.value === 'asc' ? 'asc' : 'desc';
  clearHistoryError();
  historyStore.setFilters({ order: value }, { resetPage: true, fetch: true });
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
  clearHistoryError();
  if (!historyState.initialized) {
    await historyStore.setFilters({
      page: historyState.page,
      pageSize: historyState.pageSize,
      order: historyState.order,
      q: historyState.q,
    }, { resetPage: true });
  }
  historyState.initialized = true;
  await historyStore.load();
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
  bindLearningSection();
  bindSecuritySection();
  bindTwoFactorSection();
  bindGuestOverlay();
  bindDashboardCustomization();
  const hasToken = hasSessionToken();
  if (!hasToken) {
    handleUnauthorized(false);
    return;
  }
  loadAccountDetails();
  loadLearningProgress();
  loadPlotHistory();
  loadTickets();
  loadSecuritySummary();
  loadTwoFactorStatus();
}

document.addEventListener('DOMContentLoaded', initAccountPage);

window.addEventListener('ecuplot:user', (event) => {
  const user = event.detail;
  if (user) {
    renderAccountDetails(user);
    loadSecuritySummary({ force: true });
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
  loadLearningProgress({ silent: true });
  loadPlotHistory();
  loadTickets();
  loadSecuritySummary({ force: true });
  loadTwoFactorStatus();
});
