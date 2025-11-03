import { authFetch, toast, eventStream } from './app.js';
import { qs, qsa } from './lib/dom.js';
import { on } from './lib/events.js';
import { niceStep, formatTick } from './lib/math.js';
import { createPlotterCore } from './plotter/plotter-core.js';
import { createPlotterRenderer } from './plotter/plotter-render.js';
import { UI_SELECTORS } from './plotter/plotter-config.js';
import { hasSessionToken } from './lib/session.js';

injectFullscreenStyles();

const expressionNodes = new Map();

const container = qs(UI_SELECTORS.container);
const core = createPlotterCore({
  authFetch,
  eventStream,
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

core.onHistoryChange(() => {
  renderHistoryList();
  syncHistorySelectAll();
  syncHistoryOrderInputs(core.history.order);
});

function bindUI() {
  bindForm();
  bindControls();
  bindHistoryModal();
  bindHistoryPanel();
  bindShortcuts();
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
  const btnExportSvg = qs(UI_SELECTORS.btnExportSvg);
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
  on(btnExportSvg, 'click', exportSVG);

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

  setupHistorySearch(modal);
  setupHistoryOrder(modal);
  setupHistorySelectAll(modal);
  setupHistoryPlotSelected(modal);
}

function bindHistoryPanel() {
  const tabFunctions = qs(UI_SELECTORS.historyPanelTabFunctions);
  const tabHistory = qs(UI_SELECTORS.historyPanelTabHistory);
  const sectionFunctions = qs(UI_SELECTORS.historyPanelFunctions);
  const sectionHistory = qs(UI_SELECTORS.historyPanelHistory);
  const panelBody = sectionFunctions?.parentElement;
  if (!tabFunctions || !tabHistory || !sectionFunctions || !sectionHistory) return;

  let activeTab = 'functions';
  if (panelBody instanceof HTMLElement && panelBody.classList.contains('functions-panel__body--history')) {
    activeTab = 'history';
  }

  const applyTabState = () => {
    const showHistory = activeTab === 'history';
    tabHistory.classList.toggle('is-active', showHistory);
    tabFunctions.classList.toggle('is-active', !showHistory);
    tabHistory.setAttribute('aria-pressed', String(showHistory));
    tabFunctions.setAttribute('aria-pressed', String(!showHistory));
    sectionHistory.hidden = !showHistory;
    sectionFunctions.hidden = showHistory;
    if (panelBody instanceof HTMLElement) {
      panelBody.classList.toggle('functions-panel__body--history', showHistory);
    }
  };

  applyTabState();

  const ensureHistoryLoaded = async () => {
    const query = getHistoryQuery(sectionHistory);
    await fetchAndRenderHistory(query);
  };

  on(tabFunctions, 'click', () => {
    if (activeTab === 'functions') return;
    activeTab = 'functions';
    applyTabState();
  });

  on(tabHistory, 'click', async () => {
    if (activeTab !== 'history') {
      activeTab = 'history';
      applyTabState();
      core.clearHistorySelection();
      renderHistoryList();
      syncHistorySelectAll();
      syncHistoryOrderInputs(core.history.order);
    }
    await ensureHistoryLoaded();
  });

  const refreshBtn = qs(UI_SELECTORS.historyPanelRefresh, sectionHistory);
  if (refreshBtn) {
    on(refreshBtn, 'click', async () => {
      core.clearHistorySelection();
      renderHistoryList();
      syncHistorySelectAll();
      syncHistoryOrderInputs(core.history.order);
      await ensureHistoryLoaded();
    });
  }

  setupHistorySearch(sectionHistory);
  setupHistoryOrder(sectionHistory);
  setupHistorySelectAll(sectionHistory);
  setupHistoryPlotSelected(sectionHistory, { closeModal: false });
}

function setupHistorySearch(root) {
  const search = qs(UI_SELECTORS.historySearch, root);
  if (!(search instanceof HTMLInputElement)) return;
  on(search, 'input', debounceSearch(async () => {
    const query = search.value.trim();
    await fetchAndRenderHistory(query);
  }));
}

function setupHistorySelectAll(root) {
  const selectAll = qs(UI_SELECTORS.historySelectAll, root);
  if (!(selectAll instanceof HTMLInputElement)) return;
  on(selectAll, 'change', () => {
    core.selectAllHistoryItems(selectAll.checked);
    renderHistoryList();
    syncHistorySelectAll();
  });
}

function setupHistoryOrder(root) {
  const select = qs(UI_SELECTORS.historyOrder, root);
  if (!(select instanceof HTMLSelectElement)) return;
  on(select, 'change', () => {
    const value = select.value === 'asc' ? 'asc' : 'desc';
    syncHistoryOrderInputs(value);
    core.historyStore.setFilters({ order: value }, { resetPage: true, fetch: true });
  });
  syncHistoryOrderInputs(core.history.order);
}

function setupHistoryPlotSelected(root, options = {}) {
  const plotSelectedBtn = qs(UI_SELECTORS.historyPlotSelected, root);
  if (!plotSelectedBtn) return;
  const { closeModal = true } = options;
  on(plotSelectedBtn, 'click', () => {
    plotSelectedHistory({ closeModal });
  });
}

function getHistoryQuery(root) {
  const search = qs(UI_SELECTORS.historySearch, root);
  return search instanceof HTMLInputElement ? search.value.trim() : '';
}

function bindShortcuts() {
  const input = qs(UI_SELECTORS.input);
  const gridButton = qs(UI_SELECTORS.btnGrid);

  on(window, 'keydown', (event) => {
    const key = event.key;
    const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';
    const typing = isTypingTarget(event.target);

    if ((event.ctrlKey || event.metaKey) && key === 'Enter') {
      if (typing) return;
      event.preventDefault();
      if (input instanceof HTMLInputElement) {
        addExpressionFromInput(input);
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
      if (lowerKey === 'e') {
        event.preventDefault();
        exportPNG();
        return;
      }
      if (lowerKey === 's') {
        event.preventDefault();
        exportSVG();
        return;
      }
    }

    if (typing) return;

    if (!event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === 'g') {
      event.preventDefault();
      const isOn = core.toggleGrid();
      updateGridButton(gridButton, isOn);
      renderer?.requestRender();
      return;
    }
  });
}

function isTypingTarget(target) {
  if (!(target instanceof EventTarget)) return false;
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  const editable = element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  if (!editable) return false;
  if (editable instanceof HTMLInputElement) {
    const type = (editable.type || 'text').toLowerCase();
    switch (type) {
      case 'button':
      case 'checkbox':
      case 'color':
      case 'file':
      case 'hidden':
      case 'image':
      case 'radio':
      case 'range':
      case 'reset':
      case 'submit':
        return false;
      default:
        return true;
    }
  }
  return true;
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
  triggerDownload('ecuplot.png', url);
}

function exportSVG() {
  const canvas = renderer?.getCanvas();
  if (!canvas) {
    toast?.error?.('No se encontró el lienzo para exportar.');
    return;
  }

  const { width, height } = getCanvasDimensions(canvas);
  if (!width || !height) {
    toast?.error?.('No se pudo determinar el tamaño de la gráfica.');
    return;
  }

  const view = core.getView();
  const styles = getComputedStyle(container || document.body);
  const background = (styles.getPropertyValue('--color-panel') || styles.getPropertyValue('--color-surface') || '#0b1020').trim() || '#0b1020';
  const gridLine = (styles.getPropertyValue('--grid-line') || 'rgba(148, 163, 184, 0.18)').trim();
  const gridAxis = (styles.getPropertyValue('--grid-axis') || 'rgba(224, 231, 255, 0.42)').trim();
  const gridText = (styles.getPropertyValue('--grid-text') || 'rgba(226, 232, 240, 0.72)').trim();
  const markerLabel = (styles.getPropertyValue('--color-text') || '#cbd5f5').trim() || '#cbd5f5';

  const svg = createSvgElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Gráfica exportada desde EcuPlot',
  });

  svg.append(createSvgElement('rect', { x: 0, y: 0, width, height, fill: background }));

  const spanX = view.xmax - view.xmin || 1;
  const spanY = view.ymax - view.ymin || 1;

  const toScreen = (x, y) => ({
    x: (x - view.xmin) * (width / spanX),
    y: (view.ymax - y) * (height / spanY),
  });

  const drawLines = (min, max, step, draw) => {
    if (!step || !isFinite(step)) return;
    let start = Math.ceil(min / step) * step;
    if (!isFinite(start)) start = 0;
    for (let value = start; value <= max + step / 2; value += step) {
      draw(value);
    }
  };

  if (view.gridOn) {
    const baseStep = niceStep(Math.min(Math.abs(spanX), Math.abs(spanY)) || 1);
    const gridGroup = createSvgElement('g', { stroke: gridLine, 'stroke-width': 1, fill: 'none' });

    drawLines(view.xmin, view.xmax, baseStep, (value) => {
      const point = toScreen(value, view.ymin);
      gridGroup.append(createSvgElement('line', { x1: point.x, y1: 0, x2: point.x, y2: height }));
    });

    drawLines(view.ymin, view.ymax, baseStep, (value) => {
      const point = toScreen(view.xmin, value);
      gridGroup.append(createSvgElement('line', { x1: 0, y1: point.y, x2: width, y2: point.y }));
    });

    svg.append(gridGroup);

    const axisGroup = createSvgElement('g', { stroke: gridAxis, 'stroke-width': 1.5, fill: 'none' });
    const labelGroup = createSvgElement('g', {
      fill: gridText || markerLabel,
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': 12,
    });

    const axisY = toScreen(view.xmin, 0).y;
    const hasXAxis = axisY >= 0 && axisY <= height;
    if (hasXAxis) {
      axisGroup.append(createSvgElement('line', { x1: 0, y1: axisY, x2: width, y2: axisY }));
    }

    const axisX = toScreen(0, view.ymin).x;
    const hasYAxis = axisX >= 0 && axisX <= width;
    if (hasYAxis) {
      axisGroup.append(createSvgElement('line', { x1: axisX, y1: 0, x2: axisX, y2: height }));
    }

    svg.append(axisGroup);

    drawLines(view.xmin, view.xmax, baseStep, (value) => {
      const point = toScreen(value, view.ymin);
      const text = createSvgElement('text', {
        x: point.x,
        y: hasXAxis ? axisY + (axisY < height / 2 ? 14 : -10) : height - 18,
        'text-anchor': 'middle',
        'dominant-baseline': hasXAxis ? 'middle' : 'baseline',
      });
      text.textContent = formatTick(value);
      labelGroup.append(text);
    });

    drawLines(view.ymin, view.ymax, baseStep, (value) => {
      const point = toScreen(view.xmin, value);
      const yLabel = createSvgElement('text', {
        x: hasYAxis ? axisX + (axisX > width / 2 ? -12 : 12) : 12,
        y: point.y,
        'text-anchor': hasYAxis ? (axisX > width / 2 ? 'end' : 'start') : 'start',
        'dominant-baseline': 'middle',
      });
      yLabel.textContent = formatTick(value);
      labelGroup.append(yLabel);
    });

    svg.append(labelGroup);
  }

  const expressionsGroup = createSvgElement('g', {
    fill: 'none',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });

  const sampleBase = Math.max(0.001, (view.xmax - view.xmin) / (width * 0.75));
  const sampleStep = Math.max(sampleBase, 0.002);
  const xLimit = view.xmax + 20 * sampleStep;
  const yLimit = Math.abs(view.ymax - view.ymin) * 6;

  core.expressions.forEach((expr) => {
    if (!expr.visible) return;
    let drawing = false;
    let pathData = '';

    for (let x = view.xmin; x <= xLimit; x += sampleStep) {
      const y = evaluateExpression(expr.compiled, x);
      if (y == null || Math.abs(y) > yLimit) {
        drawing = false;
        continue;
      }

      const point = toScreen(x, y);
      pathData += `${drawing ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)} `;
      drawing = true;
    }

    if (!pathData) return;

    expressionsGroup.append(createSvgElement('path', {
      d: pathData.trim(),
      stroke: expr.color,
      'stroke-width': 2.2,
    }));
  });

  svg.append(expressionsGroup);

  if (core.markers.length) {
    const markersGroup = createSvgElement('g', {
      'font-family': 'Inter, system-ui, sans-serif',
      'font-size': 12,
      fill: markerLabel,
      stroke: 'none',
    });

    core.markers.forEach((marker) => {
      const point = toScreen(marker.x, marker.y);
      markersGroup.append(createSvgElement('circle', {
        cx: point.x,
        cy: point.y,
        r: 5,
        fill: marker.color,
        stroke: '#0f172a',
        'stroke-width': 2,
      }));

      const label = createSvgElement('text', {
        x: point.x + 8,
        y: point.y - 6,
        'text-anchor': 'start',
        'dominant-baseline': 'middle',
      });
      label.textContent = `${marker.label} (${marker.x.toFixed(2)}, ${marker.y.toFixed(2)})`;
      markersGroup.append(label);
    });

    svg.append(markersGroup);
  }

  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svg);
  if (!source.startsWith('<?xml')) {
    source = `<?xml version="1.0" encoding="UTF-8"?>\n${source}`;
  }

  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload('ecuplot.svg', url, true);
}

function triggerDownload(filename, href, revokeAfter = false) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = href;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (revokeAfter && href.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
}

function getCanvasDimensions(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const logicalWidth = canvas.width ? canvas.width / ratio : canvas.clientWidth;
  const logicalHeight = canvas.height ? canvas.height / ratio : canvas.clientHeight;
  return {
    width: Math.max(1, Math.round(logicalWidth || 0)),
    height: Math.max(1, Math.round(logicalHeight || 0)),
  };
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null) return;
    element.setAttribute(key, String(value));
  });
  return element;
}

function evaluateExpression(compiled, x) {
  try {
    const y = compiled.evaluate({ x });
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
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
  syncHistorySearchInputs(core.history.q);
  renderHistoryList();
  syncHistorySelectAll();
}

function renderHistoryList() {
  const items = core.getHistoryItems();
  const lists = qsa(UI_SELECTORS.historyList);
  if (!lists.length) return;

  lists.forEach((list) => {
    list.innerHTML = '';
    const fragment = document.createDocumentFragment();

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
  });
}

function syncHistorySelectAll() {
  const inputs = qsa(UI_SELECTORS.historySelectAll);
  if (!inputs.length) return;
  const items = core.getHistoryItems();
  const totalSelected = core.getHistorySelection().length;
  const shouldIndeterminate = totalSelected > 0 && totalSelected < items.length;
  const shouldChecked = totalSelected > 0 && totalSelected === items.length;

  inputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.indeterminate = shouldIndeterminate;
    input.checked = shouldChecked;
  });
}

function syncHistorySearchInputs(value) {
  const inputs = qsa(UI_SELECTORS.historySearch);
  inputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.value !== value) input.value = value;
  });
}

function syncHistoryOrderInputs(order) {
  const selects = qsa(UI_SELECTORS.historyOrder);
  const desired = order === 'asc' ? 'asc' : 'desc';
  selects.forEach((select) => {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.value !== desired) select.value = desired;
  });
}

function plotSelectedHistory({ closeModal = true } = {}) {
  const items = core.getSelectedHistoryExpressions();
  if (!items.length) {
    toast?.warn?.('No hay expresiones seleccionadas.');
    return;
  }

  items.forEach((item) => {
    addExpressionText(item.expression || '');
  });

  if (closeModal) closeHistoryModal();
}

function handleMarkerSelection(marker) {
  core.addMarker(marker);
  renderer?.requestRender();
  dispatchPlotterEvent('plotter:point', marker);
}

function persistExpression(label) {
  if (!hasSessionToken()) return;
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
