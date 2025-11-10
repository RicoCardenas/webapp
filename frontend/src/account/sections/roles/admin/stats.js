import { toast } from '/static/app.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { accountState } from '../../../state.js';
import { formatNumber } from '../../../utils.js';

export function renderAdminRoleStats(stats) {
  if (!ui.adminStats) return;
  ui.adminStats.hidden = false;

  if (ui.adminStatsUsersTotal) ui.adminStatsUsersTotal.textContent = formatNumber(stats?.users_total ?? 0);
  if (ui.adminStatsUsersActive) ui.adminStatsUsersActive.textContent = formatNumber(stats?.users_active ?? 0);
  if (ui.adminStatsRequestsOpen) ui.adminStatsRequestsOpen.textContent = formatNumber(stats?.requests_open ?? 0);
  if (ui.adminStatsRequestsPending) ui.adminStatsRequestsPending.textContent = formatNumber(stats?.requests_pending ?? 0);
  if (ui.adminStatsRequestsResolved) ui.adminStatsRequestsResolved.textContent = formatNumber(stats?.requests_resolved ?? 0);
  if (ui.adminStatsPlotsTotal) ui.adminStatsPlotsTotal.textContent = formatNumber(stats?.plots_total ?? 0);
  if (ui.adminStatsPlotsToday) ui.adminStatsPlotsToday.textContent = formatNumber(stats?.plots_today ?? 0);
  if (ui.adminStatsPlotsWeek) ui.adminStatsPlotsWeek.textContent = formatNumber(stats?.plots_week ?? 0);

  if (ui.adminStatsUsersRoles) {
    ui.adminStatsUsersRoles.replaceChildren();
    const roles = Array.isArray(stats?.roles) ? stats.roles : [];
    if (!roles.length) {
      const li = document.createElement('li');
      li.textContent = 'Sin datos disponibles';
      ui.adminStatsUsersRoles.appendChild(li);
    } else {
      roles.forEach((roleStat) => {
        const li = document.createElement('li');
        li.textContent = `${roleStat?.role || 'Rol'}: ${formatNumber(roleStat?.count ?? 0)}`;
        ui.adminStatsUsersRoles.appendChild(li);
      });
    }
  }
}

export async function loadAdminStats() {
  if (!ui.adminStats) return;
  const hasDevelopmentRole = accountState.roles instanceof Set && accountState.roles.has('development');
  if (!hasDevelopmentRole) {
    ui.adminStats.hidden = true;
    ui.adminStats.removeAttribute('aria-busy');
    return;
  }

  ui.adminStats.hidden = false;
  ui.adminStats.setAttribute('aria-busy', 'true');
  try {
    const [usersRes, requestsRes, plotsRes] = await Promise.all([
      requestWithAuth('/api/admin/stats/users'),
      requestWithAuth('/api/admin/stats/requests'),
      requestWithAuth('/api/admin/stats/plots'),
    ]);

    if (usersRes?.ok) {
      const data = await usersRes.json().catch(() => ({}));
      const rolesArray = data?.por_rol && typeof data.por_rol === 'object'
        ? Object.entries(data.por_rol).map(([role, count]) => ({ role, count }))
        : [];
      renderAdminRoleStats({
        users_total: data?.total,
        users_active: data?.activos_7d,
        roles: rolesArray,
      });
    } else if (usersRes) {
      toast?.error?.('No se pudieron cargar las estadísticas de usuarios.');
    }

    if (requestsRes?.ok) {
      const data = await requestsRes.json().catch(() => ({}));
      if (ui.adminStatsRequestsOpen) ui.adminStatsRequestsOpen.textContent = formatNumber(data?.abiertas ?? 0);
      if (ui.adminStatsRequestsPending) ui.adminStatsRequestsPending.textContent = formatNumber(data?.pendientes ?? 0);
      if (ui.adminStatsRequestsResolved) ui.adminStatsRequestsResolved.textContent = formatNumber(data?.atendidas ?? 0);
    } else if (requestsRes) {
      toast?.error?.('No se pudieron cargar las estadísticas de solicitudes.');
    }

    if (plotsRes?.ok) {
      const data = await plotsRes.json().catch(() => ({}));
      if (ui.adminStatsPlotsTotal) ui.adminStatsPlotsTotal.textContent = formatNumber(data?.total ?? 0);
      if (ui.adminStatsPlotsToday) ui.adminStatsPlotsToday.textContent = formatNumber(data?.hoy ?? 0);
      if (ui.adminStatsPlotsWeek) ui.adminStatsPlotsWeek.textContent = formatNumber(data?.ultimos_7d ?? 0);
    } else if (plotsRes) {
      toast?.error?.('No se pudieron cargar las métricas de gráficas.');
    }
  } catch (error) {
    console.error('[account] Error al cargar métricas admin', error);
    toast?.error?.('No se pudieron cargar las métricas administrativas.');
  } finally {
    ui.adminStats.removeAttribute('aria-busy');
  }
}

export function resetAdminStats() {
  if (ui.adminStatsUsersTotal) ui.adminStatsUsersTotal.textContent = '—';
  if (ui.adminStatsUsersActive) ui.adminStatsUsersActive.textContent = '—';
  if (ui.adminStatsRequestsOpen) ui.adminStatsRequestsOpen.textContent = '—';
  if (ui.adminStatsRequestsPending) ui.adminStatsRequestsPending.textContent = '—';
  if (ui.adminStatsRequestsResolved) ui.adminStatsRequestsResolved.textContent = '—';
  if (ui.adminStatsPlotsTotal) ui.adminStatsPlotsTotal.textContent = '—';
  if (ui.adminStatsPlotsToday) ui.adminStatsPlotsToday.textContent = '—';
  if (ui.adminStatsPlotsWeek) ui.adminStatsPlotsWeek.textContent = '—';
  if (ui.adminStatsUsersRoles) {
    ui.adminStatsUsersRoles.replaceChildren();
    const item = document.createElement('li');
    item.textContent = 'Sin datos disponibles';
    ui.adminStatsUsersRoles.appendChild(item);
  }
  if (ui.adminStats) ui.adminStats.hidden = true;
}
