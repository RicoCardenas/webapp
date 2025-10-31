import { compileExpression, evaluateCompiled } from '../lib/math.js';
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
 * @param {{ authFetch?: typeof fetch, getSessionToken?: () => string | null }} [deps]
 */
export function createPlotterCore(deps = {}) {
  const authFetch = deps.authFetch;
  const getSessionToken = deps.getSessionToken ?? (() => null);

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
    limit: HISTORY_PAGE_SIZE,
    offset: 0,
    total: 0,
  };

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
    if (!getSessionToken()) {
      return { ok: false, reason: 'unauthorized' };
    }

    history.q = query;
    history.selected.clear();

    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('limit', String(history.limit));
    params.set('offset', String(history.offset));

    let response;
    try {
      response = await authFetch(`/api/plot/history?${params.toString()}`);
    } catch (error) {
      console.error('History request failed', error);
      return { ok: false, reason: 'network' };
    }

    if (!response || !response.ok) {
      return { ok: false, reason: 'bad-response', status: response?.status };
    }

    const data = await response.json().catch(() => ({}));
    const items = Array.isArray(data?.items) ? data.items : [];
    history.items = items.map((item, index) => {
      const expression = String(item?.expression ?? '');
      const id =
        item?.id != null
          ? String(item.id)
          : `${expression || 'expr'}-${index}`;
      return { ...item, id, expression };
    });
    history.total = Number.isFinite(data?.total) ? data.total : history.items.length;
    return { ok: true, items: history.items, total: history.total };
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

  function getSelectedHistoryExpressions() {
    const ids = getHistorySelection();
    return history.items.filter((item) => ids.includes(String(item?.id)));
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
    selectHistory,
    clearHistorySelection,
    selectAllHistoryItems,
    getHistorySelection,
    getHistoryItems,
    getSelectedHistoryExpressions,
    history,
  };
}
