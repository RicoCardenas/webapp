import { compileExpression, evaluateCompiled } from '../lib/math.js';
import { ensureHistoryStore } from '../lib/history-store-singleton.js';
import {
  DEFAULT_VIEW,
  EXPRESSION_COLORS,
  MARKER_LIMIT,
  HISTORY_PAGE_SIZE,
} from './plotter-config.js';

/**
 * @typedef {import('./plotter-config.js').PlotterView} PlotterView
 * @typedef {{ id: string, label: string, color: string, compiled: import('mathjs').MathNode, visible: boolean }} PlotterExpression
 * @typedef {{ exprId: string, label: string, color: string, x: number, y: number }} PlotterMarker
 */

/**
 * Create the plotter core logic (no DOM side effects).
 * @param {{ authFetch?: typeof fetch, eventStream?: { subscribeChannel: Function, ensure?: Function } }} [deps]
 */
export function createPlotterCore(deps = {}) {
  const authFetch = deps.authFetch;
  const eventStream = deps.eventStream;
  const historyListeners = new Set();

  const historyStore = ensureHistoryStore({
    authFetch,
    eventStream,
    initialFilters: { pageSize: HISTORY_PAGE_SIZE },
  });

  /** @type {PlotterView} */
  const view = { ...DEFAULT_VIEW };

  /** @type {PlotterExpression[]} */
  const expressions = [];

  /** @type {PlotterMarker[]} */
  const markers = [];

  const history = {
    items: /** @type {Array<Record<string, any>>} */ ([]),
    selected: new Set(),
    q: '',
    tags: /** @type {string[]} */ ([]),
    limit: HISTORY_PAGE_SIZE,
    offset: 0,
    page: 1,
    order: 'desc',
    total: 0,
    loading: false,
    error: null,
  };

  historyStore.subscribe((next) => {
    const normalized = next.items.map((item, index) => {
      const expression = String(item?.expression ?? '');
      const key = item?.id ?? item?.uuid ?? `${expression || 'expr'}-${index}`;
      return { ...item, id: String(key), expression };
    });
    history.items = normalized;
    history.total = Number.isFinite(next.meta?.total) ? next.meta.total : normalized.length;
    history.order = next.filters.order;
    history.q = next.filters.q;
    history.tags = [...next.filters.tags];
    history.limit = next.filters.pageSize;
    history.page = next.filters.page;
    history.offset = (history.page - 1) * history.limit;
    history.loading = next.loading;
    history.error = next.error;

    const validIds = new Set(normalized.map((item) => item.id));
    history.selected.forEach((id) => {
      if (!validIds.has(String(id))) {
        history.selected.delete(id);
      }
    });

    historyListeners.forEach((listener) => {
      try {
        listener(getHistoryState());
      } catch (error) {
        console.error('plotter history listener failed', error);
      }
    });
  });

  function pickColor(index) {
    return EXPRESSION_COLORS[index % EXPRESSION_COLORS.length];
  }

  function normalizeExpression(raw) {
    let s = (raw || '').trim();
    if (!s) return '';
    s = s.replace(/^\s*y\s*=\s*/i, 'f(x)=');
    s = s.replace(/X/g, 'x');
    s = s.replace(/[×·]/g, '*');
    if (!s.includes('=')) s = `f(x)=${s}`;
    const [lhs, ...rest] = s.split('=');
    const rhsRaw = rest.join('=');
    const lhsClean = (lhs || '').replace(/X/g, 'x').trim() || 'f(x)';
    const rhsClean = rhsRaw.trim();
    return `${lhsClean}=${rhsClean}`;
  }

  function ensureEvaluable(compiled) {
    const samples = 9;
    for (let i = 0; i < samples; i += 1) {
      const x = view.xmin + (i / (samples - 1)) * (view.xmax - view.xmin);
      try {
        const y = evaluateCompiled(compiled, { x });
        if (typeof y === 'number' && isFinite(y)) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  }

  function createExpression(raw) {
    const label = normalizeExpression(raw);
    if (!label) {
      return { ok: false, reason: 'empty' };
    }

    const rhs = label.split('=').slice(1).join('=').trim();

    let compiled;
    try {
      compiled = compileExpression(rhs);
    } catch {
      return { ok: false, reason: 'compile' };
    }

    if (!ensureEvaluable(compiled)) {
      return { ok: false, reason: 'not-evaluable' };
    }

    const expr = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      color: pickColor(expressions.length),
      compiled,
      visible: true,
    };

    expressions.push(expr);
    return { ok: true, expression: expr };
  }

  function removeExpression(id) {
    const index = expressions.findIndex((expr) => expr.id === id);
    if (index === -1) return false;
    expressions.splice(index, 1);
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      if (markers[i].exprId === id) markers.splice(i, 1);
    }
    return true;
  }

  function clearExpressions() {
    expressions.splice(0, expressions.length);
    markers.splice(0, markers.length);
  }

  function toggleGrid() {
    view.gridOn = !view.gridOn;
    return view.gridOn;
  }

  function setGrid(state) {
    view.gridOn = state;
    return view.gridOn;
  }

  function getView() {
    return { ...view };
  }

  function setViewBounds(bounds) {
    view.xmin = bounds.xmin;
    view.xmax = bounds.xmax;
    view.ymin = bounds.ymin;
    view.ymax = bounds.ymax;
    return getView();
  }

  function panView(dx, dy) {
    view.xmin += dx;
    view.xmax += dx;
    view.ymin += dy;
    view.ymax += dy;
    return getView();
  }

  function zoomAt(point, factor) {
    const cx = point.x;
    const cy = point.y;
    const spanX = view.xmax - view.xmin;
    const spanY = view.ymax - view.ymin;
    const nextSpanX = spanX * factor;
    const nextSpanY = spanY * factor;

    view.xmin = cx - (cx - view.xmin) * (nextSpanX / spanX);
    view.xmax = cx + (view.xmax - cx) * (nextSpanX / spanX);
    view.ymin = cy - (cy - view.ymin) * (nextSpanY / spanY);
    view.ymax = cy + (view.ymax - cy) * (nextSpanY / spanY);
    return getView();
  }

  function addMarker(marker) {
    markers.unshift(marker);
    if (markers.length > MARKER_LIMIT) {
      markers.pop();
    }
    return marker;
  }

  function clearMarkers() {
    markers.splice(0, markers.length);
  }

  async function fetchHistory(query = '') {
    if (!authFetch) {
      return { ok: false, reason: 'no-auth-fetch' };
    }

    const trimmed = typeof query === 'string' ? query.trim() : '';
    history.selected.clear();
    await historyStore.setFilters({ q: trimmed }, { resetPage: true });
    return historyStore.load();
  }

  function refreshHistory() {
    return historyStore.load();
  }

  function selectHistory(id, selected) {
    if (selected) history.selected.add(id);
    else history.selected.delete(id);
  }

  function clearHistorySelection() {
    history.selected.clear();
  }

  function selectAllHistoryItems(selected) {
    history.selected.clear();
    if (selected) {
      history.items.forEach((item) => {
        if (item?.id) history.selected.add(String(item.id));
      });
    }
  }

  function getHistorySelection() {
    return Array.from(history.selected);
  }

  function getHistoryItems() {
    return history.items.slice();
  }

  function getHistoryState() {
    return {
      items: getHistoryItems(),
      selected: getHistorySelection(),
      q: history.q,
      tags: [...history.tags],
      limit: history.limit,
      offset: history.offset,
      page: history.page,
      order: history.order,
      total: history.total,
      loading: history.loading,
      error: history.error,
    };
  }

  function getSelectedHistoryExpressions() {
    const ids = getHistorySelection();
    return history.items.filter((item) => ids.includes(String(item?.id)));
  }

  function onHistoryChange(listener) {
    historyListeners.add(listener);
    return () => {
      historyListeners.delete(listener);
    };
  }

  return {
    getView,
    setViewBounds,
    panView,
    zoomAt,
    toggleGrid,
    setGrid,
    expressions,
    markers,
    addExpression: createExpression,
    removeExpression,
    clearExpressions,
    addMarker,
    clearMarkers,
    fetchHistory,
    refreshHistory,
    selectHistory,
    clearHistorySelection,
    selectAllHistoryItems,
    getHistorySelection,
    getHistoryItems,
    getSelectedHistoryExpressions,
    onHistoryChange,
    historyStore,
    history,
  };
}
