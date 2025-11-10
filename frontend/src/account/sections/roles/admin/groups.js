import { toast } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { adminState } from '../../../state.js';

const DATE_FORMATTER = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
  ? Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
  : null;

export function bindAdminGroups() {
  if (ui.adminToggleCreateGroup) on(ui.adminToggleCreateGroup, 'click', () => toggleCreateGroup(true));
  const cancelCreate = ui.adminCreateGroupForm?.querySelector('[data-admin-cancel-create]');
  if (cancelCreate) on(cancelCreate, 'click', (event) => {
    event.preventDefault();
    toggleCreateGroup(false);
  });
  if (ui.adminCreateGroupForm) on(ui.adminCreateGroupForm, 'submit', onCreateGroupSubmit);
  if (ui.adminGroupList) on(ui.adminGroupList, 'click', onGroupListClick);
  if (ui.adminGroupClose) on(ui.adminGroupClose, 'click', hideGroupDetail);
  if (ui.adminGroupDelete) on(ui.adminGroupDelete, 'click', onDeleteGroup);
  if (ui.adminGroupAddTeacherForm) on(ui.adminGroupAddTeacherForm, 'submit', onAddTeacherToGroup);
  if (ui.adminGroupDetailTeachers) on(ui.adminGroupDetailTeachers, 'click', onTeacherListClick);
}

function toggleCreateGroup(forceOpen) {
  if (!ui.adminCreateGroupForm) return;
  const shouldShow = Boolean(forceOpen ?? ui.adminCreateGroupForm.hidden);
  ui.adminCreateGroupForm.hidden = !shouldShow;
  adminState.creatingGroup = shouldShow;
  if (!shouldShow && ui.adminCreateGroupFeedback) ui.adminCreateGroupFeedback.textContent = '';
  if (!shouldShow) {
    if (ui.adminGroupName instanceof HTMLInputElement) ui.adminGroupName.value = '';
    if (ui.adminGroupDescription instanceof HTMLTextAreaElement) ui.adminGroupDescription.value = '';
  } else if (ui.adminGroupName instanceof HTMLInputElement) {
    ui.adminGroupName.focus();
  }
}

async function onCreateGroupSubmit(event) {
  event.preventDefault();
  if (!ui.adminGroupName) return;
  const name = ui.adminGroupName instanceof HTMLInputElement ? ui.adminGroupName.value.trim() : '';
  const description = ui.adminGroupDescription instanceof HTMLTextAreaElement ? ui.adminGroupDescription.value.trim() : '';

  if (name.length < 2) {
    setCreateGroupFeedback('El nombre debe tener al menos 2 caracteres.');
    return;
  }

  setCreateGroupFeedback('Creando grupo...', true);

  const res = await requestWithAuth('/api/admin/my-teacher-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });

  if (!res) {
    setCreateGroupFeedback('No se pudo crear el grupo. Intenta nuevamente.', false, true);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setCreateGroupFeedback(err?.error || 'No se pudo crear el grupo.', false, true);
    return;
  }

  toast?.success?.('Grupo creado.');
  toggleCreateGroup(false);
  await loadAdminGroups();
}

function setCreateGroupFeedback(message, isLoading = false, isError = false) {
  if (!ui.adminCreateGroupFeedback) return;
  ui.adminCreateGroupFeedback.textContent = message || '';
  ui.adminCreateGroupFeedback.dataset.state = isLoading ? 'loading' : isError ? 'error' : 'idle';
}

function onGroupListClick(event) {
  const trigger = event.target instanceof HTMLElement ? event.target.closest('[data-admin-group-id]') : null;
  if (!trigger) return;
  const groupId = trigger.getAttribute('data-admin-group-id');
  if (!groupId || adminState.loadingGroupDetail) return;
  loadAdminGroupDetail(groupId);
}

function hideGroupDetail() {
  if (ui.adminGroupDetail) ui.adminGroupDetail.hidden = true;
  if (ui.adminGroupDetailTeachers) ui.adminGroupDetailTeachers.innerHTML = '';
  if (ui.adminGroupDetailStudents) ui.adminGroupDetailStudents.innerHTML = '';
  if (ui.adminGroupTeachersEmpty) ui.adminGroupTeachersEmpty.hidden = true;
  if (ui.adminGroupStudentsEmpty) ui.adminGroupStudentsEmpty.hidden = true;
  if (ui.adminGroupDetailName) ui.adminGroupDetailName.textContent = 'Grupo';
  if (ui.adminGroupDetailDescription) ui.adminGroupDetailDescription.textContent = '';
  if (ui.adminGroupDetailMeta) ui.adminGroupDetailMeta.textContent = '';
  if (ui.adminGroupDelete) delete ui.adminGroupDelete.dataset.adminGroupId;
  adminState.selectedGroupId = null;
  adminState.groupDetail = null;
  populateGroupTeacherSelect(null);
}

export async function loadAdminGroups() {
  if (!ui.adminGroupList) return;

  adminState.loadingGroups = true;
  ui.adminGroupList.innerHTML = '';
  if (ui.adminGroupsEmpty) ui.adminGroupsEmpty.hidden = true;

  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando grupos...';
  ui.adminGroupList.appendChild(loading);

  const res = await requestWithAuth('/api/admin/my-teacher-groups');
  adminState.loadingGroups = false;
  ui.adminGroupList.innerHTML = '';

  if (!res) {
    renderAdminGroups([]);
    toast?.error?.('No se pudo cargar el listado de grupos.');
    return;
  }

  if (res.status === 403) {
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'Esta sección está limitada a cuentas con rol administrador.';
    ui.adminGroupList.appendChild(errorMsg);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudieron cargar los grupos.');
    renderAdminGroups([]);
    return;
  }

  const data = await res.json().catch(() => ({}));
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  adminState.groups = groups;
  renderAdminGroups(groups);

  if (adminState.selectedGroupId) {
    const stillExists = groups.some((group) => group?.id === adminState.selectedGroupId);
    if (stillExists) await loadAdminGroupDetail(adminState.selectedGroupId, { silent: true });
    else hideGroupDetail();
  }
}

export function renderAdminGroups(groups) {
  if (!ui.adminGroupList) return;
  ui.adminGroupList.innerHTML = '';

  if (!Array.isArray(groups) || !groups.length) {
    if (ui.adminGroupsEmpty) ui.adminGroupsEmpty.hidden = false;
    return;
  }

  if (ui.adminGroupsEmpty) ui.adminGroupsEmpty.hidden = true;

  groups.forEach((group) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';
    card.dataset.adminGroupId = group?.id ?? '';

    const title = document.createElement('h3');
    title.className = 'role-panel__title';
    title.textContent = group?.name || `Grupo ${group?.id || ''}`;

    const summary = document.createElement('p');
    summary.className = 'role-panel__meta';
    const teacherCount = typeof group?.teacher_count === 'number' ? group.teacher_count : 0;
    const studentCount = typeof group?.student_count === 'number' ? group.student_count : 0;
    summary.textContent = `Docentes: ${teacherCount} · Estudiantes: ${studentCount}`;

    if (group?.description) {
      const description = document.createElement('p');
      description.className = 'role-panel__meta role-panel__meta--muted';
      description.textContent = group.description;
      card.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'role-panel__actions';
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn btn--ghost btn--sm';
    viewBtn.textContent = 'Ver detalle';
    viewBtn.setAttribute('data-admin-group-id', group?.id ?? '');
    actions.appendChild(viewBtn);

    card.appendChild(title);
    card.appendChild(summary);
    card.appendChild(actions);
    ui.adminGroupList.appendChild(card);
  });
}

export async function loadAdminGroupDetail(groupId, { silent = false } = {}) {
  if (!groupId) return;
  adminState.loadingGroupDetail = true;
  if (!silent && ui.adminGroupDetail) {
    ui.adminGroupDetail.hidden = false;
    ui.adminGroupDetail.setAttribute('aria-busy', 'true');
  }

  const res = await requestWithAuth(`/api/admin/my-teacher-groups/${groupId}`);
  adminState.loadingGroupDetail = false;
  if (ui.adminGroupDetail) ui.adminGroupDetail.removeAttribute('aria-busy');

  if (!res) {
    toast?.error?.('No se pudo cargar el detalle del grupo.');
    return;
  }

  if (res.status === 404) {
    toast?.error?.('El grupo ya no está disponible.');
    hideGroupDetail();
    await loadAdminGroups();
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo obtener la información del grupo.');
    return;
  }

  const data = await res.json().catch(() => ({}));
  const detail = data?.group;
  adminState.groupDetail = detail || null;
  adminState.selectedGroupId = detail?.id || null;
  renderAdminGroupDetail(detail);
}

function renderAdminGroupDetail(detail) {
  if (!ui.adminGroupDetail) return;

  if (!detail) {
    hideGroupDetail();
    return;
  }

  ui.adminGroupDetail.hidden = false;
  if (ui.adminGroupDetailName) ui.adminGroupDetailName.textContent = detail.name || 'Grupo';

  if (ui.adminGroupDetailDescription) {
    if (detail.description) {
      ui.adminGroupDetailDescription.textContent = detail.description;
      ui.adminGroupDetailDescription.hidden = false;
    } else {
      ui.adminGroupDetailDescription.textContent = '';
      ui.adminGroupDetailDescription.hidden = true;
    }
  }

  if (ui.adminGroupDetailMeta) {
    const teacherCount = typeof detail.teacher_count === 'number' ? detail.teacher_count : 0;
    const studentCount = typeof detail.student_count === 'number' ? detail.student_count : 0;
    const createdAt = formatDate(detail.created_at);
    const metaParts = [`Docentes: ${teacherCount}`, `Estudiantes únicos: ${studentCount}`];
    if (createdAt) metaParts.push(`Creado el ${createdAt}`);
    ui.adminGroupDetailMeta.textContent = metaParts.join(' · ');
  }

  if (ui.adminGroupDelete) ui.adminGroupDelete.dataset.adminGroupId = detail.id || '';

  populateGroupTeacherSelect(detail);
  renderGroupTeachers(detail);
  renderGroupStudents(detail);
}

function renderGroupTeachers(detail) {
  if (!ui.adminGroupDetailTeachers) return;
  ui.adminGroupDetailTeachers.innerHTML = '';

  const teachers = Array.isArray(detail?.teachers) ? detail.teachers : [];
  if (!teachers.length) {
    if (ui.adminGroupTeachersEmpty) ui.adminGroupTeachersEmpty.hidden = false;
    return;
  }

  if (ui.adminGroupTeachersEmpty) ui.adminGroupTeachersEmpty.hidden = true;

  teachers.forEach((teacher) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';
    card.dataset.teacherId = teacher?.id ?? '';

    const title = document.createElement('h4');
    title.className = 'role-panel__title';
    title.textContent = teacher?.name || 'Docente';

    const email = document.createElement('p');
    email.className = 'role-panel__meta';
    email.textContent = teacher?.email || '';

    const meta = document.createElement('p');
    meta.className = 'role-panel__meta';
    const classCount = typeof teacher?.class_count === 'number' ? teacher.class_count : 0;
    const studentCount = typeof teacher?.student_count === 'number' ? teacher.student_count : 0;
    meta.textContent = `Clases: ${classCount} · Estudiantes únicos: ${studentCount}`;

    const assigned = teacher?.added_at ? document.createElement('p') : null;
    if (assigned) {
      assigned.className = 'role-panel__meta role-panel__meta--muted';
      assigned.textContent = `Agregado el ${formatDate(teacher.added_at)}`;
    }

    const footer = document.createElement('div');
    footer.className = 'role-panel__actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--ghost btn--sm';
    removeBtn.textContent = 'Quitar';
    removeBtn.setAttribute('data-remove-teacher-id', teacher?.id ?? '');
    footer.appendChild(removeBtn);

    card.appendChild(title);
    card.appendChild(email);
    card.appendChild(meta);
    if (assigned) card.appendChild(assigned);
    card.appendChild(footer);
    ui.adminGroupDetailTeachers.appendChild(card);
  });
}

function renderGroupStudents(detail) {
  if (!ui.adminGroupDetailStudents) return;
  ui.adminGroupDetailStudents.innerHTML = '';

  const students = Array.isArray(detail?.students) ? detail.students : [];
  if (!students.length) {
    if (ui.adminGroupStudentsEmpty) ui.adminGroupStudentsEmpty.hidden = false;
    return;
  }

  if (ui.adminGroupStudentsEmpty) ui.adminGroupStudentsEmpty.hidden = true;

  students.forEach((student) => {
    const card = document.createElement('article');
    card.className = 'role-panel__card';

    const title = document.createElement('h4');
    title.className = 'role-panel__title';
    title.textContent = student?.name || 'Estudiante';

    const email = document.createElement('p');
    email.className = 'role-panel__meta';
    email.textContent = student?.email || '';

    const detailLine = document.createElement('p');
    detailLine.className = 'role-panel__meta role-panel__meta--muted';
    detailLine.textContent = `ID público: ${student?.public_id || 'N/D'}`;

    card.appendChild(title);
    card.appendChild(email);
    card.appendChild(detailLine);
    const enrollments = Array.isArray(student?.enrollments) ? student.enrollments : [];
    if (enrollments.length) {
      enrollments.forEach((enrollment) => {
        const item = document.createElement('p');
        item.className = 'role-panel__meta role-panel__meta--muted';
        const teacherName = enrollment?.teacher_name || 'Docente';
        const className = enrollment?.class_name || 'Grupo';
        item.textContent = `${className} · ${teacherName}`;
        card.appendChild(item);
      });
    }
    ui.adminGroupDetailStudents.appendChild(card);
  });
}

function populateGroupTeacherSelect(detail) {
  if (!(ui.adminGroupTeacherSelect instanceof HTMLSelectElement)) return;
  const teachers = Array.isArray(adminState.teachers) ? adminState.teachers : [];
  const assigned = new Set(Array.isArray(detail?.teacher_ids) ? detail.teacher_ids : []);

  ui.adminGroupTeacherSelect.innerHTML = '';

  const available = teachers.filter((teacher) => teacher?.id && !assigned.has(teacher.id));

  if (!available.length) {
    const option = new Option('Sin docentes disponibles', '', true, true);
    option.disabled = true;
    ui.adminGroupTeacherSelect.appendChild(option);
    ui.adminGroupTeacherSelect.disabled = true;
    ui.adminGroupTeacherSelect.value = '';
    return;
  }

  ui.adminGroupTeacherSelect.disabled = false;
  const placeholder = new Option('Selecciona un docente', '', true, true);
  placeholder.disabled = true;
  ui.adminGroupTeacherSelect.appendChild(placeholder);

  available.forEach((teacher) => {
    const option = new Option(teacher.name || teacher.public_id || 'Docente', teacher.id);
    ui.adminGroupTeacherSelect.appendChild(option);
  });
  ui.adminGroupTeacherSelect.value = '';
}

async function onAddTeacherToGroup(event) {
  event.preventDefault();
  if (!(ui.adminGroupTeacherSelect instanceof HTMLSelectElement)) return;
  const teacherId = ui.adminGroupTeacherSelect.value;
  const groupId = adminState.selectedGroupId;
  if (!teacherId || !groupId) {
    toast?.error?.('Selecciona un docente válido.');
    return;
  }

  ui.adminGroupTeacherSelect.disabled = true;

  const res = await requestWithAuth(`/api/admin/my-teacher-groups/${groupId}/teachers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher_id: teacherId }),
  });

  ui.adminGroupTeacherSelect.disabled = false;

  if (!res) {
    toast?.error?.('No se pudo agregar el docente.');
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo agregar el docente.');
    return;
  }

  toast?.success?.('Docente agregado al grupo.');
  await loadAdminGroupDetail(groupId, { silent: true });
  await loadAdminGroups();
}

function onTeacherListClick(event) {
  const button = event.target instanceof HTMLElement ? event.target.closest('button[data-remove-teacher-id]') : null;
  if (!button) return;
  const teacherId = button.getAttribute('data-remove-teacher-id');
  if (!teacherId) return;
  removeTeacherFromGroup(teacherId);
}

async function removeTeacherFromGroup(teacherId) {
  const groupId = adminState.selectedGroupId;
  if (!groupId) return;

  const res = await requestWithAuth(`/api/admin/my-teacher-groups/${groupId}/teachers/${teacherId}`, {
    method: 'DELETE',
  });

  if (!res) {
    toast?.error?.('No se pudo quitar el docente.');
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo quitar el docente.');
    return;
  }

  toast?.success?.('Docente eliminado del grupo.');
  await loadAdminGroupDetail(groupId, { silent: true });
  await loadAdminGroups();
}

async function onDeleteGroup() {
  const groupId = adminState.selectedGroupId;
  if (!groupId) return;

  const confirmed = window.confirm?.('¿Eliminar este grupo de docentes?');
  if (!confirmed) return;

  const res = await requestWithAuth(`/api/admin/my-teacher-groups/${groupId}`, {
    method: 'DELETE',
  });

  if (!res) {
    toast?.error?.('No se pudo eliminar el grupo.');
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo eliminar el grupo.');
    return;
  }

  toast?.success?.('Grupo eliminado.');
  hideGroupDetail();
  await loadAdminGroups();
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

