import { toast } from '/static/app.js';
import { qs } from '../lib/dom.js';
import { on } from '../lib/events.js';
import { hasSessionToken, clearSessionToken } from '../lib/session.js';
import {
  DEFAULT_EXERCISES,
  mergeLearningCatalog,
  readLocalLearningProgress,
  updateLocalLearningEntry,
  buildProgressMapFromExercises,
  writeLocalLearningProgress,
} from '../lib/learning-data.js';

const LEARNING_TOOLTIP_DEFAULT = 'Selecciona un ejercicio para cargarlo en la graficadora.';
const LEARNING_TOGGLE_LABEL = 'Ejercicios';

const learningDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'short',
});

let learningState = {
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
  initialized: false,
};

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
    learningState.list = qs('#learning-exercise-list');
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
    learningState.tooltip = qs('#learning-tooltip');
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
    const date = exercise.completed_at
      ? learningDateFormatter.format(new Date(exercise.completed_at))
      : 'Fecha desconocida';
    parts.push(`✓ Completado el ${date}`);
  }
  return parts.join(' · ') || LEARNING_TOOLTIP_DEFAULT;
}

function selectExercise(exerciseId) {
  const exercise = learningState.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) return;

  const expr = exercise.expression;
  if (!expr) {
    toast?.error?.('Este ejercicio no tiene una expresión asociada.');
    return;
  }

  window.dispatchEvent(
    new CustomEvent('ecuplot:load-expression', {
      detail: { expression: expr, source: 'learning', exerciseId },
    })
  );

  showLearningTooltip('Ejercicio cargado. Puedes resolverlo en la graficadora.');

  setTimeout(() => {
    setLearningPanelOpen(false);
  }, 500);
}

function syncLearningUI() {
  const toggle = learningState.toggle;
  const panel = learningState.panel;
  if (!toggle) return;

  const completed = learningState.exercises.filter((ex) => ex.completed).length;
  const total = learningState.exercises.length;
  const isLogged = hasSessionToken();

  // Si el usuario está logueado y completó todos los ejercicios, ocultar el toggle
  const shouldDismiss = isLogged && total > 0 && completed >= total;

  if (shouldDismiss) {
    learningState.dismissed = true;
    learningState.open = false;
    toggle.hidden = true;
    toggle.setAttribute('aria-hidden', 'true');
    if (panel) {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
    }
    return;
  }

  // Si no debe ocultarse Y hay ejercicios disponibles, mostrar el toggle
  if (total > 0) {
    learningState.dismissed = false;
    toggle.hidden = false;
    toggle.removeAttribute('aria-hidden');
    
    // Actualizar badge
    if (completed > 0) {
      toggle.dataset.badge = `${completed}/${total}`;
      toggle.classList.add('has-badge');
    } else {
      toggle.dataset.badge = '';
      toggle.classList.remove('has-badge');
    }
  } else {
    // Si no hay ejercicios, mantener oculto
    toggle.hidden = true;
  }
}

function setLearningPanelOpen(state) {
  const panel = learningState.panel;
  const toggle = learningState.toggle;
  if (!panel || !toggle) return;

  // Si el panel está dismissed (todos completados), no permitir abrirlo
  if (learningState.dismissed) {
    syncLearningUI();
    return;
  }

  learningState.open = Boolean(state);
  panel.hidden = !learningState.open;
  toggle.setAttribute('aria-pressed', String(learningState.open));
  toggle.setAttribute('aria-expanded', String(learningState.open));

  if (learningState.open) {
    toggle.textContent = 'Ocultar ejercicios';
  } else {
    toggle.textContent = learningState.baseLabel || LEARNING_TOGGLE_LABEL;
  }
}

/**
 * Inicializa el panel de ejercicios
 */
export function initLearningPanel(selectors = {}) {
  if (learningState.initialized) return;

  const list = qs(selectors.learningList || '#learning-exercise-list');
  const panel = qs(selectors.learningPanel || '#learning-panel');
  const toggle = qs(selectors.toggleLearning || '#toggle-learning');
  
  if (!list || !panel || !toggle) {
    console.warn('Learning panel: elementos DOM no encontrados');
    return;
  }

  learningState.list = list;
  learningState.panel = panel;
  learningState.toggle = toggle;
  learningState.tooltip = qs(selectors.learningTooltip || '#learning-tooltip');
  learningState.localProgress = readLocalLearningProgress();
  learningState.initialized = true;

  const closeBtn = qs(selectors.closeLearning || '#close-learning');
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

  // Renderizar ejercicios con progreso local (esto evalúa si debe mostrarse)
  renderLearningExercises(computeLearningExercises());
  resetLearningTooltip();
  setLearningPanelOpen(false);
  
  // Sincronizar con servidor en segundo plano (actualizará si hay cambios)
  refreshLearningFromServer({ silent: true });
}

/**
 * Listener de eventos globales del graficador
 */
window.addEventListener('ecuplot:exercise-completed', (event) => {
  const exerciseId = event.detail?.exerciseId;
  if (!exerciseId || !learningState.initialized) return;

  const exercise = learningState.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise || exercise.completed) return;

  const now = new Date().toISOString();
  updateLocalLearningEntry(exerciseId, { completed: true, completed_at: now });
  learningState.localProgress = readLocalLearningProgress();

  if (hasSessionToken()) {
    completeExercise(exerciseId).then((result) => {
      if (result.ok) {
        // Verificar si completó todos los ejercicios
        const allExercises = computeLearningExercises();
        const completedCount = allExercises.filter(ex => ex.completed).length;
        
        if (completedCount >= allExercises.length) {
          toast?.success?.('🎉 ¡Felicidades! Has completado todos los ejercicios. El panel se ocultará automáticamente.');
        } else {
          toast?.success?.('¡Ejercicio completado! 🎉');
        }
        
        refreshLearningFromServer({ silent: true });
      }
    });
  } else {
    toast?.success?.('¡Ejercicio completado! Inicia sesión para sincronizar tu progreso.');
    renderLearningExercises(computeLearningExercises());
  }
});
