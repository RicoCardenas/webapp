import { toast } from '/static/app.js';
import { on } from '../../lib/events.js';
import { requestWithAuth } from '../api-client.js';
import { formatNumber } from '../utils.js';
import { ui } from '../ui.js';

const securityState = {
  loading: false,
  bound: false,
  last: null,
  fetched: false,
  error: null,
};

function setSecurityLoading(isLoading) {
  securityState.loading = Boolean(isLoading);
  if (ui.securitySummary) ui.securitySummary.setAttribute('aria-busy', securityState.loading ? 'true' : 'false');
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    ui.securityRefresh.disabled = securityState.loading;
    if (securityState.loading) {
      ui.securityRefresh.textContent = 'Actualizando...';
    } else {
      const label = ui.securityRefresh.dataset.defaultLabel || 'Actualizar seguridad';
      ui.securityRefresh.textContent = label;
    }
  }
}

function formatSecurityDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (Number.isFinite(diffMs) && diffMs >= 0) {
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'Hace instantes';
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `Hace ${diffDays} día${diffDays === 1 ? '' : 's'}`;
  }
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeSecurityLastLogin(entry) {
  if (!entry) return 'Sin registros de inicio de sesión reciente.';
  const formatted = formatSecurityDate(entry.at);
  const absolute = entry.at
    ? new Date(entry.at).toLocaleString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const relativeLabel = formatted || absolute;
  const parts = [];
  if (relativeLabel) parts.push(relativeLabel);
  if (absolute && formatted && formatted !== absolute) parts.push(`(${absolute})`);
  if (entry.ip) parts.push(`IP: ${entry.ip}`);
  return parts.length ? parts.join(' · ') : 'Sin registros de inicio de sesión reciente.';
}

function describeSecurityAttempts(summary) {
  const count = Number(summary?.count ?? 0);
  if (!count) return 'Sin intentos recientes.';
  const windowHours = Number(summary?.window_hours ?? 24);
  const countLabel = `${formatNumber(count)} intento${count === 1 ? '' : 's'} fallido${count === 1 ? '' : 's'}`;
  const windowLabel = windowHours > 0 ? `en las últimas ${windowHours} h` : '';
  const lastLabel = formatSecurityDate(summary?.last_at);
  return [countLabel, windowLabel, lastLabel ? `Último: ${lastLabel}` : null]
    .filter(Boolean)
    .join(' · ');
}

function describeSecurityLockouts(summary) {
  const count = Number(summary?.count ?? 0);
  if (!count) return 'Sin bloqueos recientes.';
  const windowDays = Number(summary?.window_days ?? 90);
  const countLabel = `${formatNumber(count)} bloqueo${count === 1 ? '' : 's'}`;
  const windowLabel = windowDays > 0 ? `en los últimos ${windowDays} días` : '';
  const lastLabel = formatSecurityDate(summary?.last_at);
  return [countLabel, windowLabel, lastLabel ? `Último: ${lastLabel}` : null]
    .filter(Boolean)
    .join(' · ');
}

function describeSecuritySessions(value) {
  const active = Number(value ?? 0);
  if (Number.isFinite(active) && active > 0) {
    return `${formatNumber(active)} sesión${active === 1 ? '' : 'es'} activa${active === 1 ? '' : 's'}`;
  }
  return '1 sesión activa (esta sesión)';
}

function renderSecurityRecommendations(recommendations) {
  if (!ui.securityRecommendations) return;
  ui.securityRecommendations.replaceChildren();
  const items = Array.isArray(recommendations) ? recommendations.filter(Boolean) : [];
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin recomendaciones adicionales.';
    ui.securityRecommendations.appendChild(li);
    return;
  }
  items.forEach((tip) => {
    const li = document.createElement('li');
    li.textContent = tip;
    ui.securityRecommendations.appendChild(li);
  });
}

function renderSecuritySummary(summary) {
  securityState.last = summary || null;
  securityState.fetched = Boolean(summary);
  securityState.error = null;
  if (!summary) {
    if (ui.securityLastLogin) ui.securityLastLogin.textContent = 'Sin registros.';
    if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = 'Sin intentos recientes.';
    if (ui.securityLockouts) ui.securityLockouts.textContent = 'Sin bloqueos recientes.';
    if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = '1 sesión activa (esta sesión)';
    renderSecurityRecommendations([]);
    return;
  }

  if (ui.securityLastLogin) ui.securityLastLogin.textContent = describeSecurityLastLogin(summary.last_login);
  if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = describeSecurityAttempts(summary.failed_attempts);
  if (ui.securityLockouts) ui.securityLockouts.textContent = describeSecurityLockouts(summary.lockouts);
  if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = describeSecuritySessions(summary.active_sessions);
  renderSecurityRecommendations(summary.recommendations);
}

async function loadSecuritySummary(options = {}) {
  const { force = false } = options;
  if (!ui.securityCard) return;
  if (securityState.loading) return;
  if (securityState.fetched && !force) return;

  setSecurityLoading(true);
  try {
    const res = await requestWithAuth('/api/account/security/summary');
    if (!res) return;
    if (!res.ok) {
      renderSecuritySummary(null);
      securityState.error = true;
      toast?.error?.('No se pudo cargar el resumen de seguridad.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    renderSecuritySummary(data || null);
  } catch (error) {
    console.error('[account] Error al cargar resumen de seguridad', error);
    renderSecuritySummary(null);
    securityState.error = true;
    toast?.error?.('No se pudo cargar el resumen de seguridad.');
  } finally {
    setSecurityLoading(false);
  }
}

function bindSecuritySection() {
  if (securityState.bound) return;
  securityState.bound = true;
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    if (!ui.securityRefresh.dataset.defaultLabel) {
      ui.securityRefresh.dataset.defaultLabel = ui.securityRefresh.textContent || 'Actualizar seguridad';
    }
    on(ui.securityRefresh, 'click', async (event) => {
      event.preventDefault();
      await loadSecuritySummary({ force: true });
    });
  }
}

function resetSecuritySummary() {
  securityState.loading = false;
  securityState.last = null;
  securityState.fetched = false;
  securityState.error = null;
  if (ui.securitySummary) ui.securitySummary.setAttribute('aria-busy', 'false');
  if (ui.securityLastLogin) ui.securityLastLogin.textContent = 'Cargando...';
  if (ui.securityFailedAttempts) ui.securityFailedAttempts.textContent = '—';
  if (ui.securityLockouts) ui.securityLockouts.textContent = '—';
  if (ui.securityActiveSessions) ui.securityActiveSessions.textContent = '—';
  if (ui.securityRecommendations) {
    ui.securityRecommendations.replaceChildren();
    const item = document.createElement('li');
    item.textContent = 'Sin recomendaciones disponibles.';
    ui.securityRecommendations.appendChild(item);
  }
  if (ui.securityRefresh instanceof HTMLButtonElement) {
    const label = ui.securityRefresh.dataset.defaultLabel || ui.securityRefresh.textContent || 'Actualizar seguridad';
    ui.securityRefresh.disabled = false;
    ui.securityRefresh.textContent = label;
  }
}

export function createSecuritySection() {
  return {
    init: bindSecuritySection,
    load: loadSecuritySummary,
    reset: resetSecuritySummary,
  };
}
