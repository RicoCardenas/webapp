import { toast } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';

export function bindRequests() {
  if (!ui.developmentRequestsList) return;
  // List item buttons bind on render via on(...)
}

export async function loadDevelopmentRequests() {
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

export function renderDevelopmentRequests(requests) {
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

