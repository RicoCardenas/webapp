const LEGACY_SESSION_KEY = 'ecuplot_session_token';
const SESSION_FLAG_KEY = 'ecuplot_session_active';

function purgeLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* noop */
  }
}

export function getSessionToken() {
  purgeLegacyStorage();
  return '';
}

export function setSessionToken() {
  purgeLegacyStorage();
  try {
    sessionStorage.setItem(SESSION_FLAG_KEY, '1');
  } catch (error) {
    console.warn('No se pudo marcar la sesión como activa', error);
  }
}

export function clearSessionToken() {
  purgeLegacyStorage();
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch (error) {
    console.warn('No se pudo limpiar el indicador de sesión', error);
  }
}

export function hasSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}
