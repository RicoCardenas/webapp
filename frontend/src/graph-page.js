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
};

const valueState = {
  rows: [],
};

function forceDarkTheme() {
  document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.setItem('ecup-theme', 'dark');
  } catch {}
}

// Navegacion 
function bindEscToBack() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.location.href = '/';
    }
  });
}

// Canvas a pantalla completa
function initFullHeightCanvasSync() {
  const host = document.getElementById('ggb-container');
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

  const input = /** @type {HTMLInputElement|null} */(document.getElementById('plot-input'));
  const form  = /** @type {HTMLFormElement|null} */(document.getElementById('plot-form'));

  if (input) input.value = expr;

  setTimeout(() => {
    if (!form) return;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
  }, 120);
}

function initCoordHUD() {
  const hud = document.querySelector(selectors.coordHud);
  const container = document.querySelector(selectors.graphContainer);
  if (!hud || !container) return;

  container.addEventListener('plotter:hover', (event) => {
    const detail = event.detail || {};
    if (typeof detail.x !== 'number' || typeof detail.y !== 'number') return;
    hud.hidden = false;
    hud.textContent = `(${detail.x.toFixed(3)}, ${detail.y.toFixed(3)})`;
  });

  container.addEventListener('plotter:hover-end', () => {
    hud.hidden = true;
  });
}

function initFunctionPanelToggle() {
  const btn = document.querySelector(selectors.toggleFunctions);
  const panel = document.getElementById('functions-panel');
  const closeBtn = document.getElementById('close-functions');
  if (!btn || !panel) return;

  const applyState = (open) => {
    panel.hidden = !open;
    btn.textContent = open ? 'Ocultar funciones' : 'Mostrar funciones';
    btn.setAttribute('aria-pressed', String(open));
  };

  let isOpen = !panel.hidden;
  btn.setAttribute('aria-pressed', String(isOpen));

  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    applyState(isOpen);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });

  closeBtn?.addEventListener('click', () => {
    isOpen = false;
    applyState(isOpen);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
}

function setValuePanelOpen(state) {
  const panel = document.querySelector(selectors.valuePanel);
  const btn = document.querySelector(selectors.toggleValues);
  if (!panel || !btn) return;

  panel.hidden = !state;
  btn.setAttribute('aria-pressed', String(state));
  btn.textContent = state ? 'Ocultar tabla' : 'Mostrar tabla';
}

function renderValueTable() {
  const body = document.querySelector(selectors.valueTableBody);
  const empty = document.querySelector(selectors.valueTableEmpty);
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
  const toggleBtn = document.querySelector(selectors.toggleValues);
  const closeBtn = document.querySelector(selectors.closeValues);
  const clearBtn = document.querySelector(selectors.clearValues);

  toggleBtn?.addEventListener('click', () => {
    const panel = document.querySelector(selectors.valuePanel);
    if (!panel) return;
    const willOpen = panel.hidden;
    setValuePanelOpen(willOpen);
  });

  closeBtn?.addEventListener('click', () => setValuePanelOpen(false));

  clearBtn?.addEventListener('click', () => {
    valueState.rows = [];
    renderValueTable();
  });
}

function initPlotterBridge() {
  const container = document.querySelector(selectors.graphContainer);
  if (!container) return;

  container.addEventListener('plotter:point', (event) => {
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
  initValuePanel();
  initPlotterBridge();
  renderValueTable();
  setValuePanelOpen(false);
}

document.addEventListener('DOMContentLoaded', init);
