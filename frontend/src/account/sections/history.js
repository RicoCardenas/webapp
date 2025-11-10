import { authFetch, toast, eventStream } from '/static/app.js';
import { on } from '../../lib/events.js';
import { ensureHistoryStore } from '../../lib/history-store-singleton.js';
import { requestWithAuth } from '../api-client.js';
import { ui } from '../ui.js';

const historyState = {
  bound: false,
  loading: false,
  exporting: false,
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 0,
  q: '',
  from: '',
  to: '',
  tags: [],
  order: 'desc',
  initialized: false,
  items: [],
  pendingDeletes: new Set(),
  listActionsBound: false,
};

const historyStore = ensureHistoryStore({
  authFetch,
  eventStream,
  initialFilters: {
    page: historyState.page,
    pageSize: historyState.pageSize,
    order: historyState.order,
    q: historyState.q,
  },
});

historyStore.subscribe(handleHistorySnapshot);

function toggleHistoryPanel(force) {
  if (!ui.historyPanel || !ui.historyToggle) return false;
  const shouldOpen = force ?? ui.historyPanel.hidden;
  ui.historyPanel.hidden = !shouldOpen;
  ui.historyToggle.setAttribute('aria-expanded', String(shouldOpen));
  ui.historyToggle.textContent = shouldOpen ? 'Ocultar historial' : 'Mostrar historial';
  if (ui.historyCard) ui.historyCard.setAttribute('data-history-open', shouldOpen ? 'true' : 'false');
  if (ui.historyCollapsed) {
    ui.historyCollapsed.hidden = shouldOpen;
    ui.historyCollapsed.setAttribute('aria-hidden', String(shouldOpen));
  }
  return shouldOpen;
}

function bindHistoryToggle() {
  if (!ui.historyToggle) return;
  ui.historyToggle.setAttribute('aria-expanded', 'false');
  on(ui.historyToggle, 'click', () => {
    const opened = toggleHistoryPanel();
    if (opened) ui.historyPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  if (ui.historyCTA) {
    on(ui.historyCTA, 'click', () => {
      if (toggleHistoryPanel(true)) {
        ui.historyPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
}

function bindHistoryPanel() {
  if (historyState.bound) return;
  historyState.bound = true;

  if (ui.historyFiltersForm) {
    on(ui.historyFiltersForm, 'submit', handleHistoryFiltersSubmit);
    on(ui.historyFiltersForm, 'reset', handleHistoryFiltersReset);
  }
  if (ui.historyOrder instanceof HTMLSelectElement) {
    on(ui.historyOrder, 'change', handleHistoryOrderChange);
  }
  if (ui.historyPrev) {
    on(ui.historyPrev, 'click', handleHistoryPrev);
  }
  if (ui.historyNext) {
    on(ui.historyNext, 'click', handleHistoryNext);
  }
  if (ui.historyExportButtons?.length) {
    ui.historyExportButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        on(button, 'click', handleHistoryExportClick);
      }
    });
  }

  if (ui.historyList && !historyState.listActionsBound) {
    historyState.listActionsBound = true;
    on(ui.historyList, 'click', handleHistoryListClick);
  }
}

function parseTagsInput(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function syncHistoryFormInputs() {
  if (ui.historySearch instanceof HTMLInputElement && ui.historySearch.value !== historyState.q) {
    ui.historySearch.value = historyState.q;
  }
  if (ui.historyFrom instanceof HTMLInputElement && ui.historyFrom.value !== historyState.from) {
    ui.historyFrom.value = historyState.from;
  }
  if (ui.historyTo instanceof HTMLInputElement && ui.historyTo.value !== historyState.to) {
    ui.historyTo.value = historyState.to;
  }
  if (ui.historyTags instanceof HTMLInputElement) {
    const current = historyState.tags.join(', ');
    if (ui.historyTags.value !== current) ui.historyTags.value = current;
  }
  if (ui.historyOrder instanceof HTMLSelectElement) {
    const desired = historyState.order || 'desc';
    if (ui.historyOrder.value !== desired) ui.historyOrder.value = desired;
  }
}

function setHistoryLoading(isLoading) {
  historyState.loading = Boolean(isLoading);
  if (ui.historyLoading) ui.historyLoading.hidden = !historyState.loading;
  if (ui.historyList) {
    ui.historyList.classList.toggle('history-list--loading', historyState.loading);
    ui.historyList.setAttribute('aria-busy', historyState.loading ? 'true' : 'false');
  }
  if (ui.historyFiltersForm) {
    const submitBtn = ui.historyFiltersForm.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = historyState.loading;
  }
  ui.historyExportButtons?.forEach((button) => {
    if (button instanceof HTMLButtonElement && !historyState.exporting) {
      button.disabled = historyState.loading;
    }
  });
  if (ui.historyPrev instanceof HTMLButtonElement) {
    ui.historyPrev.disabled = historyState.loading || historyState.page <= 1;
  }
  if (ui.historyNext instanceof HTMLButtonElement) {
    const atEnd = historyState.totalPages > 0 && historyState.page >= historyState.totalPages;
    ui.historyNext.disabled = historyState.loading || atEnd;
  }
}

function handleHistorySnapshot(snapshot) {
  const filters = snapshot.filters || {};
  const meta = snapshot.meta || {};

  historyState.page = Number(filters.page ?? historyState.page ?? 1) || 1;
  historyState.pageSize = Number(filters.pageSize ?? historyState.pageSize ?? 10) || 10;
  historyState.q = filters.q || '';
  historyState.from = filters.from || '';
  historyState.to = filters.to || '';
  historyState.tags = Array.isArray(filters.tags) ? [...filters.tags] : [];
  historyState.order = filters.order || 'desc';
  const totalFromMeta = Number(meta.total ?? meta.count);
  if (Number.isFinite(totalFromMeta) && totalFromMeta >= 0) {
    historyState.total = totalFromMeta;
  } else if (Array.isArray(snapshot.items)) {
    historyState.total = snapshot.items.length;
  }

  const totalPagesFromMeta = Number(meta.totalPages ?? meta.total_pages);
  if (Number.isFinite(totalPagesFromMeta) && totalPagesFromMeta >= 0) {
    historyState.totalPages = totalPagesFromMeta;
  }

  setHistoryLoading(snapshot.loading);

  if (snapshot.error) {
    const message = describeHistoryError(snapshot.error);
    showHistoryError(message);
  } else {
    clearHistoryError();
  }

  historyState.items = Array.isArray(snapshot.items)
    ? snapshot.items.map((item) => ({ ...item, tags: Array.isArray(item?.tags) ? [...item.tags] : [] }))
    : [];
  if (!snapshot.loading) historyState.initialized = true;
  const validIds = new Set(historyState.items.map((item) => String(item?.id ?? '')));
  Array.from(historyState.pendingDeletes).forEach((id) => {
    if (!validIds.has(id)) {
      historyState.pendingDeletes.delete(id);
    }
  });

  renderHistoryItems(historyState.items);
  updateHistoryPagination({
    total: historyState.total,
    total_pages: historyState.totalPages,
    page: historyState.page,
    page_size: historyState.pageSize,
  });

  if (ui.historyCount) {
    if (Number.isFinite(historyState.total) && historyState.total > 0) {
      ui.historyCount.textContent = historyState.total === 1 ? '1 registro' : `${historyState.total} registros`;
    } else {
      const count = historyState.items.length;
      ui.historyCount.textContent = count === 1 ? '1 registro' : `${count} registros`;
    }
  }

  syncHistoryFormInputs();
}

function describeHistoryError(code) {
  if (!code) return '';
  if (typeof code === 'string') {
    if (code.startsWith('history:')) return 'No se pudo cargar el historial.';
    if (code === 'network') return 'Error de red al cargar el historial.';
    if (code === 'no-auth-fetch' || code === 'no-auth') return 'Inicia sesión para ver el historial.';
  }
  return typeof code === 'string' ? code : 'Error al cargar el historial.';
}

function updateHistoryPagination(meta) {
  historyState.total = Number(meta?.total ?? historyState.total ?? 0);
  historyState.totalPages = Number(meta?.total_pages ?? historyState.totalPages ?? 0);
  const pageFromMeta = Number(meta?.page);
  if (!Number.isNaN(pageFromMeta) && pageFromMeta > 0) {
    historyState.page = pageFromMeta;
  }
  const pageSizeFromMeta = Number(meta?.page_size);
  if (!Number.isNaN(pageSizeFromMeta) && pageSizeFromMeta > 0) {
    historyState.pageSize = pageSizeFromMeta;
  }

  const totalPages = historyState.totalPages || 0;
  const paginationHidden = totalPages <= 1 && historyState.page <= 1;
  if (ui.historyPagination) ui.historyPagination.hidden = paginationHidden;

  if (ui.historyPageInfo) {
    const pagesLabel = totalPages > 0 ? totalPages : 1;
    const currentPage = historyState.page > 0 ? historyState.page : 1;
    ui.historyPageInfo.textContent = `Página ${currentPage} de ${pagesLabel}`;
  }

  if (ui.historyPrev instanceof HTMLButtonElement) {
    ui.historyPrev.disabled = historyState.loading || historyState.page <= 1;
  }
  if (ui.historyNext instanceof HTMLButtonElement) {
    const atEnd = totalPages === 0 || historyState.page >= totalPages;
    ui.historyNext.disabled = historyState.loading || atEnd;
  }
}

function renderHistoryItems(items) {
  if (!ui.historyList) return;
  ui.historyList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    if (historyState.loading) {
      if (ui.historyEmpty) ui.historyEmpty.hidden = true;
      return;
    }
    if (!historyState.initialized) {
      if (ui.historyEmpty) ui.historyEmpty.hidden = true;
      return;
    }
    if (ui.historyEmpty) {
      ui.historyEmpty.hidden = false;
      const message = ui.historyEmpty.querySelector('p');
      if (message) message.textContent = 'No encontramos registros para los filtros actuales.';
    }
    return;
  }

  if (ui.historyEmpty) ui.historyEmpty.hidden = true;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    if (item?.id != null) {
      const id = String(item.id);
      li.dataset.historyId = id;
      if (historyState.pendingDeletes.has(id)) {
        li.classList.add('history-item--pending');
      }
    }

    const main = document.createElement('div');
    main.className = 'history-item__main';

  const expressionText = typeof item?.expression === 'string' ? item.expression : '';
  const titleText = typeof item?.title === 'string' ? item.title : '';
  const rawExpression = expressionText.trim();
  const rawTitle = titleText.trim();
  const displayLabel = rawTitle || rawExpression || 'Expresión guardada';

    const label = document.createElement('span');
    label.className = 'history-expr';
    label.textContent = displayLabel;
  if (rawExpression) label.title = expressionText;
    main.appendChild(label);

    if (item?.deleted) {
      const badge = document.createElement('span');
      badge.className = 'history-badge history-badge--deleted';
      badge.textContent = 'Eliminado';
      main.appendChild(badge);
    }

    if (item?.created_at) {
      const timestamp = document.createElement('time');
      timestamp.className = 'history-date';
      timestamp.dateTime = item.created_at;
      const formatted = formatHistoryDate(item.created_at);
      timestamp.textContent = formatted || item.created_at;
      main.appendChild(timestamp);
    }

    li.appendChild(main);

    const metaContainer = document.createElement('div');
    metaContainer.className = 'history-item__meta';

    if (rawExpression && rawTitle && rawExpression !== rawTitle) {
      const expression = document.createElement('code');
      expression.className = 'history-formula';
      expression.textContent = expressionText.trim() || expressionText;
      metaContainer.appendChild(expression);
    }

    if (Array.isArray(item?.tags) && item.tags.length) {
      const tags = document.createElement('ul');
      tags.className = 'history-tags';
      item.tags.forEach((tag) => {
        if (!tag) return;
        const chip = document.createElement('li');
        chip.className = 'history-tag';
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      metaContainer.appendChild(tags);
    }

    if (item?.variables && typeof item.variables === 'object' && Object.keys(item.variables).length) {
      const variables = document.createElement('dl');
      variables.className = 'history-item__variables';
      Object.entries(item.variables).forEach(([key, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
  dd.textContent = typeof value === 'number' ? value.toString() : String(value ?? '');
        variables.append(dt, dd);
      });
      metaContainer.appendChild(variables);
    }

    const id = item?.id != null ? String(item.id) : null;
    const isPendingDelete = id ? historyState.pendingDeletes.has(id) : false;

    if (id) {
      const actions = document.createElement('div');
      actions.className = 'history-item__actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn--ghost btn--sm history-item__delete';
      deleteBtn.dataset.historyAction = 'delete';
      deleteBtn.textContent = isPendingDelete ? 'Eliminando...' : item?.deleted ? 'Eliminado' : 'Eliminar';
      if (isPendingDelete || item?.deleted) {
        deleteBtn.disabled = true;
      }
      actions.appendChild(deleteBtn);
      metaContainer.appendChild(actions);
    }

    if (metaContainer.childElementCount > 0) {
      li.appendChild(metaContainer);
    }

    ui.historyList.appendChild(li);
  });
}

function handleHistoryListClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-history-action]') : null;
  if (!target) return;
  const action = target.dataset.historyAction;
  if (action !== 'delete') return;

  event.preventDefault();
  const host = target.closest('[data-history-id]');
  const id = host?.dataset.historyId;
  if (!id || historyState.pendingDeletes.has(id)) return;

  requestHistoryDelete(id);
}

function describeHistoryDeleteError(result) {
  const failure = Array.isArray(result?.failures) && result.failures.length ? result.failures[0] : null;
  const reason = failure?.reason || result?.reason;
  switch (reason) {
    case 'no-auth-fetch':
    case 'no-auth':
    case 'no-auth-delete':
      return 'Inicia sesión para eliminar registros del historial.';
    case 'network':
      return 'Error de red al eliminar el registro del historial.';
    default:
      return 'No se pudo eliminar el registro del historial.';
  }
}

async function requestHistoryDelete(id) {
  const confirmMessage = '¿Deseas eliminar este registro del historial?';
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
  }

  historyState.pendingDeletes.add(id);
  renderHistoryItems(historyState.items);

  try {
    const result = await historyStore.deleteItems(id);
    if (!result?.ok) {
      historyState.pendingDeletes.delete(id);
      renderHistoryItems(historyState.items);
      const message = describeHistoryDeleteError(result);
      console.warn('history delete failed', result);
      toast?.error?.(message);
      showHistoryError(message);
      return;
    }
    clearHistoryError();
    toast?.success?.('Registro eliminado del historial.');
  } catch (error) {
    historyState.pendingDeletes.delete(id);
    renderHistoryItems(historyState.items);
    console.error('history delete error', error);
    const message = 'No se pudo eliminar el registro del historial.';
    toast?.error?.(message);
    showHistoryError(message);
  }
}

function formatHistoryDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function handleHistoryFiltersSubmit(event) {
  event.preventDefault();
  clearHistoryError();
  const q = ui.historySearch instanceof HTMLInputElement ? ui.historySearch.value.trim() : '';
  const from = ui.historyFrom instanceof HTMLInputElement ? ui.historyFrom.value : '';
  const to = ui.historyTo instanceof HTMLInputElement ? ui.historyTo.value : '';
  const tags = ui.historyTags instanceof HTMLInputElement ? parseTagsInput(ui.historyTags.value) : [];
  const order = ui.historyOrder instanceof HTMLSelectElement ? ui.historyOrder.value : historyState.order;
  historyStore.setFilters({ page: 1, q, from, to, tags, order }, { resetPage: true, fetch: true });
}

function handleHistoryFiltersReset(event) {
  event.preventDefault();
  if (ui.historyFiltersForm) ui.historyFiltersForm.reset();
  clearHistoryError();
  if (ui.historyOrder instanceof HTMLSelectElement) {
    ui.historyOrder.value = 'desc';
  }
  historyStore.setFilters({ page: 1, q: '', from: '', to: '', tags: [], order: 'desc' }, { resetPage: true, fetch: true });
}

function handleHistoryPrev(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.page <= 1) return;
  historyStore.setFilters({ page: historyState.page - 1 }, { fetch: true });
}

function handleHistoryNext(event) {
  event.preventDefault();
  if (historyState.loading) return;
  if (historyState.totalPages && historyState.page >= historyState.totalPages) return;
  historyStore.setFilters({ page: historyState.page + 1 }, { fetch: true });
}

async function handleHistoryExportClick(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement)) return;
  const format = button.dataset.historyExport;
  if (!format || historyState.exporting) return;
  await exportHistory(format, button);
}

function handleHistoryOrderChange(event) {
  const select = event?.currentTarget;
  if (!(select instanceof HTMLSelectElement)) return;
  const value = select.value === 'asc' ? 'asc' : 'desc';
  clearHistoryError();
  historyStore.setFilters({ order: value }, { resetPage: true, fetch: true });
}

async function exportHistory(format, button) {
  historyState.exporting = true;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Generando...';
  clearHistoryError();

  try {
    const params = historyStore.buildQueryParams();
    params.set('format', format);
    const res = await requestWithAuth(`/api/plot/history/export?${params.toString()}`);
    if (!res) return;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = data?.error || 'No se pudo exportar el historial.';
      showHistoryError(message);
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const fallbackName = `plot-history-${Date.now()}.${format}`;
    const filename = match ? match[1] : fallbackName;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  } catch (error) {
    console.error('history export failed', error);
    showHistoryError('No se pudo exportar el historial.');
  } finally {
    historyState.exporting = false;
    button.disabled = false;
    button.textContent = originalLabel || 'Exportar';
  }
}

function clearHistoryError() {
  if (!ui.historyError) return;
  ui.historyError.textContent = '';
  ui.historyError.hidden = true;
}

function showHistoryError(message) {
  if (!ui.historyError) return;
  ui.historyError.textContent = message;
  ui.historyError.hidden = false;
}

function resetHistoryUI() {
  if (ui.historyCount) ui.historyCount.textContent = '—';
  if (ui.historyList) ui.historyList.replaceChildren();
  if (ui.historyEmpty) {
    ui.historyEmpty.hidden = false;
    const message = ui.historyEmpty.querySelector('p');
    if (message) message.textContent = 'Inicia sesión para ver tu historial.';
  }
  if (ui.historyFiltersForm) ui.historyFiltersForm.reset();
  if (ui.historyError) {
    ui.historyError.textContent = '';
    ui.historyError.hidden = true;
  }
  if (ui.historyPagination) ui.historyPagination.hidden = true;
  if (ui.historyPrev instanceof HTMLButtonElement) ui.historyPrev.disabled = true;
  if (ui.historyNext instanceof HTMLButtonElement) ui.historyNext.disabled = true;
  if (ui.historyPageInfo) ui.historyPageInfo.textContent = 'Página 1 de 1';
  historyState.page = 1;
  historyState.total = 0;
  historyState.totalPages = 0;
  historyState.q = '';
  historyState.from = '';
  historyState.to = '';
  historyState.tags = [];
  historyState.loading = false;
  historyState.exporting = false;
  historyState.initialized = false;
  historyState.pendingDeletes.clear();
  toggleHistoryPanel(false);
}

export async function loadHistory() {
  clearHistoryError();
  if (!historyState.initialized) {
    await historyStore.setFilters({
      page: historyState.page,
      pageSize: historyState.pageSize,
      order: historyState.order,
      q: historyState.q,
    }, { resetPage: true });
  }
  historyState.initialized = true;
  await historyStore.load();
}

export function createHistorySection() {
  return {
    init() {
      bindHistoryToggle();
      bindHistoryPanel();
    },
    load: loadHistory,
    reset: resetHistoryUI,
    toggle: toggleHistoryPanel,
  };
}
