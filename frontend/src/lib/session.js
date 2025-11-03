export const SESSION_KEY = 'ecuplot_session_token';

export function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function setSessionToken(token) {
  try {
    if (token) {
      localStorage.setItem(SESSION_KEY, token);
    }
  } catch (error) {
    console.warn('No se pudo guardar el token de sesión', error);
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('No se pudo eliminar el token de sesión', error);
  }
}

export function hasSessionToken() {
  return Boolean(getSessionToken());
}
