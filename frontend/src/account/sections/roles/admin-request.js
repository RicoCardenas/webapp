import { toast } from '/static/app.js';
import { on } from '../../../lib/events.js';
import { requestWithAuth } from '../../api-client.js';
import { ui } from '../../ui.js';
import { adminRequestState } from '../../state.js';

export function bindAdminRequestSection() {
  const button = ui.adminRequestButton;
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || 'Solicitar rol de administrador';
  }
  on(button, 'click', handleAdminRoleRequestClick);
}

export function formatRequestTimestamp(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export async function loadAdminRequestStatus() {
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

export function updateAdminRequestStatus(status, message = '', request = null) {
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
    case 'rejected':
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

export async function handleAdminRoleRequestClick(event) {
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

export function resetAdminRequestUI() {
  if (ui.adminRequestBox) ui.adminRequestBox.hidden = true;
  if (ui.adminRequestStatus) {
    ui.adminRequestStatus.textContent = '';
    ui.adminRequestStatus.hidden = true;
    ui.adminRequestStatus.removeAttribute('data-state');
  }
  if (ui.adminRequestButton) {
    const defaultLabel = ui.adminRequestButton.dataset.defaultLabel || ui.adminRequestButton.textContent || 'Solicitar rol de administrador';
    ui.adminRequestButton.disabled = false;
    ui.adminRequestButton.textContent = defaultLabel;
    delete ui.adminRequestButton.dataset.requestId;
  }
  adminRequestState.status = 'none';
  adminRequestState.loading = false;
}

