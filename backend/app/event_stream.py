"""Simple in-process event broker for Server-Sent Events streams."""
from __future__ import annotations

import json
import queue
import threading
from collections import defaultdict
from datetime import datetime, timezone
from itertools import count
from typing import Any, Dict, Iterable, Optional


class EventBroker:
    """Lightweight per-user event broker."""

    def __init__(self, *, max_queue_size: int = 64):
        self._max_queue_size = max_queue_size
        self._subscribers: Dict[str, set[queue.Queue]] = defaultdict(set)
        self._lock = threading.Lock()
        self._sequence = count(1)

    def _normalize_user(self, user_id: Optional[Any]) -> Optional[str]:
        if user_id is None:
            return None
        return str(user_id)

    def subscribe(self, user_id: Any) -> queue.Queue:
        """Register a listener for the given user and return the queue."""
        normalized = self._normalize_user(user_id)
        if normalized is None:
            raise ValueError("user_id es requerido para suscribirse.")
        q: queue.Queue = queue.Queue(maxsize=self._max_queue_size)
        with self._lock:
            self._subscribers[normalized].add(q)
        return q

    def unsubscribe(self, user_id: Any, q: queue.Queue) -> None:
        normalized = self._normalize_user(user_id)
        if normalized is None:
            return
        with self._lock:
            subscribers = self._subscribers.get(normalized)
            if not subscribers:
                return
            subscribers.discard(q)
            if not subscribers:
                self._subscribers.pop(normalized, None)

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

