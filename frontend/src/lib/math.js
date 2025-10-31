/* global math */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {number} span
 */
export function niceStep(span) {
  const raw = span / 10;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const base = raw / pow10;
  let step;
  if (base < 1.5) step = 1;
  else if (base < 3.5) step = 2;
  else if (base < 7.5) step = 5;
  else step = 10;
  return step * pow10;
}

/**
 * @param {number} value
 */
export function formatTick(value) {
  if (!isFinite(value)) return '';
  const a = Math.abs(value);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.01) return value.toExponential(0);
  if (a < 1) return value.toFixed(2);
  if (a < 10) return value.toFixed(1);
  return value.toFixed(0);
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 */
export function distance2D(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * @param {string} expression
 */
export function compileExpression(expression) {
  return math.compile(expression);
}

/**
 * @param {import('mathjs').MathNode} compiled
 * @param {Record<string, number>} scope
 */
export function evaluateCompiled(compiled, scope) {
  return compiled.evaluate(scope);
}
