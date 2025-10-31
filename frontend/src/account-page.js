import { authFetch, toast } from '/static/app.js';
import { qs } from './lib/dom.js';
import { on } from './lib/events.js';
const SESSION_KEY = 'ecuplot_session_token';

let unauthorizedHandled = false;

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
  const res = await requestWithAuth('/api/user/me');
  if (!res) return;

  if (!res.ok) {
    toast?.error?.('No se pudieron cargar los datos de tu cuenta.');
    return;
  }

  const user = await res.json().catch(() => ({}));
  if (!user) return;

  setAuthVisibility(true);

  qs('#user-name').textContent = user?.name ?? '—';
  qs('#user-email').textContent = user?.email ?? '—';
  qs('#user-role').textContent = user?.role ?? '—';

  const createdAt = user?.created_at ? new Date(user.created_at) : null;
  const createdLabel = createdAt
    ? createdAt.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  qs('#user-created-at').textContent = createdLabel;

  const statusEl = qs('#user-status');
  if (statusEl) statusEl.textContent = user?.is_verified ? 'Verificado' : 'Pendiente de verificación';

  const labelEl = qs('.account-user__label');
  if (labelEl) labelEl.textContent = user?.is_verified ? 'Cuenta verificada' : 'Cuenta pendiente';

  const avatar = qs('#user-avatar');
  if (avatar) avatar.textContent = initialsFrom(user?.name, user?.email);
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

window.addEventListener('ecuplot:logout', () => {
  handleUnauthorized(false);
});

window.addEventListener('ecuplot:login', () => {
  unauthorizedHandled = false;
  loadAccountDetails();
  loadPlotHistory();
});
