import { createHistoryStore } from './history-store.js';

let instance = null;

export function ensureHistoryStore(options = {}) {
  if (!instance) {
    instance = createHistoryStore(options);
  }
  return instance;
}

export function getHistoryStore() {
  if (!instance) {
    throw new Error('History store has not been initialized. Call ensureHistoryStore first.');
  }
  return instance;
}

export default ensureHistoryStore;
