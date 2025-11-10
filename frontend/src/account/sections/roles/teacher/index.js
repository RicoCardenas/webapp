import { toast } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { teacherState } from '../../../state.js';

export function createTeacherController({ dashboard }) {
  function renderPanel() {
    if (!ui.teacherPanel) return;
    ui.teacherPanel.dataset.roleAvailable = 'true';
    const hiddenByLayout = dashboard.isPanelHidden('teacher');
    ui.teacherPanel.hidden = hiddenByLayout;
    if (hiddenByLayout) ui.teacherPanel.setAttribute('aria-hidden', 'true');
    else ui.teacherPanel.removeAttribute('aria-hidden');

    if (!teacherState.bound) {
      bindPanel();
      teacherState.bound = true;
    }
    loadGroups();
  }

  function bindPanel() {
    if (ui.teacherCreateGroupBtn) {
      on(ui.teacherCreateGroupBtn, 'click', () => {
        handleCreateGroup();
      });
    }
  }

  async function handleCreateGroup() {
    if (teacherState.creating) return;
    teacherState.creating = true;
    const button = ui.teacherCreateGroupBtn;
    const defaultLabel = button?.textContent || 'Crear grupo';
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.textContent = 'Creando...';
    }
    try {
      const res = await requestWithAuth('/api/groups', { method: 'POST' });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast?.error?.(data?.error || 'No se pudo crear el grupo.');
        return;
      }
      toast?.success?.(data?.message || 'Grupo creado.');
      await loadGroups();
    } finally {
      teacherState.creating = false;
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = defaultLabel;
      }
    }
  }

  async function loadGroups() {
    if (!ui.teacherGroupList) return;
    ui.teacherGroupList.setAttribute('aria-busy', 'true');
    try {
      const res = await requestWithAuth('/api/groups');
      if (!res) return;
      if (!res.ok) {
        toast?.error?.('No se pudieron cargar tus grupos.');
        renderGroups([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      renderGroups(groups);
    } finally {
      ui.teacherGroupList.setAttribute('aria-busy', 'false');
    }
  }

  function renderGroups(groups) {
    if (!ui.teacherGroupList) return;
    ui.teacherGroupList.replaceChildren();
    if (!Array.isArray(groups) || groups.length === 0) {
      if (ui.teacherGroupsEmpty) {
        ui.teacherGroupsEmpty.textContent = 'Aún no has creado grupos.';
        ui.teacherGroupsEmpty.hidden = false;
      }
      return;
    }
    if (ui.teacherGroupsEmpty) ui.teacherGroupsEmpty.hidden = true;
    groups.forEach((group) => {
      const card = createGroupCard(group);
      if (card) ui.teacherGroupList.appendChild(card);
    });
  }

  function createGroupCard(group) {
    if (!group) return null;
    const card = document.createElement('article');
    card.className = 'teacher-group';
    card.dataset.groupId = String(group?.id || '');

    const header = document.createElement('header');
    header.className = 'teacher-group__header';
    const title = document.createElement('h3');
    title.textContent = group?.name || `Grupo ${group?.id || ''}`;
    header.appendChild(title);
    card.appendChild(header);

    const table = document.createElement('table');
    table.className = 'role-panel__table teacher-group__table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['#', 'Estudiante', 'ID público', ''].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const members = Array.isArray(group?.members) ? group.members : [];
    if (members.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.textContent = 'Aún no hay estudiantes en este grupo.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    } else {
      members.forEach((member, index) => {
        tbody.appendChild(createMemberRow(group.id, member, index));
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

    on(form, 'submit', onAddMember);

    card.appendChild(table);
    card.appendChild(form);

    return card;
  }

  function createMemberRow(groupId, member, index) {
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
    on(removeBtn, 'click', onRemoveMember);

    actionsCell.appendChild(removeBtn);
    row.appendChild(actionsCell);

    return row;
  }

  function onAddMember(event) {
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

    handleAddMember(groupId, visibleId).finally(() => {
      input.disabled = false;
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    });
  }

  async function handleAddMember(groupId, visibleId) {
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
    await loadGroups();
  }

  function onRemoveMember(event) {
    event.preventDefault();
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    const groupId = button.dataset.groupId;
    const visibleId = button.dataset.visibleId;
    if (!groupId || !visibleId) return;
    handleRemoveMember(groupId, visibleId, button);
  }

  async function handleRemoveMember(groupId, visibleId, button) {
    const defaultLabel = button?.textContent || 'Eliminar';
    if (button) button.disabled = true;
    if (button) button.textContent = 'Eliminando...';
    try {
      const res = await requestWithAuth(`/api/groups/${groupId}/members/${encodeURIComponent(visibleId)}`, {
        method: 'DELETE',
      });
      if (!res) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast?.error?.(err?.error || 'No se pudo eliminar el estudiante.');
        return;
      }
      toast?.success?.('Estudiante eliminado.');
      await loadGroups();
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = defaultLabel;
      }
    }
  }

  function reset() {
    if (ui.teacherPanel) {
      ui.teacherPanel.dataset.roleAvailable = 'false';
      ui.teacherPanel.hidden = true;
    }
    if (ui.teacherGroupList) ui.teacherGroupList.innerHTML = '';
    if (ui.teacherGroupsEmpty) {
      ui.teacherGroupsEmpty.textContent = 'Aún no has creado grupos.';
      ui.teacherGroupsEmpty.hidden = true;
    }
  }

  return {
    renderPanel,
    reset,
  };
}
