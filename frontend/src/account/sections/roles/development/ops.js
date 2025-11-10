import { eventStream } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { developmentState } from '../../../state.js';

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

export function setOpsLoading(isLoading) {
  developmentState.opsLoading = Boolean(isLoading);
  if (ui.opsEventsList) ui.opsEventsList.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  if (ui.opsEventsPagination) ui.opsEventsPagination.classList.toggle('is-loading', isLoading);
}

export function showOpsPlaceholder(message) {
  if (!ui.opsEventsEmpty) return;
  ui.opsEventsEmpty.textContent = message;
  ui.opsEventsEmpty.hidden = !message;
}

export function formatOpsTimestamp(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function normalizeOpsEvent(event) {
  if (!event) return null;
  const timestamp = event.timestamp || event.created_at || event.createdAt;
  return {
    id: event.id || crypto.randomUUID?.() || `${event.type}-${timestamp}`,
    type: event.type || 'evento',
    label: OPS_EVENT_LABELS[event.type] || event.type,
    timestamp,
    details: event.details || event.meta || {},
  };
}

export function ensureOpsPaginationBindings() {
  if (developmentState.opsPaginationBound) return;
  developmentState.opsPaginationBound = true;
  if (ui.opsEventsPrev) {
    on(ui.opsEventsPrev, 'click', (event) => {
      event.preventDefault();
      if (developmentState.opsPage <= 1) return;
      developmentState.opsPage -= 1;
      loadOperationsSummary({ page: developmentState.opsPage });
    });
  }
  if (ui.opsEventsNext) {
    on(ui.opsEventsNext, 'click', (event) => {
      event.preventDefault();
      if (developmentState.opsHasNext) {
        developmentState.opsPage += 1;
        loadOperationsSummary({ page: developmentState.opsPage });
      }
    });
  }
}

export function updateOpsPagination(meta = {}) {
  const total = Number.isFinite(meta.total) ? Number(meta.total) : Number(developmentState.opsTotal || 0);
  const pageSize = Number.isFinite(meta.page_size) ? Number(meta.page_size) : Number(developmentState.opsPageSize || 20);
  const page = Number.isFinite(meta.page) ? Number(meta.page) : Number(developmentState.opsPage || 1);

  developmentState.opsTotal = total;
  developmentState.opsPageSize = pageSize;
  developmentState.opsPage = page;
  developmentState.opsHasNext = meta.has_next ?? page * pageSize < total;
  developmentState.opsHasPrev = meta.has_prev ?? page > 1;

  if (ui.opsEventsPageInfo) {
    const pages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
    ui.opsEventsPageInfo.textContent = `Página ${page} de ${pages || 1}`;
  }

  if (ui.opsEventsPrev instanceof HTMLButtonElement) ui.opsEventsPrev.disabled = !developmentState.opsHasPrev;
  if (ui.opsEventsNext instanceof HTMLButtonElement) ui.opsEventsNext.disabled = !developmentState.opsHasNext;
}

export function renderOpsBackup(backup) {
  if (!ui.opsBackupStatus || !ui.opsBackupMeta) return;
  if (!backup) {
    ui.opsBackupStatus.textContent = 'Último backup: sin registros';
    ui.opsBackupMeta.textContent = '';
    return;
  }
  ui.opsBackupStatus.textContent = `Último backup: ${backup.name || 'N/D'}`;
  ui.opsBackupMeta.textContent = `Creado el ${formatOpsTimestamp(backup.created_at)} · Tamaño: ${backup.size || 'N/D'}`;
}

export function renderOpsEvents(events) {
  if (!ui.opsEventsList) return;
  ui.opsEventsList.innerHTML = '';
  if (!Array.isArray(events) || !events.length) {
    showOpsPlaceholder('No hay eventos registrados.');
    return;
  }
  showOpsPlaceholder('');
  events.forEach((raw) => {
    const event = normalizeOpsEvent(raw);
    if (!event) return;
    const item = document.createElement('li');
    item.className = 'ops-event';

    const header = document.createElement('header');
    header.className = 'ops-event__header';
    const title = document.createElement('h4');
    title.textContent = event.label;
    header.appendChild(title);
    const time = document.createElement('span');
    time.className = 'ops-event__time';
    time.textContent = formatOpsTimestamp(event.timestamp);
    header.appendChild(time);
    item.appendChild(header);

    const detailsWrap = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Ver detalles';
    detailsWrap.appendChild(summary);
    const details = document.createElement('pre');
    details.className = 'ops-event__details';
    try {
      const compact = { ...(event.details || {}) };
      delete compact.action; delete compact.type; delete compact.created_at; delete compact.timestamp;
      details.textContent = JSON.stringify(compact, null, 2);
    } catch {
      details.textContent = JSON.stringify(event.details || {}, null, 2);
    }
    detailsWrap.appendChild(details);
    item.appendChild(detailsWrap);

    ui.opsEventsList.appendChild(item);
  });
}

export function renderOpsSummary(summary) {
  renderOpsBackup(summary?.backup);
  renderOpsEvents(summary?.events);
  updateOpsPagination(summary?.meta || {});
}

export async function loadOperationsSummary(options = {}) {
  if (!ui.opsEventsList) return;
  const params = new URLSearchParams();
  const page = options.page || developmentState.opsPage || 1;
  params.set('page', String(page));
  params.set('page_size', String(developmentState.opsPageSize || 20));

  setOpsLoading(true);
  try {
    const res = await requestWithAuth(`/api/admin/ops/summary?${params.toString()}`);
    if (!res) return;
    if (!res.ok) {
      showOpsPlaceholder('No se pudieron cargar los eventos.');
      renderOpsBackup(null);
      return;
    }
    const data = await res.json().catch(() => ({}));
    const events = Array.isArray(data?.events) ? data.events : [];
    developmentState.opsEvents = events;
    renderOpsSummary({
      backup: data?.backup,
      events,
      meta: data?.meta,
    });
  } finally {
    setOpsLoading(false);
  }
}

export function ensureOpsSubscription() {
  if (!eventStream || developmentState.opsUnsubscribe) return;
  developmentState.opsUnsubscribe = eventStream.subscribeChannel('ops', handleOpsNewEvent);
  eventStream.ensure?.();
}

export function handleOpsNewEvent(rawEvent) {
  const event = normalizeOpsEvent(rawEvent);
  if (!event) return;
  developmentState.opsEvents = [event, ...developmentState.opsEvents].slice(0, developmentState.opsPageSize || 20);
  renderOpsEvents(developmentState.opsEvents);
}

export function clearOpsSubscription() {
  if (typeof developmentState.opsUnsubscribe === 'function') {
    developmentState.opsUnsubscribe();
  }
  developmentState.opsUnsubscribe = null;
}

export function resetOpsUI() {
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
}
