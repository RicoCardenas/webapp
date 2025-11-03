import { qs, toggleClass } from './lib/dom.js';
import { on } from './lib/events.js';
import { getSessionToken } from './lib/session.js';

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
  plotForm: '#plot-form',
  plotInput: '#plot-input',
  learningList: '#learning-exercise-list',
  learningTooltip: '#learning-tooltip',
};

const valueState = {
  rows: [],
};

const learningState = {
  exercises: [],
  list: null,
  tooltip: null,
};

const DEFAULT_EXERCISES = [
  {
    id: 'sine-wave',
    title: 'Onda seno',
    expression: 'y = sin(x)',
    description: 'Explora la oscilación de la función seno entre -1 y 1.',
  },
  {
    id: 'parabola-basic',
    title: 'Parábola desplazada',
    expression: 'y = (x - 1)^2 - 3',
    description: 'Analiza cómo se traslada una parábola respecto al origen.',
  },
  {
    id: 'exponential-growth',
    title: 'Crecimiento exponencial',
    expression: 'y = e^(0.3 * x)',
    description: 'Visualiza una función exponencial de crecimiento suave.',
  },
];

async function requestLearning(url, options = {}) {
  const token = getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(url, { ...options, headers });
  } catch (error) {
    console.warn('No se pudo contactar el servicio de ejercicios', error);
    return null;
  }
}

async function fetchLearningExercises() {
  const token = getSessionToken();
  if (!token) return null;
  const res = await requestLearning('/api/learning/exercises');
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!Array.isArray(data?.exercises)) return null;
  return data.exercises;
}

async function completeExercise(exerciseId) {
  const token = getSessionToken();
  if (!token) return false;
  const res = await requestLearning(`/api/learning/exercises/${exerciseId}/complete`, { method: 'POST' });
  return Boolean(res && res.ok);
}

function renderLearningExercises(exercises = []) {
  const list = qs(selectors.learningList);
  if (!list) return;
  learningState.list = list;
  learningState.exercises = exercises.length ? exercises : DEFAULT_EXERCISES.map((exercise) => ({ ...exercise, completed: false }));
  list.innerHTML = '';

  learningState.exercises.forEach((exercise) => {
    const item = document.createElement('li');
    item.className = 'learning-list__item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-item';
    button.dataset.exerciseId = exercise.id;
    button.dataset.description = exercise.description || '';
    button.dataset.expression = exercise.expression;
    button.textContent = exercise.title;
    button.setAttribute('aria-pressed', exercise.completed ? 'true' : 'false');
    if (exercise.completed) button.classList.add('is-completed');

    on(button, 'click', () => selectExercise(exercise.id));
    on(button, 'mouseenter', () => showLearningTooltip(exercise.description));
    on(button, 'focus', () => showLearningTooltip(exercise.description));

    item.appendChild(button);
    list.appendChild(item);
  });

  showLearningTooltip('Selecciona un ejercicio para cargarlo en la graficadora.');
}

function showLearningTooltip(message) {
  if (!learningState.tooltip) {
    learningState.tooltip = qs(selectors.learningTooltip);
  }
  if (!learningState.tooltip) return;
  if (!message) {
    learningState.tooltip.hidden = true;
    learningState.tooltip.textContent = '';
    return;
  }
  learningState.tooltip.hidden = false;
  learningState.tooltip.textContent = message;
}

function selectExercise(exerciseId) {
  const exercise = learningState.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;

  const input = qs(selectors.plotInput);
  const form = qs(selectors.plotForm);
  if (input instanceof HTMLInputElement) {
    input.value = exercise.expression;
    input.focus({ preventScroll: true });
  }
  if (form instanceof HTMLFormElement) {
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
  }

  showLearningTooltip(exercise.description);
  markExerciseCompleted(exerciseId);
}

function markExerciseCompleted(exerciseId) {
  const exercise = learningState.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;
  if (!exercise.completed) {
    exercise.completed = true;
    completeExercise(exerciseId);
  }
  if (!learningState.list) return;
  const button = learningState.list.querySelector(`[data-exercise-id="${exerciseId}"]`);
  if (button instanceof HTMLButtonElement) {
    button.classList.add('is-completed');
    button.setAttribute('aria-pressed', 'true');
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

function initLearningPane() {
  const list = qs(selectors.learningList);
  if (!list) return;
  learningState.list = list;
  learningState.tooltip = qs(selectors.learningTooltip);

  renderLearningExercises();

  fetchLearningExercises().then((serverExercises) => {
    if (!Array.isArray(serverExercises) || !serverExercises.length) return;
    const map = new Map(serverExercises.map((exercise) => [exercise.id, exercise]));
    const merged = DEFAULT_EXERCISES.map((exercise) => {
      const remote = map.get(exercise.id);
      if (remote) return { ...exercise, ...remote };
      return { ...exercise, completed: false };
    });
    // Include any additional exercises known by the server
    serverExercises.forEach((exercise) => {
      if (!merged.find((item) => item.id === exercise.id)) {
        merged.push(exercise);
      }
    });
    renderLearningExercises(merged);
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
  initValuePanel();
  initPlotterBridge();
  initLearningPane();
  renderValueTable();
  setValuePanelOpen(false);
}

document.addEventListener('DOMContentLoaded', init);
