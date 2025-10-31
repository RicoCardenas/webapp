/**
 * @typedef {Object} PlotterView
 * @property {number} xmin
 * @property {number} xmax
 * @property {number} ymin
 * @property {number} ymax
 * @property {boolean} gridOn
 */

/**
 * Selectors used by the plotter UI.
 */
export const UI_SELECTORS = {
  container: '#ggb-container',
  form: '#plot-form',
  input: '#plot-input',
  list: '#expr-list',
  btnClear: '#btn-clear',
  btnGrid: '#btn-grid',
  btnExport: '#btn-export',
  btnHistory: '#btn-history',
  modalHistory: '#modal-history',
  historySearch: '#history-search',
  historyList: '#history-list',
  historySelectAll: '#history-select-all',
  historyPlotSelected: '#history-plot-selected',
  historyClose: '[data-close="history"]',
  toasts: '#toasts',
  btnFullscreen: '#btn-fullscreen',
};

/**
 * Key used to retrieve the session token.
 */
export const SESSION_KEY = 'ecuplot_session_token';

/**
 * Colors used when new expressions are added.
 */
export const EXPRESSION_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#2dd4bf',
  '#f59e0b',
  '#ef4444',
];

/**
 * Maximum markers kept on screen.
 */
export const MARKER_LIMIT = 40;

/**
 * Default viewport.
 * @type {PlotterView}
 */
export const DEFAULT_VIEW = Object.freeze({
  xmin: -10,
  xmax: 10,
  ymin: -6,
  ymax: 6,
  gridOn: true,
});

export const HISTORY_PAGE_SIZE = 50;
export const FULLSCREEN_CLASS = 'plotter--fullscreen';
export const BODY_LOCK_CLASS = 'plotter-no-scroll';
