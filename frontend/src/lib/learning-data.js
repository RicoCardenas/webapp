const STORAGE_KEY = 'ecuplot.learning.progress.v1';

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

function normalizeProgress(progress) {
  const map = {};
  if (!progress || typeof progress !== 'object') return map;
  for (const [id, info] of Object.entries(progress)) {
    if (!id) continue;
    if (!info || typeof info !== 'object') continue;
    const completed = Boolean(info.completed);
    const completedAt = typeof info.completed_at === 'string' ? info.completed_at : null;
    if (completed) {
      map[id] = { completed: true, completed_at: completedAt };
    }
  }
  return map;
}

function readLocalLearningProgress() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeProgress(parsed);
  } catch (error) {
    console.warn('[learning] No se pudo leer progreso local.', error);
    return {};
  }
}

function writeLocalLearningProgress(progress) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const map = normalizeProgress(progress);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('[learning] No se pudo guardar progreso local.', error);
  }
}

function updateLocalLearningEntry(exerciseId, { completedAt } = {}) {
  if (!exerciseId) return readLocalLearningProgress();
  const map = readLocalLearningProgress();
  if (completedAt) {
    map[exerciseId] = { completed: true, completed_at: completedAt };
  } else {
    delete map[exerciseId];
  }
  writeLocalLearningProgress(map);
  return map;
}

function buildProgressMapFromExercises(exercises = []) {
  const map = {};
  exercises.forEach((exercise) => {
    if (!exercise || typeof exercise !== 'object') return;
    if (!exercise.id) return;
    if (!exercise.completed) return;
    const completedAt = typeof exercise.completed_at === 'string' ? exercise.completed_at : null;
    map[exercise.id] = { completed: true, completed_at: completedAt };
  });
  return map;
}

function mergeLearningCatalog(defaults = DEFAULT_EXERCISES, serverExercises = [], localProgress = readLocalLearningProgress()) {
  const normalizedDefaults = Array.isArray(defaults) ? defaults : [];
  const normalizedServer = Array.isArray(serverExercises) ? serverExercises : [];
  const normalizedLocal = normalizeProgress(localProgress);

  const catalog = new Map();
  normalizedDefaults.forEach((exercise) => {
    if (!exercise || !exercise.id) return;
    catalog.set(exercise.id, {
      id: exercise.id,
      title: exercise.title || exercise.id,
      expression: exercise.expression || '',
      description: exercise.description || '',
      completed: false,
      completed_at: null,
    });
  });

  normalizedServer.forEach((exercise) => {
    if (!exercise || !exercise.id) return;
    const existing = catalog.get(exercise.id) || {};
    catalog.set(exercise.id, {
      id: exercise.id,
      title: exercise.title || existing.title || exercise.id,
      expression: exercise.expression || existing.expression || '',
      description: exercise.description ?? existing.description ?? '',
      completed: Boolean(exercise.completed),
      completed_at: typeof exercise.completed_at === 'string' ? exercise.completed_at : existing.completed_at || null,
    });
  });

  Object.entries(normalizedLocal).forEach(([id, info]) => {
    if (!id) return;
    const existing = catalog.get(id) || { id, title: id, expression: '', description: '' };
    const completedAt = info?.completed_at || existing.completed_at || null;
    catalog.set(id, {
      ...existing,
      completed: Boolean(info?.completed) || existing.completed,
      completed_at: completedAt,
    });
  });

  return Array.from(catalog.values());
}

export {
  STORAGE_KEY,
  DEFAULT_EXERCISES,
  readLocalLearningProgress,
  writeLocalLearningProgress,
  mergeLearningCatalog,
  updateLocalLearningEntry,
  buildProgressMapFromExercises,
};
