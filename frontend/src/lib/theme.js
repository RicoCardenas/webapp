const THEME_KEY = 'ecup-theme';
export const THEMES = /** @type {const} */ (['light', 'dark', 'system']);

function safeGetStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('No se pudo persistir el tema preferido', error);
  }
}

export function getThemePreference() {
  const stored = safeGetStorage(THEME_KEY, '');
  if (THEMES.includes(stored)) return stored;
  return 'system';
}

export function resolveTheme(preference) {
  const pref = THEMES.includes(preference) ? preference : 'system';
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  const prefersDark = !!(mql && mql.matches);
  return prefersDark ? 'dark' : 'light';
}

function applyResolvedTheme(resolved) {
  const root = document.documentElement;
  const body = document.body;
  root.dataset.theme = resolved;
  root.classList.toggle('theme-dark', resolved === 'dark');
  root.classList.toggle('theme-light', resolved !== 'dark');
  if (body) {
    body.classList.toggle('theme-dark', resolved === 'dark');
    body.classList.toggle('theme-light', resolved !== 'dark');
  }
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: resolved } }));
}

export function applyTheme(preference) {
  const pref = THEMES.includes(preference) ? preference : 'system';
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.themePreference = pref;
  applyResolvedTheme(resolved);
}

export function setThemePreference(preference) {
  const pref = THEMES.includes(preference) ? preference : 'system';
  safeSetStorage(THEME_KEY, pref);
  applyTheme(pref);
}

export function initThemeSync() {
  const pref = getThemePreference();
  applyTheme(pref);
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  const handle = () => {
    if (getThemePreference() === 'system') {
      applyTheme('system');
    }
  };
  if (mq?.addEventListener) {
    mq.addEventListener('change', handle);
  } else if (mq?.addListener) {
    // Safari <14
    mq.addListener(handle);
  }
  return () => {
    if (mq?.removeEventListener) {
      mq.removeEventListener('change', handle);
    } else if (mq?.removeListener) {
      mq.removeListener(handle);
    }
  };
}
