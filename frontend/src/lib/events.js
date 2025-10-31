/**
 * @param {EventTarget|null|undefined} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} listener
 * @param {boolean|AddEventListenerOptions} [options]
 */
export function on(target, type, listener, options) {
  target?.addEventListener?.(type, listener, options);
}

/**
 * @param {EventTarget|null|undefined} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} listener
 * @param {boolean|EventListenerOptions} [options]
 */
export function off(target, type, listener, options) {
  target?.removeEventListener?.(type, listener, options);
}

/**
 * @template {(...args: any[]) => void} T
 * @param {T} handler
 * @param {number} [delay=150]
 * @returns {T}
 */
export function debounce(handler, delay = 150) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  return /** @type {T} */ ((...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => handler(...args), delay);
  });
}
