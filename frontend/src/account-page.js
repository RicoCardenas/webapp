import { authFetch, toast, getCurrentUser, refreshCurrentUser } from '/static/app.js';
import { qs } from './lib/dom.js';
import { on } from './lib/events.js';
const SESSION_KEY = 'ecuplot_session_token';

let unauthorizedHandled = false;
const teacherState = { bound: false };
const adminState = { bound: false };
const developmentState = { bound: false };

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
  teacherPanel: qs('#teacher-panel'),
  teacherCreateGroupBtn: qs('#teacher-create-group'),
  teacherGroupList: qs('#teacher-group-list'),
  teacherGroupsEmpty: qs('#teacher-groups-empty'),
  adminPanel: qs('#admin-panel'),
  adminUserList: qs('#admin-user-list'),
  adminGroupList: qs('#admin-group-list'),
  adminAssignForm: qs('#admin-assign-teacher-form'),
  adminAssignUserId: qs('#admin-assign-user-id'),
  developmentPanel: qs('#development-panel'),
  developmentAssignForm: qs('#development-assign-admin-form'),
  developmentUserId: qs('#development-user-id'),
  developmentVisibleId: qs('#development-visible-id'),
  developmentRequestId: qs('#development-request-id'),
  developmentBackupBtn: qs('#development-create-backup'),
  developmentRestoreForm: qs('#development-restore-form'),
  developmentBackupName: qs('#development-backup-name'),
  developmentRequestsList: qs('#development-role-requests'),
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
    '#user-role': '—',
    '#user-created-at': '—',
    '#user-status': '—',
  };
  Object.entries(placeholders).forEach(([sel, value]) => {
    const el = qs(sel);
    if (el) el.textContent = value;
  });
  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = 'EC';
  if (ui.historyCount) ui.historyCount.textContent = '—';
  if (ui.historyList) ui.historyList.innerHTML = '';
  if (ui.historyEmpty) {
    ui.historyEmpty.hidden = false;
    const message = qs('p', ui.historyEmpty);
    if (message) message.textContent = 'Inicia sesión para ver tu historial.';
  }
  toggleHistoryPanel(false);
}

function renderAccountDetails(user) {
  if (!user) return;

  unauthorizedHandled = false;
  setAuthVisibility(true);

  const nameEl = qs('#user-name');
  if (nameEl) nameEl.textContent = user.name ?? '—';

  const emailEl = qs('#user-email');
  if (emailEl) emailEl.textContent = user.email ?? '—';

  const roleEl = qs('#user-role');
  if (roleEl) roleEl.textContent = user.role ?? '—';

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

  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = initialsFrom(user.name, user.email);

  renderRolePanels(user);
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

function renderRolePanels(user) {
  hideRolePanels();
  if (!user) return;

  const roles = new Set(
    Array.isArray(user.roles)
      ? user.roles.map((role) => String(role || '').toLowerCase())
      : []
  );
  if (user.role) roles.add(String(user.role).toLowerCase());

  if (roles.has('teacher')) renderTeacherPanel();
  if (roles.has('admin')) renderAdminPanel();
  if (roles.has('development')) renderDevelopmentPanel();
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
      ui.teacherGroupsEmpty.textContent = 'No se pudieron cargar los grupos.';
      ui.teacherGroupsEmpty.hidden = false;
    }
    return;
  }

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar los grupos.');
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

  const header = document.createElement('header');
  header.className = 'role-panel__header';

  const title = document.createElement('h3');
  title.className = 'role-panel__title';
  title.textContent = group?.name || 'Grupo';

  const meta = document.createElement('p');
  meta.className = 'role-panel__meta';
  if (group?.description) {
    meta.textContent = group.description;
  } else {
    meta.textContent = 'Sin descripción';
    meta.classList.add('role-panel__meta--muted');
  }

  header.appendChild(title);
  header.appendChild(meta);

  const membersWrap = document.createElement('div');
  membersWrap.className = 'role-panel__members';

  const membersTitle = document.createElement('h4');
  membersTitle.className = 'role-panel__subtitle';
  membersTitle.textContent = 'Estudiantes';
  membersWrap.appendChild(membersTitle);

  const membersList = document.createElement('ul');
  membersList.className = 'role-panel__members-list';

  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) {
    const empty = document.createElement('li');
    empty.className = 'role-panel__member role-panel__member--empty';
    empty.textContent = 'El grupo no tiene estudiantes asignados.';
    membersList.appendChild(empty);
  } else {
    members.forEach((member) => {
      membersList.appendChild(createTeacherMemberItem(group.id, member));
    });
  }

  membersWrap.appendChild(membersList);

  const form = document.createElement('form');
  form.className = 'role-form role-form--inline';
  form.dataset.groupId = String(group.id || '');
  form.noValidate = true;

  const field = document.createElement('div');
  field.className = 'form__field';

  const inputId = `teacher-add-${group.id}`;
  const label = document.createElement('label');
  label.className = 'form__label';
  label.setAttribute('for', inputId);
  label.textContent = 'Agregar estudiante (visible_id)';

  const input = document.createElement('input');
  input.className = 'form__input';
  input.type = 'text';
  input.id = inputId;
  input.placeholder = 'visible_id';
  input.autocomplete = 'off';

  field.appendChild(label);
  field.appendChild(input);
  form.appendChild(field);

  const actions = document.createElement('div');
  actions.className = 'form__actions';

  const submit = document.createElement('button');
  submit.className = 'btn btn--primary btn--sm';
  submit.type = 'submit';
  submit.textContent = 'Agregar';

  actions.appendChild(submit);
  form.appendChild(actions);

  on(form, 'submit', onTeacherAddMember);

  card.appendChild(header);
  card.appendChild(membersWrap);
  card.appendChild(form);

  return card;
}

function createTeacherMemberItem(groupId, member) {
  const item = document.createElement('li');
  item.className = 'role-panel__member';

  const info = document.createElement('div');
  info.className = 'role-panel__member-info';

  const name = document.createElement('span');
  name.className = 'role-panel__member-name';
  name.textContent = member?.student_name || 'Sin nombre';

  const visible = document.createElement('span');
  visible.className = 'role-panel__member-id';
  visible.textContent = member?.student_visible_id ? `ID: ${member.student_visible_id}` : 'ID no disponible';

  info.appendChild(name);
  info.appendChild(visible);

  const actions = document.createElement('div');
  actions.className = 'role-panel__member-actions';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--ghost btn--sm';
  removeBtn.type = 'button';
  removeBtn.textContent = 'Eliminar';
  removeBtn.dataset.groupId = String(groupId || '');
  removeBtn.dataset.visibleId = String(member?.student_visible_id || '');
  on(removeBtn, 'click', onTeacherRemoveMember);

  actions.appendChild(removeBtn);

  item.appendChild(info);
  item.appendChild(actions);
  return item;
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
    toast?.error?.('Ingresa un ID visible.');
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

function renderAdminPanel() {
  if (!ui.adminPanel) return;
  ui.adminPanel.hidden = false;
  if (!adminState.bound) {
    bindAdminPanel();
    adminState.bound = true;
  }
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
  const input = ui.adminAssignUserId;
  if (!(input instanceof HTMLInputElement)) return;
  const userId = input.value.trim();
  if (!userId) {
    toast?.error?.('Ingresa el ID del usuario.');
    return;
  }

  const submit = ui.adminAssignForm?.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  input.disabled = true;

  handleAdminAssignTeacher(userId).finally(() => {
    input.disabled = false;
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleAdminAssignTeacher(userId) {
  const res = await requestWithAuth(`/api/admin/users/${userId}/assign-teacher`, {
    method: 'POST',
  });
  if (!res) return;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo asignar el rol docente.');
    return;
  }

  toast?.success?.('Rol docente asignado.');
  ui.adminAssignUserId?.value && (ui.adminAssignUserId.value = '');
  loadAdminUsers();
  loadAdminGroups();
}

async function loadAdminUsers() {
  if (!ui.adminUserList) return;
  ui.adminUserList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando usuarios...';
  ui.adminUserList.appendChild(loading);

  const res = await requestWithAuth('/api/admin/teachers');
  if (!res) return;

  if (!res.ok) {
    toast?.error?.('No se pudo obtener el listado de usuarios.');
    ui.adminUserList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudo cargar el listado de usuarios.';
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
    details.textContent = `ID: ${user?.id || 'N/D'} | visible_id: ${user?.public_id || 'N/D'}`;

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

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar los grupos.');
    ui.adminGroupList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar los grupos.';
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
    toast?.error?.('Ingresa el ID del usuario o su ID visible.');
    return;
  }

  const submit = ui.developmentAssignForm?.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = true;

  handleDevelopmentAssignAdmin({ user_id: userId || undefined, visible_id: visibleId || undefined, request_id: requestId || undefined }).finally(() => {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  });
}

async function handleDevelopmentAssignAdmin(payload) {
  const res = await requestWithAuth('/development/users/assign-admin', {
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
  const res = await requestWithAuth('/development/backups/run', {
    method: 'POST',
  });
  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo iniciar el backup.');
    return;
  }
  const data = await res.json().catch(() => ({}));
  toast?.success?.(data?.message || 'Backup encolado.');
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
  const res = await requestWithAuth('/development/backups/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup_name: backupName || undefined }),
  });
  if (!res) return;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast?.error?.(err?.error || 'No se pudo iniciar la restauración.');
    return;
  }
  const data = await res.json().catch(() => ({}));
  toast?.success?.(data?.message || 'Restauración encolada.');
}

async function loadDevelopmentRequests() {
  if (!ui.developmentRequestsList) return;
  ui.developmentRequestsList.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'role-panel__meta';
  loading.textContent = 'Cargando solicitudes...';
  ui.developmentRequestsList.appendChild(loading);

  const res = await requestWithAuth('/development/role-requests');
  if (!res) {
    ui.developmentRequestsList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar las solicitudes.';
    ui.developmentRequestsList.appendChild(errorMsg);
    return;
  }
  if (!res.ok) {
    toast?.error?.('No se pudieron cargar las solicitudes de roles.');
    ui.developmentRequestsList.innerHTML = '';
    const errorMsg = document.createElement('p');
    errorMsg.className = 'role-panel__empty';
    errorMsg.textContent = 'No se pudieron cargar las solicitudes.';
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
    const visible = req?.user?.public_id ? `visible_id: ${req.user.public_id}` : 'visible_id: N/D';
    details.textContent = `${visible} | ID solicitud: ${req?.id || 'N/D'}`;

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
  const res = await requestWithAuth(`/development/role-requests/${requestId}/resolve`, {
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
  const res = await requestWithAuth('/api/plot/history?limit=100');
  if (ui.historyLoading) ui.historyLoading.hidden = true;

  if (!res) return;

  if (!res.ok) {
    toast?.error?.('No se pudo cargar el historial de gráficas.');
    if (ui.historyEmpty) {
      ui.historyEmpty.hidden = false;
      const message = qs('p', ui.historyEmpty);
      if (message) message.textContent = 'Error al cargar el historial.';
    }
    return;
  }

  const data = await res.json().catch(() => ({}));
  const items = data?.items || [];

  if (ui.historyCount) {
    ui.historyCount.textContent = items.length === 1 ? '1 registro' : `${items.length} registros`;
  }

  if (!items.length) {
    if (ui.historyEmpty) ui.historyEmpty.hidden = false;
    return;
  }

  if (ui.historyEmpty) ui.historyEmpty.hidden = true;
  if (ui.historyList) ui.historyList.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const date = item?.created_at
      ? new Date(item.created_at).toLocaleString('es-CO', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    li.innerHTML = `
      <span class="history-expr">${item?.expression ?? ''}</span>
      <span class="history-date">${date}</span>
    `;
    ui.historyList?.appendChild(li);
  });
}

function initAccountPage() {
  bindHistoryToggle();
  bindGuestOverlay();
  const hasToken = Boolean(localStorage.getItem(SESSION_KEY));
  if (!hasToken) {
    handleUnauthorized(false);
    return;
  }
  loadAccountDetails();
  loadPlotHistory();
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
});
