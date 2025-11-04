import { toast } from '/static/app.js';
import { qs, toggleClass } from './lib/dom.js';
import { on } from './lib/events.js';
import { hasSessionToken, clearSessionToken } from './lib/session.js';
import {
  DEFAULT_EXERCISES,
  mergeLearningCatalog,
  readLocalLearningProgress,
  updateLocalLearningEntry,
  buildProgressMapFromExercises,
  writeLocalLearningProgress,
} from './lib/learning-data.js';

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
  toggleLearning: '#toggle-learning',
  learningPanel: '#learning-panel',
  closeLearning: '#close-learning',
};

const LEARNING_TOOLTIP_DEFAULT = 'Selecciona un ejercicio para cargarlo en la graficadora.';
const LEARNING_TOGGLE_LABEL = 'Ejercicios';
const LEARNING_TOGGLE_HIDE_LABEL = 'Ocultar ejercicios';

const valueState = {
  rows: [],
};

const learningState = {
  exercises: [],
  serverExercises: [],
  localProgress: {},
  list: null,
  tooltip: null,
  panel: null,
  toggle: null,
  open: false,
  baseLabel: LEARNING_TOGGLE_LABEL,
  dismissed: false,
};

const learningDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function computeLearningExercises() {
  return mergeLearningCatalog(DEFAULT_EXERCISES, learningState.serverExercises, learningState.localProgress);
}

function applyServerLearningExercises(exercises) {
  if (!Array.isArray(exercises)) return false;
  learningState.serverExercises = exercises;
  const serverProgress = buildProgressMapFromExercises(exercises);
  const merged = { ...readLocalLearningProgress(), ...serverProgress };
  learningState.localProgress = merged;
  writeLocalLearningProgress(merged);
  renderLearningExercises(mergeLearningCatalog(DEFAULT_EXERCISES, learningState.serverExercises, learningState.localProgress));
  return true;
}

async function refreshLearningFromServer(options = {}) {
  const result = await fetchLearningExercises();
  if (!result) return;
  if (result.status === 401) {
    if (!options.silent) {
      toast?.info?.('Inicia sesión para sincronizar tu progreso en la nube.');
    }
    return;
  }
  if (!result.ok) {
    if (!options.silent) {
      toast?.error?.('No se pudo sincronizar el progreso de aprendizaje.');
    }
    return;
  }
  applyServerLearningExercises(result.exercises);
}

async function requestLearning(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(url, { ...options, headers, credentials: options.credentials ?? 'same-origin' });
  } catch (error) {
    console.warn('No se pudo contactar el servicio de ejercicios', error);
    return null;
  }
}

async function fetchLearningExercises() {
  const res = await requestLearning('/api/learning/exercises');
  if (!res) {
    return { ok: false, status: 0, exercises: [] };
  }
  if (res.status === 401) {
    clearSessionToken();
  }
  const payload = await res.json().catch(() => ({}));
  const exercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
  return { ok: res.ok, status: res.status, exercises };
}

async function completeExercise(exerciseId) {
  const res = await requestLearning(`/api/learning/exercises/${exerciseId}/complete`, { method: 'POST' });
  if (!res) return { ok: false, status: 0 };
  if (res.status === 401) {
    clearSessionToken();
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function renderLearningExercises(exercises) {
  if (!learningState.list) {
    learningState.list = qs(selectors.learningList);
  }
  const list = learningState.list;
  if (!list) return;

  if (Array.isArray(exercises)) {
    learningState.exercises = exercises;
  }

  const source = Array.isArray(learningState.exercises) && learningState.exercises.length
    ? learningState.exercises
    : computeLearningExercises();

  learningState.exercises = source;

  list.innerHTML = '';

  source.forEach((exercise) => {
    if (!exercise || !exercise.id) return;
    const item = document.createElement('li');
    item.className = 'learning-list__item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-item';
    button.dataset.exerciseId = exercise.id;
    button.dataset.description = exercise.description || '';
    button.dataset.expression = exercise.expression || '';
    button.textContent = exercise.title || exercise.id;
    button.setAttribute('aria-pressed', exercise.completed ? 'true' : 'false');
    if (exercise.completed) button.classList.add('is-completed');

    on(button, 'click', () => selectExercise(exercise.id));
    on(button, 'mouseenter', () => showLearningTooltip(exercise));
    on(button, 'focus', () => showLearningTooltip(exercise));
    on(button, 'mouseleave', resetLearningTooltip);
    on(button, 'blur', resetLearningTooltip);

    item.appendChild(button);
    list.appendChild(item);
  });

  resetLearningTooltip();
    syncLearningUI();
}

function showLearningTooltip(payload) {
  if (!learningState.tooltip) {
    learningState.tooltip = qs(selectors.learningTooltip);
  }
  const tooltip = learningState.tooltip;
  if (!tooltip) return;

  let message = '';
  if (typeof payload === 'string') {
    message = payload;
  } else if (payload && typeof payload === 'object') {
    message = describeLearningExercise(payload);
  }

  if (!message) {
    tooltip.hidden = true;
    tooltip.textContent = '';
    return;
  }

  tooltip.hidden = false;
  tooltip.textContent = message;
}

function resetLearningTooltip() {
  showLearningTooltip(LEARNING_TOOLTIP_DEFAULT);
}

function describeLearningExercise(exercise) {
  if (!exercise) return '';
  const parts = [];
  if (exercise.description) parts.push(exercise.description);
  if (exercise.expression) parts.push(`Expresión: ${exercise.expression}`);
  if (exercise.completed) {
    const completedLabel = formatLearningTimestamp(exercise.completed_at);
    parts.push(completedLabel ? `Completado el ${completedLabel}` : 'Completado');
  } else {
    parts.push('Estado: pendiente');
  }
  return parts.join(' · ');
}

function formatLearningTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return learningDateFormatter.format(date);
}

function getLearningStats() {
  const exercises = Array.isArray(learningState.exercises) ? learningState.exercises : [];
  const total = exercises.length;
  const completed = exercises.reduce((count, exercise) => (exercise?.completed ? count + 1 : count), 0);
  return { total, completed };
}

function applyLearningVisibility(stats) {
  const panel = learningState.panel || qs(selectors.learningPanel);
  const toggle = learningState.toggle || qs(selectors.toggleLearning);
  const isLogged = hasSessionToken();
  const shouldDismiss = isLogged && stats.total > 0 && stats.completed >= stats.total;

  if (learningState.dismissed === shouldDismiss) {
    if (panel) {
      const hiddenState = learningState.dismissed || !learningState.open;
      panel.hidden = hiddenState;
      panel.setAttribute('aria-hidden', String(hiddenState));
    }
    if (toggle) {
      toggle.hidden = learningState.dismissed;
      if (learningState.dismissed) toggle.setAttribute('aria-hidden', 'true');
      else toggle.removeAttribute('aria-hidden');
    }
    return;
  }

  learningState.dismissed = shouldDismiss;

  if (shouldDismiss) {
    learningState.open = false;
    if (toggle) {
      toggle.hidden = true;
      toggle.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (panel) {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    }
  } else {
    if (toggle) {
      toggle.hidden = false;
      toggle.removeAttribute('aria-hidden');
    }
    if (panel) {
      panel.hidden = !learningState.open;
      panel.setAttribute('aria-hidden', String(!learningState.open));
    }
  }
}

function updateLearningToggleStatus(statsArg) {
  const toggle = learningState.toggle || qs(selectors.toggleLearning);
  if (toggle && !learningState.toggle) {
    learningState.toggle = toggle;
  }

  const stats = statsArg || getLearningStats();

  if (!toggle) {
    return stats;
  }

  if (learningState.dismissed) {
    toggle.textContent = learningState.baseLabel || LEARNING_TOGGLE_LABEL;
    toggle.title = toggle.textContent;
    toggle.setAttribute('aria-label', toggle.textContent);
    return stats;
  }

  const baseLabel = learningState.baseLabel || toggle.dataset.baseLabel || LEARNING_TOGGLE_LABEL;
  const summaryLabel = stats.total ? `${baseLabel} (${stats.completed}/${stats.total})` : baseLabel;
  const label = learningState.open ? LEARNING_TOGGLE_HIDE_LABEL : summaryLabel;

  toggle.dataset.baseLabel = baseLabel;
  toggle.dataset.total = String(stats.total);
  toggle.dataset.completed = String(stats.completed);
  toggle.classList.toggle('learning-toggle--has-progress', stats.completed > 0 && stats.completed < stats.total);
  toggle.classList.toggle('learning-toggle--complete', stats.total > 0 && stats.completed === stats.total);
  toggle.textContent = label;
  toggle.title = label;
  toggle.setAttribute('aria-label', label);

  return stats;
}

function syncLearningUI() {
  const stats = getLearningStats();
  applyLearningVisibility(stats);
  updateLearningToggleStatus(stats);
  return stats;
}

function setLearningPanelOpen(open) {
  const panel = learningState.panel || qs(selectors.learningPanel);
  const toggle = learningState.toggle || qs(selectors.toggleLearning);
  if (!panel || !toggle) return;

  const next = Boolean(open);
  learningState.panel = panel;
  learningState.toggle = toggle;
  if (learningState.dismissed && next) {
    syncLearningUI();
    return;
  }

  learningState.open = next;

  panel.hidden = learningState.dismissed || !next;
  panel.setAttribute('aria-hidden', String(learningState.dismissed || !next));
  toggle.setAttribute('aria-pressed', String(next));
  toggle.setAttribute('aria-expanded', String(next));
  toggle.setAttribute('aria-controls', panel.id);

  const stats = syncLearningUI();

  if (next && !learningState.dismissed && stats.total > 0) {
    window.requestAnimationFrame(() => {
      panel.focus?.({ preventScroll: true });
    });
  }
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

  showLearningTooltip(exercise);
  void markExerciseCompleted(exerciseId);
}

async function markExerciseCompleted(exerciseId) {
  const exercise = learningState.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;

  let optimisticCompletedAt = exercise.completed_at || null;
  if (!exercise.completed) {
    optimisticCompletedAt = new Date().toISOString();
    learningState.localProgress = updateLocalLearningEntry(exerciseId, { completedAt: optimisticCompletedAt });
    renderLearningExercises(computeLearningExercises());
  }

  const result = await completeExercise(exerciseId);
  if (!result) return;

  const { ok, status, data } = result;

  if (status === 401) {
    toast?.error?.('Necesitas iniciar sesión para guardar tu progreso.');
    learningState.localProgress = readLocalLearningProgress();
    renderLearningExercises(computeLearningExercises());
    return;
  }

  if (!ok && status >= 500) {
    toast?.error?.('No se pudo registrar el progreso. Intenta nuevamente.');
    return;
  }

  if (ok && status === 201) {
    toast?.success?.('¡Ejercicio completado!');
  } else if (data?.message) {
    toast?.info?.(data.message);
  }

  if (data?.completed_at) {
    learningState.localProgress = updateLocalLearningEntry(exerciseId, { completedAt: data.completed_at });
  } else if (optimisticCompletedAt) {
    learningState.localProgress = updateLocalLearningEntry(exerciseId, { completedAt: optimisticCompletedAt });
  }

  if (ok) {
    await refreshLearningFromServer({ silent: status !== 201 });
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
  const panel = qs(selectors.learningPanel);
  const toggle = qs(selectors.toggleLearning);
  if (!list || !panel || !toggle) return;

  learningState.list = list;
  learningState.panel = panel;
  learningState.toggle = toggle;
  learningState.tooltip = qs(selectors.learningTooltip);
  learningState.localProgress = readLocalLearningProgress();

  const closeBtn = qs(selectors.closeLearning);
  const initialLabel = (toggle.dataset.baseLabel || toggle.textContent || '').trim();
  learningState.baseLabel = initialLabel || LEARNING_TOGGLE_LABEL;
  toggle.dataset.baseLabel = learningState.baseLabel;
  toggle.setAttribute('aria-controls', panel.id);

  on(toggle, 'click', () => {
    if (learningState.dismissed) return;
    const willOpen = !learningState.open;
    setLearningPanelOpen(willOpen);
    if (willOpen && !learningState.serverExercises.length) {
      refreshLearningFromServer({ silent: true });
    }
  });

  if (closeBtn) {
    on(closeBtn, 'click', () => setLearningPanelOpen(false));
  }

  renderLearningExercises(computeLearningExercises());
  resetLearningTooltip();
  setLearningPanelOpen(false);
  refreshLearningFromServer({ silent: true });
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
