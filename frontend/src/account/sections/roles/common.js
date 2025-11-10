import { ui } from '../../ui.js';

export function getNormalizedRoles(user) {
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

export function hideRolePanels() {
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

