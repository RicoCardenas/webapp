import { toast, getCurrentUser, refreshCurrentUser } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { developmentState, developmentRemovalState } from '../../../state.js';
import { formatNumber } from '../../../utils.js';

export function bindAdmins() {
  if (ui.developmentAssignForm) on(ui.developmentAssignForm, 'submit', onDevelopmentAssignAdmin);
  if (ui.developmentAdminList) on(ui.developmentAdminList, 'click', onDevelopmentAdminListClick);
}

function onDevelopmentAssignAdmin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const userIdInput = ui.developmentUserId;
  const visibleIdInput = ui.developmentVisibleId;
  const userId = userIdInput instanceof HTMLInputElement ? userIdInput.value.trim() : '';
  const visibleId = visibleIdInput instanceof HTMLInputElement ? visibleIdInput.value.trim() : '';
  if (!userId && !visibleId) {
    toast?.error?.('Ingresa el ID del usuario.');
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  if (userIdInput instanceof HTMLInputElement) userIdInput.disabled = true;
  if (visibleIdInput instanceof HTMLInputElement) visibleIdInput.disabled = true;

  const payload = {};
  if (userId) payload.user_id = userId;
  if (visibleId) payload.visible_id = visibleId;

  handleDevelopmentAssignAdmin(payload).finally(() => {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
    if (userIdInput instanceof HTMLInputElement) userIdInput.disabled = false;
    if (visibleIdInput instanceof HTMLInputElement) visibleIdInput.disabled = false;
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
  if (ui.developmentUserId instanceof HTMLInputElement) ui.developmentUserId.value = '';
  if (ui.developmentVisibleId instanceof HTMLInputElement) ui.developmentVisibleId.value = '';
  await loadDevelopmentAdmins();
  await loadDevelopmentRequests();
}

export async function loadDevelopmentAdmins() {
  if (!ui.developmentAdminList) return;
  ui.developmentAdminList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando administradores...';
  ui.developmentAdminList.appendChild(loading);

  const res = await requestWithAuth('/api/development/admins');
  if (!res) {
    ui.developmentAdminList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar los administradores.';
    ui.developmentAdminList.appendChild(errorMsg);
    return;
  }

  if (res.status === 403) {
    ui.developmentAdminList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Esta sección es exclusiva para el equipo de desarrollo.';
    ui.developmentAdminList.appendChild(errorMsg);
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudo obtener el listado de administradores.');
    ui.developmentAdminList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Se produjo un error al cargar los administradores.';
    ui.developmentAdminList.appendChild(errorMsg);
    return;
  }

  const data = await res.json().catch(() => ({}));
  developmentState.admins = Array.isArray(data?.admins) ? data.admins : [];
  developmentState.adminsTotal = Number(data?.total ?? developmentState.admins.length ?? 0);
  renderDevelopmentAdmins(developmentState.admins, developmentState.adminsTotal);
}

export function renderDevelopmentAdmins(admins, total = Array.isArray(admins) ? admins.length : 0) {
  if (!ui.developmentAdminList) return;
  ui.developmentAdminList.innerHTML = '';
  if (ui.developmentAdminEmpty) ui.developmentAdminEmpty.hidden = true;

  if (!Array.isArray(admins) || !admins.length) {
    if (ui.developmentAdminEmpty) {
      ui.developmentAdminEmpty.textContent = 'No hay administradores registrados.';
      ui.developmentAdminEmpty.hidden = false;
    }
    return;
  }

  const meta = document.createElement('p');
  meta.className = 'role-panel__meta';
  meta.textContent = `Administradores activos: ${formatNumber(total)}`;
  ui.developmentAdminList.appendChild(meta);

  admins.forEach((admin) => {
    const item = document.createElement('article');
    item.className = 'role-panel__card';
    item.dataset.adminId = admin?.id ? String(admin.id) : '';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = admin?.name || 'Usuario';
    item.appendChild(title);

    const metaInfo = document.createElement('p');
    metaInfo.className = 'role-panel__meta';
    metaInfo.textContent = admin?.email || 'Sin correo';
    item.appendChild(metaInfo);

    const actions = document.createElement('div');
    actions.className = 'role-panel__member-actions';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn--ghost btn--sm';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Quitar rol';
    removeBtn.dataset.adminId = admin?.id ? String(admin.id) : '';
    removeBtn.dataset.adminName = admin?.name || '';
    on(removeBtn, 'click', onDevelopmentAdminListClick);

    actions.appendChild(removeBtn);
    item.appendChild(actions);

    ui.developmentAdminList.appendChild(item);
  });
}

function onDevelopmentAdminListClick(event) {
  const button = event.target instanceof Element ? event.target.closest('[data-admin-id]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const adminId = button.dataset.adminId;
  if (!adminId) return;
  openDevelopmentRemoveModal({
    id: adminId,
    name: button.dataset.adminName || '',
  });
}

// Variable para rastrear si los listeners del modal ya fueron agregados
let modalListenersBound = false;

export function openDevelopmentRemoveModal(admin) {
  developmentRemovalState.target = admin || null;
  if (!ui.developmentRemoveModal) return;
  
  if (ui.developmentRemoveMessage) {
    ui.developmentRemoveMessage.textContent = admin?.name
      ? `¿Seguro que deseas quitar el rol admin a ${admin.name}?`
      : '¿Seguro que deseas quitar este rol admin?';
  }
  
  if (ui.developmentRemoveConfirm instanceof HTMLButtonElement) {
    ui.developmentRemoveConfirm.disabled = false;
    ui.developmentRemoveConfirm.textContent = 'Quitar rol';
  }
  
  // Agregar event listeners solo la primera vez
  if (!modalListenersBound) {
    on(ui.developmentRemoveModal, 'click', onDevelopmentRemoveModalClick);
    if (ui.developmentRemoveConfirm) on(ui.developmentRemoveConfirm, 'click', onDevelopmentRemoveConfirm);
    if (ui.developmentRemoveCancel) on(ui.developmentRemoveCancel, 'click', closeDevelopmentRemoveModal);
    modalListenersBound = true;
  }
  
  // Agregar la clase is-open que usa el CSS para mostrar el modal
  ui.developmentRemoveModal.hidden = false;
  ui.developmentRemoveModal.classList.add('is-open');
  ui.developmentRemoveModal.dataset.active = 'true';
  ui.developmentRemoveModal.setAttribute('aria-hidden', 'false');
}

function closeDevelopmentRemoveModal() {
  if (!ui.developmentRemoveModal) return;
  ui.developmentRemoveModal.classList.remove('is-open');
  ui.developmentRemoveModal.hidden = true;
  ui.developmentRemoveModal.dataset.active = 'false';
  ui.developmentRemoveModal.setAttribute('aria-hidden', 'true');
  developmentRemovalState.target = null;
}

function onDevelopmentRemoveModalClick(event) {
  if (event.target === ui.developmentRemoveModal) closeDevelopmentRemoveModal();
}

function onDevelopmentRemoveConfirm(event) {
  event.preventDefault();
  if (developmentRemovalState.loading) return;
  handleDevelopmentRemoveAdmin();
}

async function handleDevelopmentRemoveAdmin() {
  const target = developmentRemovalState.target;
  if (!target?.id) return;
  
  developmentRemovalState.loading = true;
  const button = ui.developmentRemoveConfirm;
  const originalLabel = button?.textContent || 'Quitar rol';
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = 'Quitando...';
  }

  const res = await requestWithAuth(`/api/development/users/${encodeURIComponent(target.id)}/roles/admin`, {
    method: 'DELETE',
  });

  developmentRemovalState.loading = false;
  if (button instanceof HTMLButtonElement) {
    button.disabled = false;
    button.textContent = originalLabel;
  }

  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo quitar el rol admin.');
    return;
  }

  const data = await res.json().catch(() => ({}));
  toast?.success?.(data?.message || 'Rol admin removido.');
  closeDevelopmentRemoveModal();
  await loadDevelopmentAdmins();
  await loadDevelopmentRequests();

  const currentUser = getCurrentUser();
  if (currentUser && currentUser.id === target.id) {
    const { user, status } = await refreshCurrentUser();
    if (!user && status === 401) {
      window.dispatchEvent(new CustomEvent('ecuplot:logout'));
    }
  }
}

// Local re-exports to avoid cycles
import { loadDevelopmentRequests } from './requests.js';
export { loadDevelopmentRequests };
