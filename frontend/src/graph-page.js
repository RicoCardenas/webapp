const THEME_KEY = 'ecup-theme';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }
  window.dispatchEvent(new Event('themechange'));
}

function initTheme() {
  const btnTheme = document.querySelector('[data-theme-toggle]');
  const stored = localStorage.getItem(THEME_KEY);
  const preferDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (preferDark ? 'dark' : 'light');

  applyTheme(theme);
  if (btnTheme) btnTheme.setAttribute('aria-pressed', String(theme === 'dark'));

  btnTheme?.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
    btnTheme.setAttribute('aria-pressed', String(next === 'dark'));
  });
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

  const ro = new ResizeObserver(() => {
    window.dispatchEvent(new Event('resize'));
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
  const hud = document.getElementById('coord-hud');
  const canvas = document.querySelector('#ggb-container canvas');
  if (!hud || !canvas) return;

  canvas.addEventListener('mousemove', (e) => {
    hud.hidden = false;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left).toFixed(1);
    const sy = (e.clientY - rect.top).toFixed(1);
    hud.textContent = `(${sx}, ${sy})`;
  });
  canvas.addEventListener('mouseleave', () => { hud.hidden = true; });
}

// Init
function init() {
  initTheme();
  bindEscToBack();
  initFullHeightCanvasSync();
  initQueryExprBoot();
}

document.addEventListener('DOMContentLoaded', init);
