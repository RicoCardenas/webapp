import { toast } from '/static/app.js';
import { ui } from '../../ui.js';
import { adminRequestState } from '../../state.js';
import { hideRolePanels, getNormalizedRoles } from './common.js';
import { createTeacherController } from './teacher/index.js';
import { createAdminController } from './admin/index.js';
import { resetAdminStats } from './admin/stats.js';
import { createDevelopmentController } from './development/index.js';
import { bindAdminRequestSection, loadAdminRequestStatus, updateAdminRequestStatus, resetAdminRequestUI } from './admin-request.js';

export { getNormalizedRoles } from './common.js';

export function createRolesSection({ dashboard }) {
  const teacher = createTeacherController({ dashboard });
  const admin = createAdminController({ dashboard });
  const development = createDevelopmentController({ dashboard });

  function renderPanels(user, rolesSet) {
    hideRolePanels();
    if (!user) return;
    const roles = rolesSet ?? getNormalizedRoles(user);
    if (roles.has('teacher')) teacher.renderPanel();
    if (roles.has('admin')) admin.renderPanel();
    if (roles.has('development')) development.renderPanel();
  }

  function renderAdminRequestSection(user, rolesSet) {
    if (!ui.adminRequestBox) return;
    const roles = rolesSet ?? getNormalizedRoles(user);
    const hasElevatedRole = roles.has('admin') || roles.has('development');
    const shouldShow = Boolean(user) && !hasElevatedRole;
    ui.adminRequestBox.hidden = !shouldShow;
    if (!shouldShow) {
      updateAdminRequestStatus('none');
      return;
    }
    if (!adminRequestState.bound) {
      bindAdminRequestSection();
      adminRequestState.bound = true;
    }
    loadAdminRequestStatus();
  }

  function reset() {
    hideRolePanels();
    admin.reset();
    teacher.reset();
    development.reset();
    resetAdminRequestUI();
    resetAdminStats();
  }

  function teardown() {
    development.teardown();
  }

  return {
    hidePanels: hideRolePanels,
    renderPanels,
    renderAdminRequestSection,
    loadAdminRequestStatus,
    reset,
    teardown,
  };
}
