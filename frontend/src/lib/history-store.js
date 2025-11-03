const DEFAULT_FILTERS = {
  page: 1,
  pageSize: 20,
  order: 'desc',
  q: '',
  tags: [],
  from: '',
  to: '',
  includeDeleted: false,
};

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeFiltersInput(input = {}, base = DEFAULT_FILTERS) {
  const merged = { ...base, ...input };
  merged.page = Math.max(1, Number(merged.page) || base.page);
  merged.pageSize = Math.max(1, Number(merged.pageSize) || base.pageSize);
  merged.order = merged.order === 'asc' ? 'asc' : 'desc';
  merged.q = String(merged.q || '');
  merged.from = merged.from || '';
  merged.to = merged.to || '';
  merged.includeDeleted = Boolean(merged.includeDeleted);
  merged.tags = normalizeTags(merged.tags);
  return merged;
}

export function createHistoryStore({ authFetch, eventStream, initialFilters = {} }) {
  const startFilters = normalizeFiltersInput(initialFilters);
  const state = {
    filters: startFilters,
    items: [],
    meta: {
      total: 0,
      totalPages: 0,
      page: startFilters.page,
      pageSize: startFilters.pageSize,
      order: startFilters.order,
    },
    loading: false,
    error: null,
  };

  const listeners = new Set();
  let unsubscribeEvents = null;
  let reloadTimer = null;
  const scheduler = typeof window !== 'undefined' ? window : globalThis;

  function snapshot() {
    return {
      filters: { ...state.filters, tags: [...state.filters.tags] },
      items: [...state.items],
      meta: { ...state.meta },
      loading: state.loading,
      error: state.error,
    };
  }

  function notify() {
    const current = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(current);
      } catch (error) {
        console.error('history-store listener error', error);
      }
    });
  }

  function attachEvents() {
    if (!eventStream || unsubscribeEvents) return;
    unsubscribeEvents = eventStream.subscribeChannel('history', (payload) => {
      const type = payload.type || 'history:event';
      const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
      if (type === 'history:new') {
        handleHistoryNew(items);
      } else if (type === 'history:update') {
        handleHistoryUpdate(items);
      } else if (type === 'history:delete') {
        handleHistoryDelete(items);
      }
    });
    eventStream.ensure?.();
  }

  function scheduleReload() {
    if (state.loading) return;
    if (reloadTimer != null) return;
    reloadTimer = scheduler.setTimeout(() => {
      reloadTimer = null;
      load();
    }, 300);
  }

  function normalizeIncoming(items) {
    return items
      .map((item) => {
        const key = item?.id ?? item?.uuid;
        if (!key) return null;
        return { ...item, id: String(key) };
      })
      .filter(Boolean);
  }

  function canInlineMergeNewItems() {
    if (state.filters.q) return false;
    if (state.filters.tags.length) return false;
    if (state.filters.from || state.filters.to) return false;
    if (state.filters.includeDeleted) return false;
    if (state.filters.page !== 1) return false;
    if (state.filters.order !== 'desc') return false;
    return true;
  }

  function mergeNewItems(newItems) {
    const normalized = normalizeIncoming(newItems);
    if (!normalized.length) return;

    const ids = new Set(state.items.map((item) => item.id || item.uuid));
    const incoming = normalized.filter((item) => {
      const key = item.id;
      if (!key) return false;
      if (ids.has(key)) return false;
      ids.add(key);
      return true;
    });

    if (!incoming.length) return;

    state.meta.total = (state.meta.total || 0) + incoming.length;

    if (!canInlineMergeNewItems()) {
      notify();
      scheduleReload();
      return;
    }

    state.items = [...incoming, ...state.items];
    const limit = Number(state.filters.pageSize) || 0;
    if (limit > 0 && state.items.length > limit) {
      state.items = state.items.slice(0, limit);
    }
    notify();
  }

  function handleHistoryNew(items) {
    if (!Array.isArray(items) || !items.length) return;
    mergeNewItems(items);
  }

  function handleHistoryUpdate(items) {
    if (!Array.isArray(items) || !items.length) return;
    const map = new Map();
    normalizeIncoming(items).forEach((item) => {
      map.set(item.id, item);
    });
    if (!map.size) return;
    let changed = false;
    state.items = state.items.map((existing) => {
      const key = existing?.id || existing?.uuid;
      if (!key) return existing;
      const normalizedKey = String(key);
      if (!map.has(normalizedKey)) return existing;
      changed = true;
      return { ...existing, ...map.get(normalizedKey) };
    });
    if (changed) {
      notify();
    } else {
      scheduleReload();
    }
  }

  function handleHistoryDelete(items) {
    if (!Array.isArray(items) || !items.length) return;
    const keys = new Set(normalizeIncoming(items).map((item) => item.id));
    if (!keys.size) return;

    const before = state.items.length;
    state.items = state.items.filter((item) => !keys.has(String(item?.id || item?.uuid)));

    if (state.items.length !== before) {
      state.meta.total = Math.max(0, (state.meta.total || before) - keys.size);
      notify();
      scheduleReload();
    } else {
      scheduleReload();
    }
  }

  function buildQueryParams() {
    const params = new URLSearchParams();
    params.set('page', String(state.filters.page));
    params.set('page_size', String(state.filters.pageSize));
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.tags.length) params.set('tags', state.filters.tags.join(','));
    if (state.filters.from) params.set('from', state.filters.from);
    if (state.filters.to) params.set('to', state.filters.to);
    if (state.filters.includeDeleted) params.set('include_deleted', '1');
    if (state.filters.order && state.filters.order !== 'desc') params.set('order', state.filters.order);
    return params;
  }

  async function load() {
    if (!authFetch) {
      state.error = 'no-auth';
      notify();
      return { ok: false, reason: 'no-auth-fetch' };
    }

    state.loading = true;
    state.error = null;
    if (reloadTimer != null) {
      scheduler.clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    notify();

    const params = buildQueryParams();

    try {
      const res = await authFetch(`/api/plot/history?${params.toString()}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        state.error = data?.error || `history:${res.status}`;
        notify();
        return { ok: false, reason: state.error };
      }

      const payload = await res.json().catch(() => ({}));
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = payload?.meta || {};

      state.items = data;
      state.meta.total = Number(meta.total ?? data.length ?? 0);
      state.meta.page = Number(meta.page ?? state.filters.page ?? 1);
      state.meta.pageSize = Number(meta.page_size ?? state.filters.pageSize);
      state.meta.totalPages = Number(meta.total_pages ?? 0);
      state.meta.order = meta.order || state.filters.order;
      state.filters.page = state.meta.page;
      state.filters.pageSize = state.meta.pageSize;
      state.filters.order = state.meta.order;

      notify();
      return { ok: true, data };
    } catch (error) {
      state.error = error?.message || 'network';
      notify();
      return { ok: false, reason: 'network' };
    } finally {
      state.loading = false;
      notify();
    }
  }

  async function updateItem(id, changes = {}) {
    if (!authFetch) return { ok: false, reason: 'no-auth-fetch' };
    const key = typeof id === 'string' ? id.trim() : String(id || '').trim();
    if (!key) return { ok: false, reason: 'invalid-id' };
    let body;
    try {
      body = JSON.stringify(changes || {});
    } catch (error) {
      return { ok: false, reason: 'invalid-payload', error };
    }

    try {
      const res = await authFetch(`/api/plot/history/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, reason: data?.error || `history:${res.status}` };
      }

      const data = await res.json().catch(() => ({}));
      scheduleReload();
      return { ok: true, item: data?.item };
    } catch (error) {
      return { ok: false, reason: 'network', error };
    }
  }

  async function deleteItems(ids) {
    if (!authFetch) return { ok: false, reason: 'no-auth-fetch' };
    const source = Array.isArray(ids) ? ids : [ids];
    const normalized = source
      .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
      .filter((value, index, arr) => value && arr.indexOf(value) === index);

    if (!normalized.length) {
      return { ok: false, reason: 'invalid-ids' };
    }

    const failures = [];
    await Promise.all(
      normalized.map(async (key) => {
        try {
          const res = await authFetch(`/api/plot/history/${encodeURIComponent(key)}`, {
            method: 'DELETE',
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            failures.push({ id: key, reason: data?.error || `history:${res.status}` });
          }
        } catch (error) {
          failures.push({ id: key, reason: 'network', error });
        }
      })
    );

    scheduleReload();

    if (failures.length) {
      return { ok: false, failures };
    }
    return { ok: true };
  }

  function setFilters(partial = {}, options = {}) {
    const next = { ...partial };
    if (next.tags !== undefined) {
      next.tags = normalizeTags(next.tags);
    }
    if (next.pageSize != null) {
      const size = Number(next.pageSize);
      if (!Number.isNaN(size) && size > 0) {
        next.pageSize = size;
      } else {
        delete next.pageSize;
      }
    }
    if (next.page != null) {
      const page = Number(next.page);
      next.page = Number.isNaN(page) || page < 1 ? 1 : page;
    }
    const previousOrder = state.filters.order;
    state.filters = normalizeFiltersInput({ ...state.filters, ...next }, state.filters);
    if (next.order !== undefined && next.order !== previousOrder) {
      options.resetPage = true;
    }
    if (options.resetPage) {
      state.filters.page = 1;
    }
    notify();
    if (options.fetch) return load();
    return Promise.resolve({ ok: true });
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    attachEvents();
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    subscribe,
    load,
    setFilters,
    buildQueryParams,
    getState: snapshot,
    updateItem,
    deleteItems,
  };
}
