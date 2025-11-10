import { toast } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { adminState, accountState } from '../../../state.js';
import { loadAdminGroups, loadAdminGroupDetail } from './groups.js';
import { loadAdminStats } from './stats.js';

const DATE_FORMATTER = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
  ? Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
  : null;

export function bindAdminUsers() {
  if (ui.adminAssignForm) on(ui.adminAssignForm, 'submit', onAdminAssignTeacher);
  if (ui.adminRefreshTeachers) on(ui.adminRefreshTeachers, 'click', () => loadAdminUsers());
}

async function onAdminAssignTeacher(event) {
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

  try {
    await handleAdminAssignTeacher(payload);
  } finally {
    if (userIdInput instanceof HTMLInputElement) userIdInput.disabled = false;
    if (visibleIdInput instanceof HTMLInputElement) visibleIdInput.disabled = false;
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  }
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
  await loadAdminUsers();
  await loadAdminGroups();
  const hasDevelopmentRole = accountState.roles instanceof Set && accountState.roles.has('development');
  if (hasDevelopmentRole) await loadAdminStats();
}

export async function loadAdminUsers() {
  if (!ui.adminUserList) return;
  ui.adminUserList.innerHTML = '';
  adminState.loadingTeachers = true;
  if (ui.adminTeachersEmpty) ui.adminTeachersEmpty.hidden = true;

  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando docentes...';
  ui.adminUserList.appendChild(loading);

  const res = await requestWithAuth('/api/admin/my-teachers');
  adminState.loadingTeachers = false;
  ui.adminUserList.innerHTML = '';

  if (!res) {
    renderAdminUsers([]);
    toast?.error?.('No se pudo cargar el listado de docentes.');
    return;
  }

  if (res.status === 403) {
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Esta sección está limitada a cuentas con rol administrador.';
    ui.adminUserList.appendChild(errorMsg);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo obtener el listado de docentes.');
    renderAdminUsers([]);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const users = Array.isArray(data?.teachers) ? data.teachers : [];
  adminState.teachers = users;
  renderAdminUsers(users);
  if (adminState.selectedGroupId) {
    await loadAdminGroupDetail(adminState.selectedGroupId, { silent: true });
  }
}

export function renderAdminUsers(users) {
  if (!ui.adminUserList) return;
  ui.adminUserList.innerHTML = '';

  if (!Array.isArray(users) || !users.length) {
    if (ui.adminTeachersEmpty) ui.adminTeachersEmpty.hidden = false;
    return;
  }

  if (ui.adminTeachersEmpty) ui.adminTeachersEmpty.hidden = true;

  users.forEach((user) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';
    if (user?.id) card.dataset.teacherId = user.id;
    if (user?.public_id) card.dataset.teacherPublicId = user.public_id;

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = user?.name || 'Usuario';

    const meta = document.createElement('p');
    meta.className = 'role-panel__meta';
    meta.textContent = user?.email || '';

    const details = document.createElement('p');
    details.className = 'role-panel__meta role-panel__meta--muted';
    details.textContent = `ID público: ${user?.public_id || 'N/D'}`;

    const stats = document.createElement('p');
    stats.className = 'role-panel__meta';
    const classCount = typeof user?.class_count === 'number' ? user.class_count : 0;
    const studentCount = typeof user?.student_count === 'number' ? user.student_count : 0;
    stats.textContent = `Clases: ${classCount} · Estudiantes únicos: ${studentCount}`;

    const assignedText = formatDate(user?.assigned_at);
    const assignedNode = assignedText ? document.createElement('p') : null;
    if (assignedNode) {
      assignedNode.className = 'role-panel__meta role-panel__meta--muted';
      assignedNode.textContent = `Asignado el ${assignedText}`;
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(details);
    card.appendChild(stats);
    if (assignedNode) card.appendChild(assignedNode);
    ui.adminUserList.appendChild(card);
  });
}

function formatDate(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (DATE_FORMATTER) return DATE_FORMATTER.format(date);
    return date.toLocaleDateString();
  } catch (err) {
    return '';
  }
}

