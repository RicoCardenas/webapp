const DEFAULT_FILTERS = {
  page: 1,
  pageSize: 15,
  includeRead: false,
  category: '',
};

const VALID_EVENTS = new Set(['notifications:new', 'notifications:update']);

function normalizeCategory(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function normalizeFilters(input = {}, base = DEFAULT_FILTERS) {
  const merged = { ...base, ...input };
  merged.page = Math.max(1, Number(merged.page) || base.page);
  merged.pageSize = Math.max(1, Number(merged.pageSize) || base.pageSize);
  merged.includeRead = Boolean(merged.includeRead);
  merged.category = normalizeCategory(merged.category);
  return merged;
}

export function createNotificationsStore({ authFetch, eventStream, initialFilters = {} }) {
  const state = {
    filters: normalizeFilters(initialFilters),
    items: [],
    meta: {
      total: 0,
      page: 1,
      pageSize: 15,
      totalPages: 0,
      unread: 0,
      includeRead: false,
      category: '',
    },
    categories: {},
    preferences: {},
    loading: false,
    error: null,
  };

  const listeners = new Set();
  let unsubscribeEvents = null;

  function snapshot() {
    return {
      filters: { ...state.filters },
      items: [...state.items],
      meta: { ...state.meta },
      categories: { ...state.categories },
      preferences: { ...state.preferences },
      loading: state.loading,
      error: state.error,
    };
  }

  function notify() {
    const copy = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(copy);
      } catch (error) {
        console.error('notifications-store listener error', error);
      }
    });
  }

  function applyEventStream() {
    if (!eventStream || unsubscribeEvents) return;
    unsubscribeEvents = eventStream.subscribeChannel('notifications', (payload) => {
      const type = payload?.type && VALID_EVENTS.has(payload.type) ? payload.type : 'notifications:new';
      if (type === 'notifications:new') {
        const incoming = payload?.data?.notification;
        if (incoming) mergeNotification(incoming);
        if (typeof payload?.data?.unread === 'number') {
          state.meta.unread = payload.data.unread;
        }
        notify();
      } else if (type === 'notifications:update') {
        if (typeof payload?.data?.unread === 'number') {
          state.meta.unread = payload.data.unread;
          notify();
        }
      }
    });
    eventStream.ensure?.();
  }

  function mergeNotification(notification) {
    const normalized = normalizeNotification(notification);
    if (!normalized) return;
    const exists = state.items.find((item) => item.id === normalized.id);
    if (exists) {
      Object.assign(exists, normalized);
      return;
    }
    if (state.filters.page === 1) {
      state.items = [normalized, ...state.items].slice(0, state.filters.pageSize);
    }
    state.meta.total += 1;
  }

  function normalizeNotification(notification) {
    if (!notification || typeof notification !== 'object') return null;
    const id = String(notification.id || '').trim();
    if (!id) return null;
    return {
      id,
      category: normalizeCategory(notification.category),
      title: String(notification.title || ''),
      body: notification.body == null ? '' : String(notification.body),
      payload: notification.payload || {},
      created_at: notification.created_at || null,
      read_at: notification.read_at || null,
    };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set('page', String(state.filters.page));
    params.set('page_size', String(state.filters.pageSize));
    if (state.filters.includeRead) params.set('include_read', '1');
    if (state.filters.category) params.set('category', state.filters.category);
    return params.toString();
  }

  async function load() {
    if (!authFetch) {
      state.error = 'no-auth';
      notify();
      return { ok: false, reason: 'no-auth-fetch' };
    }

    state.loading = true;
    state.error = null;
    notify();

    try {
      const res = await authFetch(`/api/account/notifications?${buildQuery()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        state.error = data?.error || `notifications:${res.status}`;
        notify();
        return { ok: false, reason: state.error };
      }

      const payload = await res.json().catch(() => ({}));
      const items = Array.isArray(payload?.data) ? payload.data.map(normalizeNotification).filter(Boolean) : [];
      state.items = items;

      const meta = payload?.meta || {};
      state.meta = {
        total: Number(meta.total ?? items.length ?? 0),
        page: Number(meta.page ?? state.filters.page ?? 1),
        pageSize: Number(meta.page_size ?? state.filters.pageSize),
        totalPages: Number(meta.total_pages ?? 0),
        unread: Number(meta.unread ?? 0),
        includeRead: Boolean(meta.include_read ?? state.filters.includeRead),
        category: normalizeCategory(meta.category ?? state.filters.category),
      };

      state.filters.page = state.meta.page;
      state.filters.pageSize = state.meta.pageSize;
      state.filters.includeRead = state.meta.includeRead;
      state.filters.category = state.meta.category;

      state.categories = payload?.categories || {};
      state.preferences = payload?.preferences || {};

      notify();
      return { ok: true, data: items };
    } catch (error) {
      state.error = error?.message || 'network';
      notify();
      return { ok: false, reason: 'network' };
    } finally {
      state.loading = false;
      notify();
    }
  }

  function setFilters(partial = {}, options = {}) {
    const next = { ...partial };
    if (next.pageSize != null) {
      const size = Number(next.pageSize);
      if (!Number.isFinite(size) || size <= 0) {
        delete next.pageSize;
      }
    }
    if (next.page != null) {
      const page = Number(next.page);
      next.page = Number.isNaN(page) || page < 1 ? 1 : page;
    }
    if (next.includeRead != null) {
      next.includeRead = Boolean(next.includeRead);
    }
    if (next.category !== undefined) {
      next.category = normalizeCategory(next.category);
    }
    state.filters = normalizeFilters({ ...state.filters, ...next }, state.filters);
    notify();
    if (options.fetch) return load();
    return Promise.resolve({ ok: true });
  }

  async function markRead(notificationId) {
    if (!authFetch) return { ok: false, reason: 'no-auth-fetch' };
    try {
      const res = await authFetch(`/api/account/notifications/${notificationId}/read`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, reason: data?.error || `mark-read:${res.status}` };
      }
      const payload = await res.json().catch(() => ({}));
      if (payload?.notification) {
        const normalized = normalizeNotification(payload.notification);
        const idx = state.items.findIndex((item) => item.id === normalized?.id);
        if (idx >= 0 && normalized) {
          state.items[idx] = normalized;
        }
      }
      if (typeof payload?.unread === 'number') {
        state.meta.unread = payload.unread;
      }
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.message || 'network' };
    }
  }

  async function markAll({ category } = {}) {
    if (!authFetch) return { ok: false, reason: 'no-auth-fetch' };
    try {
      const body = category ? { category: normalizeCategory(category) } : {};
      const res = await authFetch('/api/account/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, reason: data?.error || `mark-all:${res.status}` };
      }
      const payload = await res.json().catch(() => ({}));
      if (!body.category || body.category === state.filters.category || !state.filters.category) {
        state.items = state.items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }));
      }
      if (typeof payload?.unread === 'number') {
        state.meta.unread = payload.unread;
      }
      notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.message || 'network' };
    }
  }

  async function updatePrefs(preferences) {
    if (!authFetch) return { ok: false, reason: 'no-auth-fetch' };
    try {
      const res = await authFetch('/api/account/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences || {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, reason: data?.error || `prefs:${res.status}` };
      }
      const payload = await res.json().catch(() => ({}));
      if (payload?.preferences) {
        state.preferences = payload.preferences;
      }
      notify();
      return { ok: true, preferences: state.preferences };
    } catch (error) {
      return { ok: false, reason: error?.message || 'network' };
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    applyEventStream();
    return () => listeners.delete(listener);
  }

  return {
    subscribe,
    load,
    setFilters,
    markRead,
    markAll,
    updatePreferences: updatePrefs,
    getState: snapshot,
  };
}
