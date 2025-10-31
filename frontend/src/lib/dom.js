/**
 * @template {Element} T
 * @param {string} selector
 * @param {ParentNode} [context=document]
 * @returns {T|null}
 */
export function qs(selector, context = document) {
  return /** @type {T|null} */ (context.querySelector(selector));
}

/**
 * @param {string} selector
 * @param {ParentNode} [context=document]
 * @returns {NodeListOf<Element>}
 */
export function qsa(selector, context = document) {
  return context.querySelectorAll(selector);
}

/**
 * Toggle a class on an element.
 * @param {Element|null|undefined} element
 * @param {string} token
 * @param {boolean} [force]
 */
export function toggleClass(element, token, force) {
  if (!element) return;
  element.classList.toggle(token, force ?? !element.classList.contains(token));
}

/**
 * Set multiple aria-* attributes on an element.
 * @param {Element|null|undefined} element
 * @param {Record<string, string|number|boolean|null|undefined>} attributes
 */
export function setAria(element, attributes) {
  if (!element) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) {
      element.removeAttribute(`aria-${key}`);
    } else {
      element.setAttribute(`aria-${key}`, String(value));
    }
  }
}

/**
 * Toggle the aria-expanded state of an element.
 * @param {Element|null|undefined} element
 * @param {boolean} state
 */
export function toggleAriaExpanded(element, state) {
  if (!element) return;
  element.setAttribute('aria-expanded', String(state));
}

/**
 * Whether the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
