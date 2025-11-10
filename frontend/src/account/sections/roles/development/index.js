import { on } from '../../../../lib/events.js';
import { ui } from '../../../ui.js';
import { developmentState } from '../../../state.js';
import { ensureOpsPaginationBindings, ensureOpsSubscription, loadOperationsSummary, clearOpsSubscription, resetOpsUI } from './ops.js';
import { bindAdmins, loadDevelopmentAdmins } from './admins.js';
import { bindBackups } from './backups.js';
import { loadDevelopmentRequests, bindRequests } from './requests.js';

export function createDevelopmentController({ dashboard }) {
  function renderPanel() {
    if (!ui.developmentPanel) return;
    ui.developmentPanel.dataset.roleAvailable = 'true';
    const hiddenByLayout = dashboard.isPanelHidden('development');
    ui.developmentPanel.hidden = hiddenByLayout;
    if (hiddenByLayout) ui.developmentPanel.setAttribute('aria-hidden', 'true');
    else ui.developmentPanel.removeAttribute('aria-hidden');

    if (!developmentState.bound) {
      bind();
      developmentState.bound = true;
    }
    loadDevelopmentAdmins();
    loadDevelopmentRequests();
    loadOperationsSummary({ fetch: true });
    ensureOpsSubscription();
  }

  function bind() {
    bindAdmins();
    bindBackups();
    bindRequests();
    ensureOpsPaginationBindings();
  }

  function reset() {
    if (ui.developmentPanel) {
      ui.developmentPanel.dataset.roleAvailable = 'false';
      ui.developmentPanel.hidden = true;
    }
    if (ui.developmentRequestsList) ui.developmentRequestsList.innerHTML = '';
    resetOpsUI();
  }

  function teardown() {
    clearOpsSubscription();
  }

  return { renderPanel, reset, teardown };
}

