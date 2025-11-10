// Core HTTP helpers (authFetch, safeFetch)
/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && !(options.body instanceof FormData);
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const fetchOptions = {
    credentials: options.credentials ?? 'same-origin',
    ...options,
    headers,
  };
  return fetch(url, fetchOptions);
}

/** Fetch con timeout */
export async function safeFetch(url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(id);
  }
}

