import { qs, toggleClass } from './lib/dom.js';
import { on } from './lib/events.js';

const VALUE_LIMIT = 20;

const selectors = {
  toggleFunctions: '#toggle-functions',
  toggleValues: '#toggle-values',
  valuePanel: '#value-panel',
  closeValues: '#close-values',
  clearValues: '#clear-values',
  valueTableBody: '#value-table-body',
  valueTableEmpty: '#value-table-empty',
  coordHud: '#coord-hud',
  graphContainer: '#ggb-container',
  controlsToggle: '#controls-actions-toggle',
  controlsSecondary: '#controls-secondary',
  controlsBar: '.controls-bar',
  controlsBarFab: '#controls-bar-toggle',
  controlsFabIcon: '#controls-bar-toggle .controls-bar__fab-icon',
};

const valueState = {
  rows: [],
};

function forceDarkTheme() {
  document.body.classList.add('theme-dark');
  document.body.classList.remove('theme-light');
  document.documentElement.dataset.theme = 'dark'; // compatibilidad
  try {
    localStorage.setItem('ecup-theme', 'dark');
  } catch {}
}

// Navegacion 
function bindEscToBack() {
  on(window, 'keydown', (event) => {
    if (event.key === 'Escape') {
      window.location.href = '/';
    }
  });
}

// Canvas a pantalla completa
function initFullHeightCanvasSync() {
  const host = qs(selectors.graphContainer);
  if (!host) return;

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      host.style.setProperty('--ggb-width', `${width}px`);
      host.style.setProperty('--ggb-height', `${height}px`);
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  });
  ro.observe(host);
}

function initQueryExprBoot() {
  const params = new URLSearchParams(window.location.search);
  const expr = params.get('expr');
  if (!expr) return;

  const input = /** @type {HTMLInputElement|null} */ (qs('#plot-input'));
  const form = /** @type {HTMLFormElement|null} */ (qs('#plot-form'));

  if (input) input.value = expr;

  setTimeout(() => {
    if (!form) return;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
  }, 120);
}

function initCoordHUD() {
  const hud = qs(selectors.coordHud);
  const container = qs(selectors.graphContainer);
  if (!hud || !container) return;

  on(container, 'plotter:hover', (event) => {
    const detail = event.detail || {};
    if (typeof detail.x !== 'number' || typeof detail.y !== 'number') return;
    hud.hidden = false;
    hud.textContent = `(${detail.x.toFixed(3)}, ${detail.y.toFixed(3)})`;
  });

  on(container, 'plotter:hover-end', () => {
    hud.hidden = true;
  });
}

function initFunctionPanelToggle() {
  const btn = qs(selectors.toggleFunctions);
  const panel = qs('#functions-panel');
  const closeBtn = qs('#close-functions');
  if (!btn || !panel) return;

  const notifyResize = () => window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  const applyState = (open) => {
    panel.hidden = !open;
    btn.textContent = open ? 'Ocultar funciones' : 'Mostrar funciones';
    btn.setAttribute('aria-pressed', String(open));
    notifyResize();
  };

  const mq = window.matchMedia('(max-width: 768px)');
  let isOpen = !panel.hidden;

  const setState = (next) => {
    isOpen = next;
    applyState(isOpen);
  };

  const syncToViewport = (isMobile) => {
    setState(isMobile ? false : true);
  };

  syncToViewport(mq.matches);

  on(btn, 'click', () => {
    setState(!isOpen);
  });

  on(closeBtn, 'click', () => {
    setState(false);
  });

  mq.addEventListener('change', (event) => {
    syncToViewport(event.matches);
  });
}

function setValuePanelOpen(state) {
  const panel = qs(selectors.valuePanel);
  const btn = qs(selectors.toggleValues);
  if (!panel || !btn) return;

  panel.hidden = !state;
  btn.setAttribute('aria-pressed', String(state));
  btn.textContent = state ? 'Ocultar tabla' : 'Mostrar tabla';
}

function renderValueTable() {
  const body = qs(selectors.valueTableBody);
  const empty = qs(selectors.valueTableEmpty);
  if (!body || !empty) return;

  body.innerHTML = '';
  if (valueState.rows.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  const fragment = document.createDocumentFragment();
  valueState.rows.forEach((row) => {
    const tr = document.createElement('tr');
    const fx = document.createElement('td');
    fx.innerHTML = `<span class="value-table__color" style="background:${row.color}"></span>${row.label}`;
    const tdX = document.createElement('td');
    tdX.textContent = row.x.toFixed(4);
    const tdY = document.createElement('td');
    tdY.textContent = row.y.toFixed(4);
    const tdTime = document.createElement('td');
    tdTime.textContent = row.timestamp;

    tr.appendChild(fx);
    tr.appendChild(tdX);
    tr.appendChild(tdY);
    tr.appendChild(tdTime);
    fragment.appendChild(tr);
  });
  body.appendChild(fragment);
}

function addValueRow(point) {
  valueState.rows.unshift({
    ...point,
    timestamp: new Date().toLocaleTimeString(),
  });
  if (valueState.rows.length > VALUE_LIMIT) valueState.rows.pop();
  renderValueTable();
}

function initValuePanel() {
  const toggleBtn = qs(selectors.toggleValues);
  const closeBtn = qs(selectors.closeValues);
  const clearBtn = qs(selectors.clearValues);

  on(toggleBtn, 'click', () => {
    const panel = qs(selectors.valuePanel);
    if (!panel) return;
    setValuePanelOpen(panel.hidden);
  });

  on(closeBtn, 'click', () => setValuePanelOpen(false));

  on(clearBtn, 'click', () => {
    valueState.rows.length = 0;
    renderValueTable();
  });
}

function initControlsCollapse() {
  const toggle = qs(selectors.controlsToggle);
  const secondary = qs(selectors.controlsSecondary);
  if (!toggle || !secondary) return;

  const mq = window.matchMedia('(max-width: 640px)');
  let manualOpen = false;

  const applyState = (open) => {
    const shouldOpen = mq.matches ? open : true;
    toggleClass(secondary, 'is-open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    toggleClass(toggle, 'is-active', shouldOpen && mq.matches);
  };

  const syncLayout = () => {
    if (mq.matches) {
      toggle.hidden = false;
      applyState(manualOpen);
    } else {
      toggle.hidden = true;
      applyState(true);
    }
  };

  on(toggle, 'click', () => {
    if (!mq.matches) return;
    const next = !secondary.classList.contains('is-open');
    manualOpen = next;
    applyState(next);
  });

  mq.addEventListener('change', (event) => {
    if (event.matches) {
      manualOpen = false;
    }
    syncLayout();
  });

  syncLayout();
}

function setControlsBarCollapsed(collapsed) {
  const bar = qs(selectors.controlsBar);
  const fab = qs(selectors.controlsBarFab);
  const icon = qs(selectors.controlsFabIcon);
  if (!bar || !fab) return;

  bar.classList.toggle('is-collapsed', collapsed);
  fab.setAttribute('aria-pressed', String(!collapsed));
  fab.setAttribute('aria-label', collapsed ? 'Mostrar barra de controles' : 'Ocultar barra de controles');
  if (icon) icon.textContent = collapsed ? '+' : '-';
}

function initControlsDock() {
  const fab = qs(selectors.controlsBarFab);
  if (!fab) return;

  let collapsed = false;
  setControlsBarCollapsed(collapsed);

  on(fab, 'click', () => {
    collapsed = !collapsed;
    setControlsBarCollapsed(collapsed);
  });
}

function initPlotterBridge() {
  const container = qs(selectors.graphContainer);
  if (!container) return;

  on(container, 'plotter:point', (event) => {
    const detail = event.detail;
    if (!detail) return;
    addValueRow(detail);
    setValuePanelOpen(true);
  });
}

// Init
function init() {
  forceDarkTheme();
  bindEscToBack();
  initFullHeightCanvasSync();
  initQueryExprBoot();
  initCoordHUD();
  initFunctionPanelToggle();
  initControlsDock();
  initControlsCollapse();
  initValuePanel();
  initPlotterBridge();
  renderValueTable();
  setValuePanelOpen(false);
}

document.addEventListener('DOMContentLoaded', init);
