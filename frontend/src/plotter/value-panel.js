import { qs } from '../lib/dom.js';
import { on } from '../lib/events.js';

const VALUE_LIMIT = 20;

const valueState = {
  rows: [],
  initialized: false,
};

function setValuePanelOpen(state) {
  const panel = qs('#value-panel');
  const btn = qs('#toggle-values');
  if (!panel || !btn) return;

  panel.hidden = !state;
  btn.setAttribute('aria-pressed', String(state));
  btn.textContent = state ? 'Ocultar tabla' : 'Mostrar tabla';
}

function renderValueTable() {
  const body = qs('#value-table-body');
  const empty = qs('#value-table-empty');
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
  
  if (valueState.rows.length > VALUE_LIMIT) {
    valueState.rows.pop();
  }
  
  renderValueTable();
}

/**
 * Inicializa el panel de valores
 */
export function initValuePanel(selectors = {}) {
  if (valueState.initialized) return;

  const toggleBtn = qs(selectors.toggleValues || '#toggle-values');
  const closeBtn = qs(selectors.closeValues || '#close-values');
  const clearBtn = qs(selectors.clearValues || '#clear-values');

  if (!toggleBtn) {
    console.warn('Value panel: botón toggle no encontrado');
    return;
  }

  valueState.initialized = true;

  on(toggleBtn, 'click', () => {
    const panel = qs('#value-panel');
    if (!panel) return;
    setValuePanelOpen(panel.hidden);
  });

  if (closeBtn) {
    on(closeBtn, 'click', () => setValuePanelOpen(false));
  }

  if (clearBtn) {
    on(clearBtn, 'click', () => {
      valueState.rows.length = 0;
      renderValueTable();
    });
  }

  // Render inicial
  renderValueTable();
  setValuePanelOpen(false);
}

/**
 * Listener de eventos del graficador
 */
export function setupValuePanelListeners() {
  const container = qs('#ggb-container');
  if (!container) return;

  on(container, 'plotter:point', (event) => {
    const detail = event.detail;
    if (!detail) return;
    addValueRow(detail);
    setValuePanelOpen(true);
  });
}
