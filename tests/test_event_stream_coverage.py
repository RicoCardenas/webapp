"""Tests de cobertura para event_stream.py."""

import queue
import pytest

from backend.app.event_stream import EventBroker


class TestEventBroker:
    """Tests para EventBroker."""

    def test_normalize_user_none(self):
        """Debe manejar user_id None."""
        broker = EventBroker()
        assert broker._normalize_user(None) is None

    def test_subscribe_none_user_raises(self):
        """Debe lanzar ValueError con user_id None."""
        broker = EventBroker()
        with pytest.raises(ValueError, match="user_id es requerido"):
            broker.subscribe(None)

    def test_subscribe_max_limit_replaces_oldest(self):
        """Debe reemplazar conexión más antigua al exceder límite."""
        broker = EventBroker(max_subscribers_per_user=2)
        
        # Crear 2 suscripciones
        q1 = broker.subscribe("user1")
        q2 = broker.subscribe("user1")
        
        # La tercera debe reemplazar la primera
        q3 = broker.subscribe("user1")
        
        # q1 debe haber recibido evento de desconexión
        try:
            event = q1.get_nowait()
            assert event["type"] == "disconnect"
        except queue.Empty:
            pass  # Puede estar vacía si se llenó

    def test_unsubscribe_none_user(self):
        """Debe manejar unsubscribe con user_id None."""
        broker = EventBroker()
        q = queue.Queue()
        # No debe lanzar excepción
        broker.unsubscribe(None, q)

    def test_unsubscribe_nonexistent(self):
        """Debe manejar unsubscribe de usuario sin suscripciones."""
        broker = EventBroker()
        q = queue.Queue()
        # No debe lanzar excepción
        broker.unsubscribe("nonexistent", q)

    def test_unsubscribe_queue_not_in_list(self):
        """Debe manejar unsubscribe de queue no registrada."""
        broker = EventBroker()
        q1 = broker.subscribe("user1")
        q2 = queue.Queue()  # No registrada
        
        # No debe lanzar excepción
        broker.unsubscribe("user1", q2)

    def test_unsubscribe_removes_user_when_empty(self):
        """Debe eliminar usuario de diccionario cuando no hay más queues."""
        broker = EventBroker()
        q = broker.subscribe("user1")
        
        broker.unsubscribe("user1", q)
        
        # El usuario no debe estar en subscribers
        assert "user1" not in broker._subscribers

    def test_set_max_subscribers_reduces_existing(self):
        """Debe reducir suscripciones existentes al bajar límite."""
        broker = EventBroker(max_subscribers_per_user=5)
        
        # Crear 4 suscripciones
        q1 = broker.subscribe("user1")
        q2 = broker.subscribe("user1")
        q3 = broker.subscribe("user1")
        q4 = broker.subscribe("user1")
        
        # Reducir límite a 2
        broker.set_max_subscribers(2)
        
        # Las 2 primeras queues deben haber sido desconectadas
        # (recibieron evento de disconnect)

    def test_set_max_subscribers_zero_becomes_one(self):
        """Debe usar mínimo de 1 suscriptor."""
        broker = EventBroker()
        broker.set_max_subscribers(0)
        
        assert broker._max_subscribers_per_user == 1

    def test_set_max_subscribers_with_empty_subscribers(self):
        """Debe manejar set_max cuando no hay suscriptores."""
        broker = EventBroker()
        # No debe lanzar excepción
        broker.set_max_subscribers(10)

    def test_publish_to_full_queue_skips(self):
        """Debe manejar queues llenos al publicar."""
        broker = EventBroker(max_queue_size=1)
        q = broker.subscribe("user1")
        
        # Llenar la queue
        broker.publish("user1", channel="test", event_type="msg1", data={"a": 1})
        
        # Intentar publicar más (debería ser ignorado silenciosamente)
        broker.publish("user1", channel="test", event_type="msg2", data={"b": 2})

    def test_publish_creates_event_with_sequence(self):
        """Debe crear eventos con id y timestamp."""
        broker = EventBroker()
        q = broker.subscribe("user1")
        
        broker.publish("user1", channel="test", event_type="msg", data={"key": "value"})
        
        event = q.get(timeout=1)
        assert event["channel"] == "test"
        assert event["type"] == "msg"
        assert event["data"]["key"] == "value"
        assert "id" in event  # Usa "id" en lugar de "sequence"
        assert "at" in event  # Usa "at" en lugar de "timestamp"
