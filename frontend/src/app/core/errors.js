import { toast } from './toast.js';

export function initGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    try {
      const msg = e?.error?.message || e?.message || 'Error de script';
      const file = e?.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
      console.error('[EcuPlot] Error:', e.error || e);
      toast?.error?.(`Error JS: ${msg}${file}`);
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const msg = e?.reason?.message || String(e.reason) || 'Promise rechazada';
      console.error('[EcuPlot] Rechazo no manejado:', e.reason);
      toast?.error?.(`Error async: ${msg}`);
    } catch {}
  });
}

