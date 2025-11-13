import { hasSessionToken, setSessionToken, clearSessionToken } from '../../lib/session.js';
import { toast } from './toast.js';
import { eventStream } from './stream.js';
import { authFetch } from './http.js';

const USER_STATE_KEY = 'ecuplot.currentUser';

const userState = {
  current: null,
};

export function loadStoredUser() {
  try {
    const raw = sessionStorage.getItem(USER_STATE_KEY);
    if (!raw) {
      userState.current = null;
      return null;
    }
    const parsed = JSON.parse(raw);
    userState.current = parsed;
    return parsed;
  } catch {
    userState.current = null;
    return null;
  }
}

export function setCurrentUser(user, { emit = true } = {}) {
  userState.current = user ? { ...user } : null;
  try {
    if (user) sessionStorage.setItem(USER_STATE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_STATE_KEY);
  } catch {}
  if (emit) {
    window.dispatchEvent(new CustomEvent('ecuplot:user', { detail: userState.current }));
  }
}

export function getCurrentUser() {
  return userState.current;
}

export async function refreshCurrentUser() {
  try {
    const res = await authFetch('/api/user/me');
    const status = res.status;
    if (!res.ok) {
      clearSessionToken();
      eventStream.disconnect();
      setCurrentUser(null);
      return { user: null, status };
    }
    const data = await res.json().catch(() => null);
    setSessionToken();
    // No llamamos ensure() aquí - ya se llamó en restoreSessionAuth()
    setCurrentUser(data);
    return { user: data, status };
  } catch (error) {
    clearSessionToken();
    eventStream.disconnect();
    setCurrentUser(null);
    return { user: null, status: 500, error };
  }
}

export function restoreSessionAuth() {
  const isActive = hasSessionToken();
  if (isActive) {
    eventStream.ensure?.();
    const cached = loadStoredUser();
    if (cached) {
      window.dispatchEvent(new CustomEvent('ecuplot:user', { detail: cached }));
    }
    refreshCurrentUser();
  } else {
    eventStream.disconnect();
    setCurrentUser(null);
  }
}

