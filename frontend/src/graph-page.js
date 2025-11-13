import { toast } from '/static/app.js';
import { qs, toggleClass } from './lib/dom.js';
import { on } from './lib/events.js';

const selectors = {
  toggleFunctions: '#toggle-functions',
  toggleValues: '#toggle-values',
  valuePanel: '#value-panel',
  coordHud: '#coord-hud',
  graphContainer: '#ggb-container',
  controlsToggle: '#controls-actions-toggle',
  controlsSecondary: '#controls-secondary',
  controlsBar: '.controls-bar',
  controlsBarFab: '#controls-bar-toggle',
  controlsFabIcon: '#controls-bar-toggle .controls-bar__fab-icon',
  plotForm: '#plot-form',
  plotInput: '#plot-input',
  toggleLearning: '#toggle-learning',
  learningPanel: '#learning-panel',
};

// Flags para carga diferida
let valuePanelLoaded = false;
let learningPanelLoaded = false;

/**
 * Carga bajo demanda el panel de valores/coordenadas
 */
async function ensureValuePanel() {
  if (valuePanelLoaded) return;
  
  try {
    const { initValuePanel, setupValuePanelListeners } = await import('./plotter/value-panel.js');
    initValuePanel(selectors);
    setupValuePanelListeners();
    valuePanelLoaded = true;
  } catch (error) {
    console.error('Error cargando panel de valores:', error);
    toast?.error?.('No se pudo cargar el panel de valores.');
  }
}

/**
 * Carga bajo demanda el panel de ejercicios
 */
async function ensureLearningPanel() {
  if (learningPanelLoaded) return;
  
  try {
    const { initLearningPanel } = await import('./plotter/learning-panel.js');
    initLearningPanel(selectors);
    learningPanelLoaded = true;
  } catch (error) {
    console.error('Error cargando panel de ejercicios:', error);
    toast?.error?.('No se pudo cargar el panel de ejercicios.');
  }
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

  const updateHostSize = () => {
    const rect = host.getBoundingClientRect();
    host.style.setProperty('--ggb-width', `${rect.width}px`);
    host.style.setProperty('--ggb-height', `${rect.height}px`);
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  };

  updateHostSize();

  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      updateHostSize();
    });
    ro.observe(host);
  } else {
    window.addEventListener('resize', updateHostSize);
  }
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

// Init
function init() {
  bindEscToBack();
  initFullHeightCanvasSync();
  initQueryExprBoot();
  initCoordHUD();
  initFunctionPanelToggle();
  initControlsDock();
  initControlsCollapse();
  initPlotterEventBridge();
  
  // Carga diferida: valores y ejercicios solo cuando el usuario los active
  setupLazyPanelLoading();
}

/**
 * Puente ligero: escucha eventos del graficador para cargar paneles bajo demanda
 */
function initPlotterEventBridge() {
  const container = qs(selectors.graphContainer);
  if (!container) return;

  // Cuando se agrega un punto, carga y abre el panel de valores
  on(container, 'plotter:point', async () => {
    await ensureValuePanel();
  });

  // Cuando se completa un ejercicio, asegura que el panel de learning esté cargado
  on(window, 'ecuplot:exercise-completed', async () => {
    await ensureLearningPanel();
  });
}

/**
 * Configura los eventos para cargar paneles bajo demanda
 */
function setupLazyPanelLoading() {
  // Toggle de valores
  const valuesToggle = qs(selectors.toggleValues);
  if (valuesToggle) {
    on(valuesToggle, 'click', async () => {
      await ensureValuePanel();
    });
  }
  
  // Toggle de ejercicios
  const learningToggle = qs(selectors.toggleLearning);
  if (learningToggle) {
    on(learningToggle, 'click', async () => {
      await ensureLearningPanel();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
