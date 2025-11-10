import { ui } from '../../../ui.js';
import { adminState, accountState } from '../../../state.js';
import { loadAdminStats } from './stats.js';
import { bindAdminUsers, loadAdminUsers } from './users.js';
import { bindAdminGroups, loadAdminGroups } from './groups.js';

export function createAdminController({ dashboard }) {
  function renderPanel() {
    if (!ui.adminPanel) return;
    ui.adminPanel.dataset.roleAvailable = 'true';
    const hiddenByLayout = dashboard.isPanelHidden('admin');
    ui.adminPanel.hidden = hiddenByLayout;
    if (hiddenByLayout) ui.adminPanel.setAttribute('aria-hidden', 'true');
    else ui.adminPanel.removeAttribute('aria-hidden');

    const hasAdminRole = accountState.roles instanceof Set && accountState.roles.has('admin');
    const hasDevelopmentRole = accountState.roles instanceof Set && accountState.roles.has('development');

    if (!hasAdminRole) {
      hidePanel();
      return;
    }

    if (!adminState.bound) {
      bind();
      adminState.bound = true;
    }

    if (hiddenByLayout) return;

    loadAdminUsers();
    loadAdminGroups();
    if (hasDevelopmentRole) {
      if (ui.adminStats) {
        ui.adminStats.hidden = false;
        ui.adminStats.removeAttribute('aria-hidden');
      }
      loadAdminStats();
    } else if (ui.adminStats) {
      ui.adminStats.hidden = true;
      ui.adminStats.setAttribute('aria-hidden', 'true');
    }
  }

  function bind() {
    bindAdminUsers();
    bindAdminGroups();
  }

  function hidePanel() {
    if (!ui.adminPanel) return;
    ui.adminPanel.dataset.roleAvailable = 'false';
    ui.adminPanel.hidden = true;
    ui.adminPanel.setAttribute('aria-hidden', 'true');
  }

  function reset() {
    hidePanel();
    if (ui.adminUserList) ui.adminUserList.innerHTML = '';
    if (ui.adminTeachersEmpty) ui.adminTeachersEmpty.hidden = true;
    if (ui.adminGroupList) ui.adminGroupList.innerHTML = '';
    if (ui.adminGroupsEmpty) ui.adminGroupsEmpty.hidden = true;
    if (ui.adminGroupDetail) ui.adminGroupDetail.hidden = true;
    if (ui.adminStats) ui.adminStats.hidden = true;
    adminState.teachers = [];
    adminState.groups = [];
    adminState.selectedGroupId = null;
    adminState.groupDetail = null;
  }

  return { renderPanel, reset };
}

