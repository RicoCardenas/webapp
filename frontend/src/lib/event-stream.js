import { getSessionToken } from './session.js';

const DEFAULT_URL = '/api/stream';
const DEFAULT_RETRY = 4000;

export function createEventStream(options = {}) {
  const url = options.url || DEFAULT_URL;
  const retryDelay = options.retryDelay || DEFAULT_RETRY;

  const eventListeners = new Map();
  const channelListeners = new Map();
  const boundEvents = new Map();

  let source = null;
  let reconnectTimer = null;
  let destroyed = false;

  function dispatch(event) {
    let payload = {};
    if (event.data) {
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        console.warn('No se pudo parsear el evento SSE', error, event.data);
        payload = {};
      }
    }
    payload.type = payload.type || event.type || 'message';

    const direct = eventListeners.get(event.type);
    if (direct) {
      direct.forEach((listener) => {
        try {
          listener(payload, event);
        } catch (error) {
          console.error('Error en listener SSE', error);
        }
      });
    }

    const channel = payload.channel;
    if (channel) {
      const listeners = channelListeners.get(channel);
      if (listeners) {
        listeners.forEach((listener) => {
          try {
            listener(payload, event);
          } catch (error) {
            console.error('Error en listener SSE (canal)', error);
          }
        });
      }
    }
  }

  function bindEvent(eventName) {
    if (boundEvents.has(eventName)) return;
    const handler = (event) => dispatch(event);
    boundEvents.set(eventName, handler);
    if (source) {
      source.addEventListener(eventName, handler);
    }
  }

  function unbindEvent(eventName) {
    const handler = boundEvents.get(eventName);
    if (!handler) return;
    boundEvents.delete(eventName);
    if (source) {
      source.removeEventListener(eventName, handler);
    }
  }

  function ensureConnection() {
    if (destroyed) return;
    if (source) return;
    const token = options.token || getSessionToken();
    if (!token) return;

    const connector = () => {
      if (destroyed) return;
      const streamUrl = new URL(url, window.location.origin);
      streamUrl.searchParams.set('token', token);
      const nextSource = new EventSource(streamUrl.toString());

      nextSource.addEventListener('ready', () => {
        if (options.onReady) options.onReady();
      });
      nextSource.addEventListener('keepalive', () => {
        /* noop */
      });
      nextSource.onerror = () => {
        scheduleReconnect();
      };

      boundEvents.forEach((handler, eventName) => {
        nextSource.addEventListener(eventName, handler);
      });

      source = nextSource;
    };

    connector();
  }

  function scheduleReconnect() {
    if (destroyed) return;
    if (source) {
      source.close();
      source = null;
    }
    if (reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      ensureConnection();
    }, retryDelay);
  }

  function subscribe(eventName, listener) {
    if (!eventListeners.has(eventName)) {
      eventListeners.set(eventName, new Set());
      bindEvent(eventName);
    }
    const listeners = eventListeners.get(eventName);
    listeners.add(listener);
    ensureConnection();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        eventListeners.delete(eventName);
        unbindEvent(eventName);
      }
    };
  }

  function subscribeChannel(channel, listener) {
    if (!channelListeners.has(channel)) {
      channelListeners.set(channel, new Set());
    }
    const listeners = channelListeners.get(channel);
    listeners.add(listener);
    ensureConnection();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        channelListeners.delete(channel);
      }
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (source) {
      try {
        source.close();
      } catch {}
      source = null;
    }
  }

  function stop() {
    destroyed = true;
    disconnect();
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    boundEvents.clear();
    eventListeners.clear();
    channelListeners.clear();
  }

  return {
    subscribe,
    subscribeChannel,
    stop,
    disconnect,
    ensure: ensureConnection,
  };
}
