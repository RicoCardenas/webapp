import { toast } from '/static/app.js';
import { on } from '../lib/events.js';
import { accountState, dashboardState } from './state.js';
import { openModal, closeModal } from './utils.js';
import { ui } from './ui.js';

const DASHBOARD_WIDGET_META = {
  stats: { id: 'account-details-box', label: 'Resumen' },
  history: { id: 'account-history-box', label: 'Historial' },
  notifications: { id: 'account-notifications-box', label: 'Notificaciones' },
  tickets: { id: 'account-tickets-box', label: 'Solicitudes' },
  security: { id: 'account-2fa-box', label: 'Seguridad' },
  learning: { id: 'account-learning-box', label: 'Aprendizaje' },
};

const DEFAULT_DASHBOARD_LAYOUT = {
  order: Object.keys(DASHBOARD_WIDGET_META),
  hidden: [],
  hiddenPanels: [],
};

const DASHBOARD_ROLE_WIDGETS = {
  teacher: { id: 'teacher-panel', label: 'Panel docente', role: 'teacher' },
  admin: { id: 'admin-panel', label: 'Panel administrador', role: 'admin' },
  development: { id: 'development-panel', label: 'Panel desarrollo', role: 'development' },
};

function getDashboardStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('[account] No se pudo acceder a localStorage para el panel.', error);
    return null;
  }
}

function computeDashboardStorageKey(user, rolesSet) {
  const roles = rolesSet instanceof Set ? Array.from(rolesSet) : Array.from(new Set(rolesSet || []));
  const rolesKey = roles.length ? roles.sort().join('|') : 'default';
  const baseKey = user?.id != null
    ? `id:${user.id}`
    : user?.public_id
      ? `pub:${user.public_id}`
      : user?.email
        ? `mail:${user.email}`
        : 'guest';
  return `ecuplot:dashboard:${baseKey}:${rolesKey}`;
}

function normalizeDashboardLayout(input = {}) {
  const normalized = {
    order: [],
    hidden: [],
    hiddenPanels: [],
  };

  const baseKeys = Object.keys(DASHBOARD_WIDGET_META);
  const orderSource = Array.isArray(input.order) ? input.order : [];
  orderSource.forEach((key) => {
    if (!DASHBOARD_WIDGET_META[key]) return;
    if (!normalized.order.includes(key)) normalized.order.push(key);
  });
  baseKeys.forEach((key) => {
    if (!normalized.order.includes(key)) normalized.order.push(key);
  });

  const hiddenSet = new Set();
  if (Array.isArray(input.hidden)) {
    input.hidden.forEach((key) => {
      if (DASHBOARD_WIDGET_META[key]) hiddenSet.add(key);
    });
  }
  normalized.hidden = Array.from(hiddenSet);

  const panelSet = new Set();
  if (Array.isArray(input.hiddenPanels)) {
    input.hiddenPanels.forEach((key) => {
      if (DASHBOARD_ROLE_WIDGETS[key]) panelSet.add(key);
    });
  }
  normalized.hiddenPanels = Array.from(panelSet);

  return normalized;
}

function getDefaultDashboardLayout() {
  return normalizeDashboardLayout({
    order: [...DEFAULT_DASHBOARD_LAYOUT.order],
    hidden: [...DEFAULT_DASHBOARD_LAYOUT.hidden],
    hiddenPanels: [...DEFAULT_DASHBOARD_LAYOUT.hiddenPanels],
  });
}

function cloneDashboardLayout(layout) {
  if (!layout) return getDefaultDashboardLayout();
  return normalizeDashboardLayout({
    order: Array.isArray(layout.order) ? [...layout.order] : [...DEFAULT_DASHBOARD_LAYOUT.order],
    hidden: Array.isArray(layout.hidden) ? [...layout.hidden] : [...DEFAULT_DASHBOARD_LAYOUT.hidden],
    hiddenPanels: Array.isArray(layout.hiddenPanels) ? [...layout.hiddenPanels] : [...DEFAULT_DASHBOARD_LAYOUT.hiddenPanels],
  });
}

function loadDashboardLayout(key) {
  if (!key) return getDefaultDashboardLayout();
  const storage = getDashboardStorage();
  if (!storage) return getDefaultDashboardLayout();
  const raw = storage.getItem(key);
  if (!raw) return getDefaultDashboardLayout();
  try {
    const parsed = JSON.parse(raw);
    return normalizeDashboardLayout(parsed);
  } catch (error) {
    console.warn('[account] No se pudo parsear la configuración del panel.', error);
    return getDefaultDashboardLayout();
  }
}

function saveDashboardLayout(layout) {
  if (!dashboardState.key) return;
  const storage = getDashboardStorage();
  if (!storage) return;
  try {
    storage.setItem(dashboardState.key, JSON.stringify(layout));
  } catch (error) {
    console.warn('[account] No se pudo guardar la configuración del panel.', error);
  }
}

function updateDashboardButtonState() {
  if (!ui.dashboardCustomize) return;
  const canCustomize = Boolean(accountState.user);
  ui.dashboardCustomize.disabled = !canCustomize;
  ui.dashboardCustomize.setAttribute('aria-disabled', canCustomize ? 'false' : 'true');
}

function isDashboardPanelHidden(panelKey) {
  if (!panelKey) return false;
  if (!(accountState.roles instanceof Set) || !accountState.roles.has(panelKey)) {
    return true;
  }
  const layout = dashboardState.draft || dashboardState.layout || getDefaultDashboardLayout();
  const hiddenPanels = new Set(layout.hiddenPanels || []);
  return hiddenPanels.has(panelKey);
}

function prunePanelsForRoles(layout) {
  if (!layout) return layout;
  const allowed = accountState.roles instanceof Set ? new Set(accountState.roles) : new Set();
  const sanitized = normalizeDashboardLayout(layout);
  sanitized.hiddenPanels = sanitized.hiddenPanels.filter((panel) => allowed.has(panel));
  return sanitized;
}

function applyDashboardLayout() {
  const layout = dashboardState.layout || getDefaultDashboardLayout();
  const order = Array.isArray(layout.order) ? layout.order : [...DEFAULT_DASHBOARD_LAYOUT.order];
  const hidden = new Set(layout.hidden || []);

  if (ui.dashboardLayout) {
    order.forEach((key) => {
      const meta = DASHBOARD_WIDGET_META[key];
      if (!meta?.id) return;
      const element = document.getElementById(meta.id);
      if (!element) return;
      if (hidden.has(key)) {
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
        return;
      }
      element.hidden = false;
      element.removeAttribute('aria-hidden');
      ui.dashboardLayout.appendChild(element);
    });
  }

  if (ui.dashboardPanels) {
    Object.entries(DASHBOARD_ROLE_WIDGETS).forEach(([roleKey, meta]) => {
      const element = meta?.id ? document.getElementById(meta.id) : null;
      if (!element) return;
      const hiddenPanel = isDashboardPanelHidden(roleKey);
      element.hidden = hiddenPanel;
      if (hiddenPanel) {
        element.setAttribute('aria-hidden', 'true');
      } else {
        element.removeAttribute('aria-hidden');
        ui.dashboardPanels.appendChild(element);
      }
    });
  }
}

function updateDashboardContext(user, rolesSet) {
  accountState.user = user || null;
  accountState.roles = rolesSet instanceof Set ? new Set(rolesSet) : new Set(rolesSet || []);
  const key = computeDashboardStorageKey(accountState.user, accountState.roles);
  if (dashboardState.key !== key) {
    dashboardState.key = key;
    dashboardState.layout = prunePanelsForRoles(loadDashboardLayout(key));
  } else {
    dashboardState.layout = prunePanelsForRoles(dashboardState.layout);
  }
  updateDashboardButtonState();
  applyDashboardLayout();
}

function getAvailableDashboardWidgets() {
  const draft = dashboardState.draft || dashboardState.layout || getDefaultDashboardLayout();
  const base = draft.order
    .map((key) => ({ key, meta: DASHBOARD_WIDGET_META[key] }))
    .filter((item) => Boolean(item.meta));
  const panels = Array.from(accountState.roles)
    .map((role) => ({ role, meta: DASHBOARD_ROLE_WIDGETS[role] }))
    .filter((item, index, arr) => Boolean(item.meta) && arr.findIndex((candidate) => candidate.role === item.role) === index);
  return { base, panels };
}

function renderDashboardWidgetsList() {
  if (!ui.dashboardWidgetsList) return;
  const draft = dashboardState.draft || dashboardState.layout || getDefaultDashboardLayout();
  const hiddenBase = new Set(draft.hidden || []);
  const hiddenPanels = new Set(draft.hiddenPanels || []);
  const { base, panels } = getAvailableDashboardWidgets();

  ui.dashboardWidgetsList.replaceChildren();

  if (!base.length && !panels.length) {
    const empty = document.createElement('p');
    empty.className = 'dashboard-widgets__empty';
    empty.textContent = 'Selecciona un rol o inicia sesión para personalizar tu panel.';
    ui.dashboardWidgetsList.appendChild(empty);
    return;
  }

  if (base.length) {
    const baseGroup = document.createElement('section');
    baseGroup.className = 'dashboard-widgets__group';

    const heading = document.createElement('h3');
    heading.className = 'dashboard-widgets__heading';
    heading.textContent = 'Secciones principales';
    baseGroup.appendChild(heading);

    base.forEach(({ key, meta }, index) => {
      const row = document.createElement('div');
      row.className = 'dashboard-widget';
      row.dataset.dashboardKey = key;
      row.dataset.dashboardGroup = 'base';

      const checkboxId = `dashboard-widget-${key}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'dashboard-widget__checkbox';
      checkbox.id = checkboxId;
      checkbox.dataset.dashboardKey = key;
      checkbox.dataset.dashboardGroup = 'base';
      checkbox.checked = !hiddenBase.has(key);

      const label = document.createElement('label');
      label.className = 'dashboard-widget__label';
      label.setAttribute('for', checkboxId);
      label.textContent = meta.label;

      const controls = document.createElement('div');
      controls.className = 'dashboard-widget__controls';

      const moveUp = document.createElement('button');
      moveUp.type = 'button';
      moveUp.className = 'dashboard-widget__move';
      moveUp.dataset.dashboardKey = key;
      moveUp.dataset.dashboardMove = 'up';
      moveUp.disabled = index === 0;
      moveUp.textContent = '↑';

      const moveDown = document.createElement('button');
      moveDown.type = 'button';
      moveDown.className = 'dashboard-widget__move';
      moveDown.dataset.dashboardKey = key;
      moveDown.dataset.dashboardMove = 'down';
      moveDown.disabled = index === base.length - 1;
      moveDown.textContent = '↓';

      controls.append(moveUp, moveDown);
      row.append(checkbox, label, controls);
      baseGroup.appendChild(row);
    });

    ui.dashboardWidgetsList.appendChild(baseGroup);
  }

  if (panels.length) {
    const panelGroup = document.createElement('section');
    panelGroup.className = 'dashboard-widgets__group';

    const heading = document.createElement('h3');
    heading.className = 'dashboard-widgets__heading';
    heading.textContent = 'Paneles por rol';
    panelGroup.appendChild(heading);

    panels.forEach(({ role, meta }) => {
      const row = document.createElement('div');
      row.className = 'dashboard-widget';
      row.dataset.dashboardKey = role;
      row.dataset.dashboardGroup = 'panel';

      const checkboxId = `dashboard-panel-${role}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'dashboard-widget__checkbox';
      checkbox.id = checkboxId;
      checkbox.dataset.dashboardKey = role;
      checkbox.dataset.dashboardGroup = 'panel';
      checkbox.checked = !hiddenPanels.has(role);

      const label = document.createElement('label');
      label.className = 'dashboard-widget__label';
      label.setAttribute('for', checkboxId);
      label.textContent = meta.label;

      row.append(checkbox, label);
      panelGroup.appendChild(row);
    });

    ui.dashboardWidgetsList.appendChild(panelGroup);
  }
}

function openDashboardModalHandler() {
  if (!ui.dashboardModal) return;
  if (!accountState.user) {
    toast?.info?.('Inicia sesión para personalizar tu panel.');
    return;
  }
  dashboardState.draft = cloneDashboardLayout(dashboardState.layout);
  renderDashboardWidgetsList();
  openModal(ui.dashboardModal);
}

function closeDashboardModalHandler() {
  if (!ui.dashboardModal) return;
  dashboardState.draft = null;
  closeModal(ui.dashboardModal);
}

function handleDashboardWidgetsChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'checkbox') return;
  const key = target.dataset.dashboardKey;
  const group = target.dataset.dashboardGroup || 'base';
  if (!key || !dashboardState.draft) return;

  if (group === 'panel') {
    const hiddenPanels = new Set(dashboardState.draft.hiddenPanels || []);
    if (target.checked) {
      hiddenPanels.delete(key);
    } else {
      hiddenPanels.add(key);
    }
    dashboardState.draft.hiddenPanels = Array.from(hiddenPanels);
  } else {
    const hidden = new Set(dashboardState.draft.hidden || []);
    if (target.checked) {
      hidden.delete(key);
    } else {
      hidden.add(key);
    }
    dashboardState.draft.hidden = Array.from(hidden);
  }
}

function handleDashboardWidgetsClick(event) {
  const control = event.target instanceof Element ? event.target.closest('[data-dashboard-move]') : null;
  if (!control || !dashboardState.draft) return;
  event.preventDefault();
  const key = control.dataset.dashboardKey;
  const direction = control.dataset.dashboardMove;
  if (!key || !direction) return;
  const order = Array.isArray(dashboardState.draft.order) ? [...dashboardState.draft.order] : [];
  const index = order.indexOf(key);
  if (index === -1) return;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return;
  order.splice(index, 1);
  order.splice(targetIndex, 0, key);
  dashboardState.draft.order = order;
  renderDashboardWidgetsList();
}

function handleDashboardSave(event) {
  event.preventDefault();
  if (!dashboardState.draft) {
    closeDashboardModalHandler();
    return;
  }
  dashboardState.layout = normalizeDashboardLayout(dashboardState.draft);
  saveDashboardLayout(dashboardState.layout);
  dashboardState.draft = null;
  applyDashboardLayout();
  closeDashboardModalHandler();
  toast?.success?.('Panel actualizado.');
}

function bindDashboardCustomization() {
  if (dashboardState.bound) return;
  dashboardState.bound = true;

  if (!dashboardState.layout) {
    dashboardState.layout = getDefaultDashboardLayout();
  }

  if (ui.dashboardCustomize) {
    on(ui.dashboardCustomize, 'click', (event) => {
      event.preventDefault();
      openDashboardModalHandler();
    });
  }

  if (ui.dashboardSave instanceof HTMLButtonElement) {
    on(ui.dashboardSave, 'click', handleDashboardSave);
  }

  ui.dashboardCancelButtons?.forEach((button) => {
    on(button, 'click', (event) => {
      event.preventDefault();
      closeDashboardModalHandler();
    });
  });

  if (ui.dashboardModal) {
    const overlay = ui.dashboardModal.querySelector('[data-modal-close]');
    if (overlay) {
      on(overlay, 'click', (event) => {
        event.preventDefault();
        closeDashboardModalHandler();
      });
    }
    const closeButton = ui.dashboardModal.querySelector('.modal__close');
    if (closeButton) {
      on(closeButton, 'click', (event) => {
        event.preventDefault();
        closeDashboardModalHandler();
      });
    }
  }

  if (ui.dashboardWidgetsList) {
    on(ui.dashboardWidgetsList, 'change', handleDashboardWidgetsChange);
    on(ui.dashboardWidgetsList, 'click', handleDashboardWidgetsClick);
  }

  updateDashboardButtonState();
  applyDashboardLayout();
}

function resetDashboardLayout() {
  dashboardState.key = null;
  dashboardState.layout = getDefaultDashboardLayout();
  dashboardState.draft = null;
  updateDashboardButtonState();
  applyDashboardLayout();
}

export function createDashboardManager() {
  return {
    init: bindDashboardCustomization,
    reset: resetDashboardLayout,
    updateContext: updateDashboardContext,
    isPanelHidden: isDashboardPanelHidden,
  };
}
