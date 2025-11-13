import { authFetch, toast, eventStream } from '/static/app.js';
import { accountState } from '../state.js';
import { ui } from '../ui.js';

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
  pendingMarks: new Set(),
  markAllPending: false,
  controlsBound: false,
  preferencesSaving: false,
  prefsOpen: false,
  lastUnread: 0,
  error: null,
  initialFetchDone: false,
  sectionActive: false, // Rastrear si la sección está activa
};

// Store se crea bajo demanda, no al importar
let notificationsStore = null;
let storeUnsubscribe = null;
let minimalSSEUnsubscribe = null; // Para badge mientras store no está activo

/**
 * Inicializa el notificationsStore solo cuando se necesita
 */
async function ensureStore() {
  if (notificationsStore) return notificationsStore;
  
  // Import dinámico del store
  const { createNotificationsStore } = await import('../../lib/notifications-store.js');
  
  notificationsStore = createNotificationsStore({ 
    authFetch, 
    eventStream 
  });
  
  // Suscribirse a cambios
  storeUnsubscribe = notificationsStore.subscribe(handleNotificationsSnapshot);
  
  return notificationsStore;
}

/**
 * Listener mínimo de SSE para actualizar badge sin cargar store completo
 */
function attachMinimalSSE() {
  if (!eventStream || minimalSSEUnsubscribe) return;
  
  minimalSSEUnsubscribe = eventStream.subscribeChannel('notifications', (payload) => {
    // Solo actualizar contador de no leídos
    if (typeof payload?.data?.unread === 'number') {
      notificationsState.unread = payload.data.unread;
      updateUnreadBadge();
    }
  });
  
  eventStream.ensure?.();
}

/**
 * Desconectar listener mínimo de SSE
 */
function detachMinimalSSE() {
  if (minimalSSEUnsubscribe) {
    minimalSSEUnsubscribe();
    minimalSSEUnsubscribe = null;
  }
}

/**
 * Actualiza el badge de notificaciones no leídas
 */
function updateUnreadBadge() {
  if (ui.notificationsUnread) {
    const count = notificationsState.unread;
    if (count > 0) {
      ui.notificationsUnread.textContent = `Tienes ${count} notificación${count !== 1 ? 'es' : ''} sin leer.`;
    } else {
      ui.notificationsUnread.textContent = 'No tienes notificaciones sin leer.';
    }
  }
}

function describeNotificationsEmptyMessage() {
  if (notificationsState.loading) return 'Cargando notificaciones…';
  if (notificationsState.error) return describeNotificationError(notificationsState.error);
  if (!accountState.user) return 'Inicia sesión para ver tus notificaciones.';
  if (notificationsState.includeRead) return 'No hay notificaciones para los filtros seleccionados.';
  return 'No tienes notificaciones por ahora.';
}

function describeNotificationError(error) {
  if (!error) return 'No se pudieron cargar las notificaciones.';
  if (typeof error === 'string') {
    if (error === 'network') return 'Error de red al cargar notificaciones.';
    if (error.startsWith('notifications:')) return 'No se pudieron cargar las notificaciones.';
    return error;
  }
  if (typeof error === 'object') {
    if (error.message) return error.message;
    if (error.error) return error.error;
  }
  return 'No se pudieron cargar las notificaciones.';
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
    li.tabIndex = 0;
    if (item?.id != null) {
      const id = String(item.id);
      li.dataset.notificationId = id;
      if (notificationsState.pendingMarks.has(id)) {
        li.classList.add('notifications-item--pending');
      }
    }
    if (item?.read || item?.read_at || item?.readAt) {
      li.classList.add('notifications-item--read');
    } else {
      li.classList.add('notifications-item--unread');
    }

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

    if (item?.message) {
      const message = document.createElement('p');
      message.className = 'notifications-item__message';
      message.textContent = item.message;
      li.appendChild(message);
    }

    if (item?.action?.label && item?.action?.url) {
      const actions = document.createElement('div');
      actions.className = 'notifications-item__actions';
      const link = document.createElement('a');
      link.href = item.action.url;
      link.textContent = item.action.label;
      link.target = '_blank';
      link.rel = 'noreferrer';
      actions.appendChild(link);
      li.appendChild(actions);
    }

    ui.notificationsList.appendChild(li);
  });
}

function renderNotificationCategories(categories) {
  if (!(ui.notificationsCategory instanceof HTMLSelectElement)) return;
  const entries = Object.entries(categories || {});
  const currentValue = ui.notificationsCategory.value;
  ui.notificationsCategory.innerHTML = '';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Todas las categorías';
  ui.notificationsCategory.appendChild(blank);

  entries
    .sort((a, b) => String(a[1] || a[0]).localeCompare(String(b[1] || b[0])))
    .forEach(([key, label]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label || key;
      ui.notificationsCategory.appendChild(option);
    });

  ui.notificationsCategory.value = entries.find(([key]) => key === currentValue) ? currentValue : '';
}

function renderNotificationPreferences(preferences, categories) {
  if (!ui.notificationsPrefsFields) return;
  const prefs = preferences && typeof preferences === 'object' ? preferences : {};
  const cats = categories && typeof categories === 'object' ? categories : {};
  const entries = Object.entries(cats);
  ui.notificationsPrefsFields.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'notifications-preferences__empty';
    empty.textContent = 'Aún no hay categorías configurables.';
    ui.notificationsPrefsFields.appendChild(empty);
    return;
  }

  entries
    .sort((a, b) => String(a[1] || a[0]).localeCompare(String(b[1] || b[0])))
    .forEach(([key, label]) => {
      const checkboxId = `notifications-pref-${key}`;
      const wrapper = document.createElement('label');
      wrapper.className = 'form__checkbox';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = key;
      input.id = checkboxId;
      input.checked = prefs[key] !== false;
      wrapper.appendChild(input);

      const span = document.createElement('span');
      span.textContent = label || key;
      wrapper.appendChild(span);

      ui.notificationsPrefsFields.appendChild(wrapper);
    });
}

function applyNotificationBadge() {
  if (!ui.notificationsUnread) return;
  if (notificationsState.loading) {
    ui.notificationsUnread.textContent = 'Cargando notificaciones…';
    return;
  }
  if (notificationsState.error) {
    ui.notificationsUnread.textContent = describeNotificationError(notificationsState.error);
    return;
  }
  const unread = Number(notificationsState.unread) || 0;
  if (unread > 0) {
    ui.notificationsUnread.textContent = unread === 1 ? 'Tienes 1 notificación sin leer.' : `Tienes ${unread} notificaciones sin leer.`;
    return;
  }
  if (notificationsState.items.length) {
    ui.notificationsUnread.textContent = 'Sin notificaciones pendientes.';
    return;
  }
  ui.notificationsUnread.textContent = describeNotificationsEmptyMessage();
}

function syncNotificationsFilters() {
  if (ui.notificationsIncludeRead instanceof HTMLInputElement) {
    ui.notificationsIncludeRead.checked = Boolean(notificationsState.includeRead);
  }
  if (ui.notificationsCategory instanceof HTMLSelectElement) {
    ui.notificationsCategory.value = notificationsState.category || '';
  }
}

function updateNotificationsControls() {
  const { loading, page, totalPages, unread, markAllPending, pendingMarks, preferencesSaving, prefsOpen, categories } = notificationsState;
  const hasCategories = categories && Object.keys(categories).length > 0;

  if (ui.notificationsRefresh instanceof HTMLButtonElement) {
    ui.notificationsRefresh.disabled = loading;
    ui.notificationsRefresh.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  if (ui.notificationsMarkAll instanceof HTMLButtonElement) {
    const disabled = loading || markAllPending || unread <= 0 || pendingMarks.size > 0;
    ui.notificationsMarkAll.disabled = disabled;
    ui.notificationsMarkAll.setAttribute('aria-busy', markAllPending ? 'true' : 'false');
  }

  if (ui.notificationsPrev instanceof HTMLButtonElement) {
    ui.notificationsPrev.disabled = loading || page <= 1;
  }

  if (ui.notificationsNext instanceof HTMLButtonElement) {
    const atEnd = totalPages !== 0 && page >= totalPages;
    ui.notificationsNext.disabled = loading || atEnd;
  }

  if (ui.notificationsPageInfo) {
    const pages = totalPages > 0 ? totalPages : 1;
    ui.notificationsPageInfo.textContent = `Página ${page || 1} de ${pages}`;
  }

  if (ui.notificationsPagination) {
    ui.notificationsPagination.hidden = totalPages <= 1 && page <= 1;
  }

  if (ui.notificationsPrefsToggle instanceof HTMLButtonElement) {
    ui.notificationsPrefsToggle.disabled = !hasCategories;
    ui.notificationsPrefsToggle.setAttribute('aria-expanded', notificationsState.prefsOpen ? 'true' : 'false');
  }

  if (ui.notificationsPrefsForm) {
    ui.notificationsPrefsForm.hidden = !prefsOpen;
    ui.notificationsPrefsForm.setAttribute('aria-hidden', prefsOpen ? 'false' : 'true');
    ui.notificationsPrefsForm.classList.toggle('is-pending', Boolean(preferencesSaving));
  }

  if (ui.notificationsList) {
    ui.notificationsList.classList.toggle('is-loading', loading);
    Array.from(ui.notificationsList.children).forEach((li) => {
      const id = li.dataset.notificationId;
      if (!id) return;
      if (pendingMarks.has(id)) {
        li.classList.add('notifications-item--pending');
      } else {
        li.classList.remove('notifications-item--pending');
      }
      if (notificationsState.items.some((item) => String(item.id) === id && (item.read || item.read_at))) {
        li.classList.add('notifications-item--read');
        li.classList.remove('notifications-item--unread');
      }
    });
  }
}

function toggleNotificationsPrefs(forceValue) {
  const nextValue = typeof forceValue === 'boolean' ? forceValue : !notificationsState.prefsOpen;
  notificationsState.prefsOpen = nextValue;
  if (notificationsState.prefsOpen) {
    renderNotificationPreferences(notificationsState.preferences, notificationsState.categories);
  }
  updateNotificationsControls();
  if (notificationsState.prefsOpen) {
    const firstInput = ui.notificationsPrefsForm?.querySelector('input');
    firstInput?.focus?.();
  } else if (ui.notificationsPrefsToggle instanceof HTMLButtonElement) {
    ui.notificationsPrefsToggle.focus();
  }
}

function handleNotificationsPrefsToggle(event) {
  event?.preventDefault?.();
  if (ui.notificationsPrefsToggle?.disabled) return;
  toggleNotificationsPrefs();
}

function handleNotificationsPrefsCancel(event) {
  event?.preventDefault?.();
  toggleNotificationsPrefs(false);
}

async function handleNotificationsPrefsSubmit(event) {
  event?.preventDefault?.();
  if (!ui.notificationsPrefsForm || notificationsState.preferencesSaving) return;
  const form = ui.notificationsPrefsForm;
  const payload = {};
  Array.from(form.querySelectorAll('input[type="checkbox"][name]')).forEach((input) => {
    payload[input.name] = input.checked;
  });

  notificationsState.preferencesSaving = true;
  updateNotificationsControls();

  try {
    const store = await ensureStore();
    const result = await store.updatePreferences(payload);
    if (!result?.ok) {
      toast?.error?.(describeNotificationError(result?.reason || 'prefs:500'));
      return;
    }
    notificationsState.preferences = { ...(result.preferences || payload) };
    toast?.success?.('Preferencias actualizadas.');
    toggleNotificationsPrefs(false);
  } catch (error) {
    toast?.error?.('No se pudieron actualizar las preferencias.');
  } finally {
    notificationsState.preferencesSaving = false;
    updateNotificationsControls();
  }
}

async function handleNotificationsCategoryChange(event) {
  const value = typeof event?.target?.value === 'string' ? event.target.value : '';
  notificationsState.category = value;
  await loadNotifications({ category: value, page: 1, fetch: true });
}

async function handleNotificationsIncludeReadChange(event) {
  const checked = Boolean(event?.target?.checked);
  notificationsState.includeRead = checked;
  await loadNotifications({ includeRead: checked, page: 1, fetch: true });
}

async function handleNotificationsPrevPage(event) {
  event?.preventDefault?.();
  if (notificationsState.loading || notificationsState.page <= 1) return;
  const targetPage = Math.max(1, notificationsState.page - 1);
  await loadNotifications({ page: targetPage, fetch: true });
}

async function handleNotificationsNextPage(event) {
  event?.preventDefault?.();
  if (notificationsState.loading) return;
  const totalPages = Number(notificationsState.totalPages) || 0;
  if (totalPages && notificationsState.page >= totalPages) return;
  const targetPage = notificationsState.page + 1;
  await loadNotifications({ page: targetPage, fetch: true });
}

async function handleNotificationsRefresh(event) {
  event?.preventDefault?.();
  if (notificationsState.loading) return;
  await loadNotifications({ fetch: true });
}

async function markNotificationRead(notificationId, { silent = false } = {}) {
  const id = notificationId ? String(notificationId) : '';
  if (!id || notificationsState.pendingMarks.has(id)) return;
  const existing = notificationsState.items.find((item) => String(item.id) === id);
  if (existing?.read || existing?.read_at) return;
  notificationsState.pendingMarks.add(id);
  updateNotificationsControls();
  try {
    const store = await ensureStore();
    const result = await store.markRead(id);
    if (!result?.ok && !silent) {
      toast?.error?.(describeNotificationError(result?.reason || 'mark-read:500'));
    }
  } catch (error) {
    if (!silent) toast?.error?.('No se pudo marcar la notificación como leída.');
  } finally {
    notificationsState.pendingMarks.delete(id);
    updateNotificationsControls();
  }
}

function handleNotificationListClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const actionLink = target?.closest('.notifications-item__actions a');
  const itemElement = target?.closest('.notifications-item');
  if (!itemElement || !ui.notificationsList?.contains(itemElement)) return;
  const id = itemElement.dataset.notificationId;
  if (!id) return;
  if (actionLink) {
    markNotificationRead(id, { silent: true });
    return;
  }
  if (itemElement.classList.contains('notifications-item--read')) return;
  markNotificationRead(id);
}

function handleNotificationListKeydown(event) {
  if (event.defaultPrevented) return;
  const key = event.key;
  if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && key !== 'Space') return;
  const target = event.target instanceof Element ? event.target : null;
  const itemElement = target?.closest('.notifications-item');
  if (!itemElement || !ui.notificationsList?.contains(itemElement)) return;
  const id = itemElement.dataset.notificationId;
  if (!id) return;
  event.preventDefault();
  if (itemElement.classList.contains('notifications-item--read')) return;
  markNotificationRead(id);
}

async function handleNotificationsMarkAll(event) {
  event?.preventDefault?.();
  if (notificationsState.loading || notificationsState.markAllPending || notificationsState.unread <= 0) return;
  notificationsState.markAllPending = true;
  updateNotificationsControls();
  try {
    const store = await ensureStore();
    const result = await store.markAll({ category: notificationsState.category || undefined });
    if (!result?.ok) {
      toast?.error?.(describeNotificationError(result?.reason || 'mark-all:500'));
      return;
    }
    toast?.success?.('Listo, marcamos tus notificaciones como leídas.');
    await loadNotifications({ fetch: true });
  } catch (error) {
    toast?.error?.('No se pudieron marcar las notificaciones como leídas.');
  } finally {
    notificationsState.markAllPending = false;
    updateNotificationsControls();
  }
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

function resetNotificationsUI() {
  notificationsState.loading = false;
  notificationsState.page = 1;
  notificationsState.totalPages = 0;
  notificationsState.includeRead = false;
  notificationsState.category = '';
  notificationsState.unread = 0;
  notificationsState.items = [];
  notificationsState.preferences = {};
  notificationsState.categories = {};
  notificationsState.pendingMarks = new Set();
  notificationsState.markAllPending = false;
  notificationsState.preferencesSaving = false;
  notificationsState.prefsOpen = false;
  notificationsState.error = null;
  notificationsState.initialFetchDone = false;

  if (ui.notificationsIncludeRead instanceof HTMLInputElement) {
    ui.notificationsIncludeRead.checked = false;
  }
  if (ui.notificationsCategory instanceof HTMLSelectElement) {
    ui.notificationsCategory.selectedIndex = 0;
  }
  if (ui.notificationsList) {
    ui.notificationsList.replaceChildren();
  }
  if (ui.notificationsEmpty) {
    ui.notificationsEmpty.hidden = false;
    ui.notificationsEmpty.textContent = 'Inicia sesión para ver tus notificaciones.';
  }
  if (ui.notificationsUnread) {
    ui.notificationsUnread.textContent = 'Inicia sesión para ver tus notificaciones.';
  }
  if (ui.notificationsPagination) {
    ui.notificationsPagination.hidden = true;
  }
  renderNotificationCategories({});
  renderNotificationPreferences({}, {});
  updateNotificationsControls();
}

function handleNotificationsSnapshot(snapshot = {}) {
  bindNotificationsSection();
  const filters = snapshot.filters || {};
  const meta = snapshot.meta || {};
  const previousError = notificationsState.error;
  const previousUnread = notificationsState.unread;

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

  if (notificationsState.pendingMarks.size) {
    const itemsById = new Map(
      notificationsState.items.map((item) => [String(item.id), Boolean(item?.read) || Boolean(item?.read_at)])
    );
    notificationsState.pendingMarks.forEach((id) => {
      if (!itemsById.has(id) || itemsById.get(id)) {
        notificationsState.pendingMarks.delete(id);
      }
    });
  }

  if (snapshot.preferences && typeof snapshot.preferences === 'object') {
    notificationsState.preferences = { ...snapshot.preferences };
  }
  if (snapshot.categories && typeof snapshot.categories === 'object') {
    notificationsState.categories = { ...snapshot.categories };
  }
  renderNotificationCategories(notificationsState.categories);
  renderNotificationPreferences(notificationsState.preferences, notificationsState.categories);

  if (ui.notificationsList) {
    ui.notificationsList.setAttribute('aria-busy', notificationsState.loading ? 'true' : 'false');
  }

  syncNotificationsFilters();
  renderNotificationItems(notificationsState.items);
  updateNotificationsPagination();
  applyNotificationBadge();
  updateNotificationsControls();

  if (notificationsState.error && notificationsState.error !== previousError) {
    toast?.error?.(describeNotificationError(notificationsState.error));
  }

  if (!notificationsState.error && previousError && !notificationsState.loading) {
    if (ui.notificationsEmpty && ui.notificationsEmpty.hidden === false) {
      ui.notificationsEmpty.textContent = describeNotificationsEmptyMessage();
    }
  }

  if (typeof previousUnread === 'number' && previousUnread !== notificationsState.unread) {
    notificationsState.lastUnread = notificationsState.unread;
    window.dispatchEvent(
      new CustomEvent('ecuplot:notifications', {
        detail: { unread: notificationsState.unread, category: notificationsState.category },
      })
    );
  }
}

function bindNotificationsSection() {
  if (notificationsState.controlsBound) return;
  notificationsState.controlsBound = true;

  if (ui.notificationsCategory) {
    ui.notificationsCategory.addEventListener('change', handleNotificationsCategoryChange);
  }
  if (ui.notificationsIncludeRead) {
    ui.notificationsIncludeRead.addEventListener('change', handleNotificationsIncludeReadChange);
  }
  if (ui.notificationsPrev) {
    ui.notificationsPrev.addEventListener('click', handleNotificationsPrevPage);
  }
  if (ui.notificationsNext) {
    ui.notificationsNext.addEventListener('click', handleNotificationsNextPage);
  }
  if (ui.notificationsRefresh) {
    ui.notificationsRefresh.addEventListener('click', handleNotificationsRefresh);
  }
  if (ui.notificationsMarkAll) {
    ui.notificationsMarkAll.addEventListener('click', handleNotificationsMarkAll);
  }
  if (ui.notificationsList) {
    ui.notificationsList.addEventListener('click', handleNotificationListClick);
    ui.notificationsList.addEventListener('keydown', handleNotificationListKeydown);
  }
  if (ui.notificationsPrefsToggle) {
    ui.notificationsPrefsToggle.addEventListener('click', handleNotificationsPrefsToggle);
  }
  if (ui.notificationsPrefsForm) {
    ui.notificationsPrefsForm.addEventListener('submit', handleNotificationsPrefsSubmit);
    const cancel = ui.notificationsPrefsForm.querySelector('[data-notifications-cancel]');
    if (cancel) cancel.addEventListener('click', handleNotificationsPrefsCancel);
  }

  // Iniciar con listener mínimo de SSE para badge
  attachMinimalSSE();
}

async function loadNotifications(options = {}) {
  const partial = {};
  if (options.resetPage) partial.page = 1;
  if (options.page != null) partial.page = options.page;
  if (options.includeRead != null) partial.includeRead = options.includeRead;
  if (options.category != null) partial.category = options.category;
  const fetch = options.fetch !== false;

  // Asegurar que el store existe antes de usarlo
  const store = await ensureStore();
  
  // Al activar el store completo, desactivar SSE mínimo
  if (!notificationsState.sectionActive) {
    notificationsState.sectionActive = true;
    detachMinimalSSE();
  }

  let request;
  if (Object.keys(partial).length) {
    request = store.setFilters(partial, { fetch });
  } else if (fetch) {
    request = store.load();
  } else {
    request = Promise.resolve({ ok: true });
  }

  if (fetch) {
    notificationsState.initialFetchDone = true;
  }

  return request;
}

/**
 * Desactiva el store completo y vuelve a SSE mínimo para badge
 */
function deactivateFullStore() {
  if (!notificationsState.sectionActive) return;
  
  notificationsState.sectionActive = false;
  
  // Desconectar listener completo del store
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  
  // Volver a listener mínimo para mantener badge actualizado
  attachMinimalSSE();
}

export function createNotificationsSection() {
  return {
    init: bindNotificationsSection,
    load: loadNotifications,
    reset: resetNotificationsUI,
    activate: loadNotifications,  // Activar store completo
    deactivate: deactivateFullStore,  // Volver a modo mínimo
  };
}
