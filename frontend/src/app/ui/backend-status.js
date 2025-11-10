import { safeFetch } from '../core/http.js';
import { getCurrentUser } from '../core/user-state.js';

export function initBackendStatus() {
  const container = document.querySelector('[data-status]');
  if (!container) return;
  if (container.dataset.backendStatusInit === 'true') return;
  container.dataset.backendStatusInit = 'true';
  const label = container.querySelector('[data-status-label]');
  const badges = container.querySelector('[data-status-badges]');
  container.hidden = true;
  const setStatusClass = (status) => {
    const normalized = status || 'unknown';
    container.dataset.status = normalized;
    Array.from(container.classList)
      .filter((token) => token.startsWith('status--'))
      .forEach((token) => container.classList.remove(token));
    container.classList.add(`status--${normalized}`);
  };

  const resetStatus = () => {
    if (label) label.textContent = '';
    if (badges) {
      badges.hidden = true;
      badges.textContent = '';
    }
    setStatusClass('unknown');
  };

  let loading = false;

  const loadStatus = async () => {
    if (loading) return;
    loading = true;
    try {
      const res = await safeFetch('/api/health', { method: 'GET' }, 5000);
      const data = await res.json().catch(() => ({}));
      const status = (data?.status || '').toLowerCase();
      if (label) label.textContent = status === 'ok' ? 'Backend operativo' : status === 'degraded' ? 'Backend con advertencias' : 'Backend sin conexión';
      if (badges) {
        badges.hidden = false;
        badges.textContent = '';
        const metrics = data?.metrics || {};
        const parts = [];
        if (typeof metrics.db_latency_ms === 'number') parts.push(`DB ${metrics.db_latency_ms}ms`);
        if (typeof metrics.mail_queue === 'number') parts.push(`Mail cola ${metrics.mail_queue}`);
        const load = metrics.system_load || {};
        if (typeof load.ratio === 'number') parts.push(`Carga ${load.ratio}`);
        badges.textContent = parts.join(' · ');
      }
      setStatusClass(status || 'unknown');
    } catch (err) {
      if (label) label.textContent = 'Backend sin conexión';
      if (badges) badges.hidden = true;
      setStatusClass('error');
    } finally {
      loading = false;
    }
  };

  const hasDevelopmentRole = (user) => {
    if (!user) return false;
    const roles = [];
    if (Array.isArray(user.roles)) roles.push(...user.roles);
    if (user.role) roles.push(user.role);
    return roles.some((role) => String(role || '').toLowerCase() === 'development');
  };

  const applyVisibility = (user) => {
    const canSee = hasDevelopmentRole(user);
    if (!canSee) {
      container.hidden = true;
      container.setAttribute('aria-hidden', 'true');
      resetStatus();
      return;
    }
    container.hidden = false;
    container.setAttribute('aria-hidden', 'false');
    loadStatus();
  };

  applyVisibility(getCurrentUser());
  window.addEventListener('ecuplot:user', (event) => {
    const user = event?.detail || null;
    applyVisibility(user);
  });
}

