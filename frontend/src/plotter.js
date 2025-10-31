import { authFetch, toast } from './app.js';
import { qs, qsa } from './lib/dom.js';
import { on } from './lib/events.js';
import { createPlotterCore } from './plotter/plotter-core.js';
import { createPlotterRenderer } from './plotter/plotter-render.js';
import {
  SESSION_KEY,
  UI_SELECTORS,
} from './plotter/plotter-config.js';

injectFullscreenStyles();

const expressionNodes = new Map();

const container = qs(UI_SELECTORS.container);
const core = createPlotterCore({
  authFetch,
  getSessionToken: () => localStorage.getItem(SESSION_KEY),
});

const renderer = container instanceof HTMLElement
  ? createPlotterRenderer({
      container,
      core,
      onHover: (detail) => dispatchPlotterEvent('plotter:hover', detail),
      onHoverEnd: () => dispatchPlotterEvent('plotter:hover-end'),
      onMarker: handleMarkerSelection,
    })
  : null;

if (renderer) {
  window.enterPlotFullscreen = renderer.enterFullscreen;
  window.exitPlotFullscreen = renderer.exitFullscreen;
} else {
  console.warn('[plotter] Canvas container not found, plotter disabled.');
}

bindUI();

function bindUI() {
  bindForm();
  bindControls();
  bindHistoryModal();
}

function addExpressionText(raw) {
  const value = typeof raw === 'string' ? raw : String(raw ?? '');
  const result = core.addExpression(value);
  if (!result.ok) {
    handleExpressionError(result.reason);
    return null;
  }

  const expression = result.expression;
  renderExpressionChip(expression);
  renderer?.requestRender();
  toast?.success?.('Expresión añadida.');
  persistExpression(expression.label);
  return expression;
}

function bindForm() {
  const form = qs(UI_SELECTORS.form);
  const input = qs(UI_SELECTORS.input);
  if (!form || !(input instanceof HTMLInputElement)) return;

  on(form, 'submit', (event) => {
    event.preventDefault();
    addExpressionFromInput(input);
  });

  on(input, 'keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      addExpressionFromInput(input);
    }
  });
}

function bindControls() {
  const btnClear = qs(UI_SELECTORS.btnClear);
  const btnGrid = qs(UI_SELECTORS.btnGrid);
  const btnExport = qs(UI_SELECTORS.btnExport);
  const btnHistory = qs(UI_SELECTORS.btnHistory);
  const btnFullscreen = qs(UI_SELECTORS.btnFullscreen);

  on(btnClear, 'click', () => {
    clearExpressions();
  });

  on(btnGrid, 'click', () => {
    const isOn = core.toggleGrid();
    updateGridButton(btnGrid, isOn);
    renderer?.requestRender();
  });

  if (btnGrid) updateGridButton(btnGrid, core.getView().gridOn);

  on(btnExport, 'click', exportPNG);

  on(btnHistory, 'click', async () => {
    openHistoryModal();
    core.clearHistorySelection();
    await fetchAndRenderHistory('');
  });

  on(btnFullscreen, 'click', () => {
    if (!renderer) return;
    if (container?.classList.contains('plotter--fullscreen')) {
      renderer.exitFullscreen();
    } else {
      renderer.enterFullscreen();
    }
  });
}

function bindHistoryModal() {
  const modal = qs(UI_SELECTORS.modalHistory);
  if (!modal) return;

  qsa(UI_SELECTORS.historyClose, modal).forEach((node) => {
    on(node, 'click', closeHistoryModal);
  });

  const search = qs(UI_SELECTORS.historySearch, modal);
  if (search) {
    on(search, 'input', debounceSearch(async () => {
      const query = search.value.trim();
      await fetchAndRenderHistory(query);
    }));
  }

  const selectAll = qs(UI_SELECTORS.historySelectAll, modal);
  if (selectAll instanceof HTMLInputElement) {
    on(selectAll, 'change', () => {
      core.selectAllHistoryItems(selectAll.checked);
      renderHistoryList();
      syncHistorySelectAll();
    });
  }

  const plotSelectedBtn = qs(UI_SELECTORS.historyPlotSelected, modal);
  on(plotSelectedBtn, 'click', () => {
    plotSelectedHistory();
  });
}

function addExpressionFromInput(input) {
  const expression = addExpressionText(input.value);
  if (!expression) return;
  input.value = '';
  input.focus();
}

function renderExpressionChip(expression) {
  const host = qs(UI_SELECTORS.list);
  if (!host) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.dataset.id = expression.id;

  const swatch = document.createElement('span');
  swatch.className = 'chip__swatch';
  swatch.style.background = expression.color;

  const label = document.createElement('span');
  label.className = 'chip__label';
  label.textContent = expression.label;

  const close = document.createElement('span');
  close.className = 'chip__close';
  close.setAttribute('aria-hidden', 'true');
  close.textContent = '✕';

  button.appendChild(swatch);
  button.appendChild(label);
  button.appendChild(close);

  on(button, 'click', () => removeExpression(expression.id));

  host.appendChild(button);
  expressionNodes.set(expression.id, button);
}

function removeExpression(id) {
  if (!core.removeExpression(id)) return;
  const node = expressionNodes.get(id);
  node?.remove();
  expressionNodes.delete(id);
  renderer?.requestRender();
}

function clearExpressions() {
  core.clearExpressions();
  expressionNodes.forEach((node) => node.remove());
  expressionNodes.clear();
  renderer?.requestRender();
}

function updateGridButton(button, isOn) {
  if (!button) return;
  button.textContent = `Cuadrícula: ${isOn ? 'ON' : 'OFF'}`;
  button.setAttribute('aria-pressed', String(isOn));
}

function exportPNG() {
  const canvas = renderer?.getCanvas();
  if (!canvas) {
    toast?.error?.('No se encontró el lienzo para exportar.');
    return;
  }
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'ecuplot.png';
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function openHistoryModal() {
  const modal = qs(UI_SELECTORS.modalHistory);
  if (!modal) return;
  modal.classList.add('is-open');
}

function closeHistoryModal() {
  const modal = qs(UI_SELECTORS.modalHistory);
  if (!modal) return;
  modal.classList.remove('is-open');
}

async function fetchAndRenderHistory(query) {
  const result = await core.fetchHistory(query);
  if (!result.ok) {
    if (result.reason === 'unauthorized') {
      toast?.warn?.('Inicia sesión para ver tu historial.');
    } else if (result.reason === 'bad-response') {
      toast?.error?.('No se pudo cargar el historial.');
    } else if (result.reason === 'network') {
      toast?.error?.('Error de red al cargar el historial.');
    }
    return;
  }
  renderHistoryList();
  syncHistorySelectAll();
}

function renderHistoryList() {
  const list = qs(UI_SELECTORS.historyList);
  if (!list) return;

  list.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const items = core.getHistoryItems();

  items.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'history__row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'history__check';
    checkbox.value = item.id;
    checkbox.checked = core.history.selected.has(item.id);

    on(checkbox, 'change', () => {
      core.selectHistory(item.id, checkbox.checked);
      syncHistorySelectAll();
    });

    const expr = document.createElement('span');
    expr.className = 'history__expr';
    expr.textContent = item.expression || '';

    const date = document.createElement('time');
    date.className = 'history__date';
    date.textContent = item.created_at
      ? new Date(item.created_at).toLocaleString()
      : '';

    row.appendChild(checkbox);
    row.appendChild(expr);
    row.appendChild(date);
    fragment.appendChild(row);
  });

  list.appendChild(fragment);
}

function syncHistorySelectAll() {
  const selectAll = qs(UI_SELECTORS.historySelectAll);
  if (!(selectAll instanceof HTMLInputElement)) return;
  const items = core.getHistoryItems();
  const totalSelected = core.getHistorySelection().length;
  selectAll.indeterminate = totalSelected > 0 && totalSelected < items.length;
  selectAll.checked = totalSelected > 0 && totalSelected === items.length;
}

function plotSelectedHistory() {
  const items = core.getSelectedHistoryExpressions();
  if (!items.length) {
    toast?.warn?.('No hay expresiones seleccionadas.');
    return;
  }

  items.forEach((item) => {
    addExpressionText(item.expression || '');
  });

  closeHistoryModal();
}

function handleMarkerSelection(marker) {
  core.addMarker(marker);
  renderer?.requestRender();
  dispatchPlotterEvent('plotter:point', marker);
}

function persistExpression(label) {
  if (!localStorage.getItem(SESSION_KEY)) return;
  authFetch('/api/plot', {
    method: 'POST',
    body: JSON.stringify({ expression: label }),
  }).catch((error) => {
    console.warn('Persist plot expression failed', error);
  });
}

function dispatchPlotterEvent(name, detail) {
  if (!(container instanceof HTMLElement)) return;
  container.dispatchEvent(new CustomEvent(name, { detail }));
}

function handleExpressionError(reason) {
  switch (reason) {
    case 'empty':
      toast?.warn?.('Escribe una expresión.');
      break;
    case 'compile':
      toast?.error?.('Expresión inválida. Tip: para trozos usa if(cond, expr1, expr2).');
      break;
    case 'not-evaluable':
      toast?.error?.('La expresión no depende de x o tiene variables desconocidas.');
      break;
    default:
      toast?.error?.('No se pudo añadir la expresión.');
  }
}

function injectFullscreenStyles() {
  if (document.querySelector('[data-plotter-style="fullscreen"]')) return;
  const tag = document.createElement('style');
  tag.setAttribute('data-plotter-style', 'fullscreen');
  tag.textContent = `
  .plotter--fullscreen {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 1000 !important;
    background: var(--color-bg, #0b1020);
  }
  body.plotter-no-scroll { overflow: hidden !important; }
  `;
  document.head.appendChild(tag);
}

function debounceSearch(fn, delay = 250) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}
