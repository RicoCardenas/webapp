import { authFetch, toast } from '/static/app.js';

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

export async function requestWithAuth(url, options) {
  try {
    const res = await authFetch(url, options);
    if (res?.status === 401) {
      return typeof unauthorizedHandler === 'function' ? unauthorizedHandler() : null;
    }
    return res;
  } catch (error) {
    console.error('[account] Error de red', error);
    toast?.error?.('Error de red al contactar la API.');
    return null;
  }
}
