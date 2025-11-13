from __future__ import annotations

import json
import logging
import queue
import threading
from collections import defaultdict, deque
from datetime import datetime, timezone
from itertools import count
from typing import Any, Deque, Dict, Iterable, Optional


class EventBroker:
    """Lightweight per-user event broker."""

    _DISCONNECT_EVENT = {
        "channel": "system",
        "type": "disconnect",
        "reason": "replaced",
    }

    def __init__(self, *, max_queue_size: int = 64, max_subscribers_per_user: int = 3):
        self._max_queue_size = max_queue_size
        self._max_subscribers_per_user = max(1, int(max_subscribers_per_user))
        self._subscribers: Dict[str, Deque[queue.Queue]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._sequence = count(1)
        self._logger = logging.getLogger(__name__)

    def _normalize_user(self, user_id: Optional[Any]) -> Optional[str]:
        if user_id is None:
            return None
        return str(user_id)

    def subscribe(self, user_id: Any) -> queue.Queue:
        """Register a listener for the given user and return the queue.

        Limita la cantidad de suscripciones simultáneas por usuario para evitar DoS.
        """
        normalized = self._normalize_user(user_id)
        if normalized is None:
            raise ValueError("user_id es requerido para suscribirse.")
        replacement: Optional[queue.Queue] = None
        with self._lock:
            queues = self._subscribers[normalized]
            if len(queues) >= self._max_subscribers_per_user:
                replacement = queues.popleft()
            q = queue.Queue(maxsize=self._max_queue_size)
            queues.append(q)

        if replacement is not None:
            self._logger.warning(
                "⚠️ Reemplazando conexión SSE anterior para el usuario %s por exceso de conexiones (límite: %d)",
                normalized,
                self._max_subscribers_per_user,
            )
            # Intentar enviar evento de desconexión a la conexión antigua
            try:
                replacement.put_nowait(self._DISCONNECT_EVENT.copy())
            except queue.Full:
                pass
            # Forzar limpieza de la cola antigua
            try:
                replacement.put_nowait(None)
            except queue.Full:
                pass
        return q

    def unsubscribe(self, user_id: Any, q: queue.Queue) -> None:
        normalized = self._normalize_user(user_id)
        if normalized is None:
            return
        with self._lock:
            subscribers = self._subscribers.get(normalized)
            if not subscribers:
                return
            try:
                subscribers.remove(q)
            except ValueError:
                pass
            if not subscribers:
                self._subscribers.pop(normalized, None)

    def set_max_subscribers(self, value: int) -> None:
        new_limit = max(1, int(value))
        with self._lock:
            self._max_subscribers_per_user = new_limit
            if not self._subscribers:
                return
            for user_id, queues in list(self._subscribers.items()):
                while len(queues) > new_limit:
                    replacement = queues.popleft()
                    try:
                        replacement.put_nowait(self._DISCONNECT_EVENT.copy())
                    except queue.Full:
                        pass
                if not queues:
                    self._subscribers.pop(user_id, None)

    def publish(self, user_id: Any, *, channel: str, event_type: str, data: Dict[str, Any]) -> None:
        """Push an event intended for a single user."""
        normalized = self._normalize_user(user_id)
        if normalized is None:
            return
        payload = self._build_payload(channel=channel, event_type=event_type, data=data)
        self._enqueue(normalized, payload)

    def broadcast(self, user_ids: Iterable[Any], *, channel: str, event_type: str, data: Dict[str, Any]) -> None:
        """Push the same event to multiple users."""
        payload = self._build_payload(channel=channel, event_type=event_type, data=data)
        targets = {self._normalize_user(uid) for uid in user_ids if uid is not None}
        for target in targets:
            if target is None:
                continue
            self._enqueue(target, payload)

    def _enqueue(self, user_id: str, payload: Dict[str, Any]) -> None:
        with self._lock:
            queues = list(self._subscribers.get(user_id, ()))
        for q in queues:
            try:
                q.put_nowait(payload)
            except queue.Full:
                # drop event for slow clients
                pass

    def _build_payload(self, *, channel: str, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": next(self._sequence),
            "channel": channel,
            "type": event_type,
            "at": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }

    @staticmethod
    def format_sse(payload: Dict[str, Any]) -> str:
        """Format payload as an SSE data frame."""
        body = json.dumps(payload, ensure_ascii=False)
        return f"id: {payload.get('id')}\nevent: {payload.get('type')}\ndata: {body}\n\n"


# Singleton broker shared across the app
events = EventBroker()

