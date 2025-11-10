import { toast, eventStream } from '/static/app.js';
import {
  DEFAULT_EXERCISES,
  mergeLearningCatalog,
  readLocalLearningProgress,
  updateLocalLearningEntry,
  writeLocalLearningProgress,
  buildProgressMapFromExercises,
} from '../../lib/learning-data.js';
import { requestWithAuth } from '../api-client.js';
import { ui } from '../ui.js';
import { on } from '../../lib/events.js';

const learningProgressState = {
  bound: false,
  items: [],
  loading: false,
  localProgress: readLocalLearningProgress(),
  unsubscribe: null,
};

const learningDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatLearningDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return learningDateFormatter.format(date);
}

function renderLearningProgress(exercises) {
  if (!ui.learningList) return;
  const list = ui.learningList;
  const items = Array.isArray(exercises) ? exercises : [];
  learningProgressState.items = items;

  list.innerHTML = '';

  const completedCount = items.reduce((acc, item) => (item?.completed ? acc + 1 : acc), 0);

  if (!items.length) {
    if (ui.learningEmpty) {
      ui.learningEmpty.hidden = false;
      ui.learningEmpty.textContent = 'No hay ejercicios disponibles en este momento.';
    }
    if (ui.learningCard) {
      delete ui.learningCard.dataset.completedCount;
      delete ui.learningCard.dataset.totalCount;
    }
    return;
  }

  items.forEach((exercise) => {
    if (!exercise || !exercise.id) return;
    const li = document.createElement('li');
    li.className = 'learning-progress__item';
    li.dataset.exerciseId = exercise.id;
    if (exercise.completed) li.classList.add('is-completed');

    const title = document.createElement('span');
    title.className = 'learning-progress__title';
    title.textContent = exercise.title || exercise.id;
    if (exercise.description) title.title = exercise.description;

    const status = document.createElement('span');
    status.className = 'learning-progress__status';
    status.textContent = exercise.completed ? 'Completado' : 'Pendiente';
    if (exercise.completed) status.classList.add('is-success');

    const meta = document.createElement('span');
    meta.className = 'learning-progress__meta';
    if (exercise.completed && exercise.completed_at) {
      const formatted = formatLearningDate(exercise.completed_at);
      meta.textContent = formatted ? `Completado el ${formatted}` : 'Completado';
    } else if (exercise.expression) {
      meta.textContent = exercise.expression;
    } else if (exercise.description) {
      meta.textContent = exercise.description;
    }

    li.appendChild(title);
    li.appendChild(status);
    if (meta.textContent) li.appendChild(meta);

    list.appendChild(li);
  });

  if (ui.learningEmpty) {
    ui.learningEmpty.hidden = completedCount > 0;
    if (!completedCount) ui.learningEmpty.textContent = 'No has completado ejercicios todavía.';
  }

  if (ui.learningCard) {
    ui.learningCard.dataset.completedCount = String(completedCount);
    ui.learningCard.dataset.totalCount = String(items.length);
  }
}

function applyLearningProgress(exercises, { persist = true } = {}) {
  const catalog = mergeLearningCatalog(DEFAULT_EXERCISES, exercises, learningProgressState.localProgress);
  if (persist) {
    const serverProgress = buildProgressMapFromExercises(exercises);
    const merged = { ...learningProgressState.localProgress, ...serverProgress };
    learningProgressState.localProgress = merged;
    writeLocalLearningProgress(merged);
  }
  renderLearningProgress(catalog);
}

async function loadLearningProgress(options = {}) {
  if (!ui.learningList) return;
  if (learningProgressState.loading) return;

  ensureLearningSubscription();

  learningProgressState.loading = true;

  if (!options.skipLocal) {
    const localCatalog = mergeLearningCatalog(DEFAULT_EXERCISES, [], learningProgressState.localProgress);
    renderLearningProgress(localCatalog);
  }

  try {
    const res = await requestWithAuth('/api/learning/exercises');
    if (!res) return;
    if (!res.ok) {
      if (!options.silent) {
        toast?.error?.('No se pudo cargar el progreso de aprendizaje.');
      }
      return;
    }
    const payload = await res.json().catch(() => ({}));
    const exercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
    const serverProgress = buildProgressMapFromExercises(exercises);
    const mergedProgress = { ...learningProgressState.localProgress, ...serverProgress };
    learningProgressState.localProgress = mergedProgress;
    writeLocalLearningProgress(mergedProgress);
    applyLearningProgress(exercises, { persist: false });
  } finally {
    learningProgressState.loading = false;
  }
}

function ensureLearningSubscription() {
  if (!eventStream || learningProgressState.unsubscribe) return;
  learningProgressState.unsubscribe = eventStream.subscribeChannel('learning', handleLearningProgressEvent);
  eventStream.ensure?.();
}

function clearLearningSubscription() {
  if (typeof learningProgressState.unsubscribe === 'function') {
    learningProgressState.unsubscribe();
  }
  learningProgressState.unsubscribe = null;
}

function handleLearningProgressEvent(payload) {
  const event = payload?.data || {};
  const exerciseId = event.exercise_id;
  if (!exerciseId) return;

  const completedAt = event.completed_at || new Date().toISOString();
  if (event.completed) {
    learningProgressState.localProgress = updateLocalLearningEntry(exerciseId, { completedAt });
  }

  const current = learningProgressState.items.slice();
  let updated = false;
  let changed = false;
  for (let index = 0; index < current.length; index += 1) {
    const item = current[index];
    if (item.id !== exerciseId) continue;
    if (item.completed && item.completed_at === completedAt) {
      updated = true;
      break;
    }
    current[index] = {
      ...item,
      completed: Boolean(event.completed),
      completed_at: completedAt,
    };
    updated = true;
    changed = true;
    break;
  }

  if (!updated) {
    const fallback = DEFAULT_EXERCISES.find((exercise) => exercise.id === exerciseId) || { id: exerciseId, title: exerciseId };
    current.push({
      ...fallback,
      completed: Boolean(event.completed),
      completed_at: completedAt,
    });
    changed = true;
  }

  if (!changed) return;

  renderLearningProgress(current);

  if (event.completed) {
    const exercise = learningProgressState.items.find((item) => item.id === exerciseId);
    const label = exercise?.title || exerciseId;
    toast?.success?.(`Ejercicio completado: ${label}`);
  }
}

function resetLearningProgressUI() {
  learningProgressState.items = [];
  if (ui.learningList) ui.learningList.innerHTML = '';
  if (ui.learningEmpty) {
    ui.learningEmpty.hidden = false;
    ui.learningEmpty.textContent = 'Inicia sesión para ver tu progreso.';
  }
  if (ui.learningCard) {
    delete ui.learningCard.dataset.completedCount;
    delete ui.learningCard.dataset.totalCount;
  }
}

function bindLearningSection() {
  if (learningProgressState.bound) return;
  learningProgressState.bound = true;
  if (ui.learningOpenGraph) {
    on(ui.learningOpenGraph, 'click', (event) => {
      event.preventDefault();
      handleLearningOpenGraph();
    });
  }
  ensureLearningSubscription();
}

function handleLearningOpenGraph() {
  const button = ui.learningOpenGraph;
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    window.location.assign('/graph');
  } finally {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
    }
  }
}

export function createLearningSection() {
  return {
    init: bindLearningSection,
    load: loadLearningProgress,
    reset: resetLearningProgressUI,
    teardown: clearLearningSubscription,
  };
}
