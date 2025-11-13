// Punto de entrada público reducido: API + bootstrap modular
import { authFetch } from './app/core/http.js';
import { toast } from './app/core/toast.js';
import { eventStream } from './app/core/stream.js';
import { getCurrentUser, refreshCurrentUser } from './app/core/user-state.js';
// import { replaceIconImages } from './lib/icons.js';
import './app/index.js';


// API complementaria que otras vistas consumen
export async function savePlot(expression, plot_parameters = null, plot_metadata = null) {
  const res = await authFetch('/api/plot', {
    method: 'POST',
    body: JSON.stringify({ expression, plot_parameters, plot_metadata }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'No se pudo guardar el historial');
  return data;
}

export async function logout() {
  try {
    await authFetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Logout request failed:', e);
  } finally {
    try { sessionStorage.removeItem('ecuplot.2fa-reminder'); } catch {}
    eventStream.disconnect?.();
    window.dispatchEvent(new CustomEvent('ecuplot:logout'));
    toast.success('Sesión cerrada.');
  }
}

// Re-exports esperados por otras partes de la app
export { authFetch, toast, getCurrentUser, refreshCurrentUser, eventStream };

