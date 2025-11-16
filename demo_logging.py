#!/usr/bin/env python3
"""
Script de demostración del sistema de logging estructurado de EcuPlotWeb.

Muestra cómo se ven los logs en diferentes entornos y con diferentes tipos de mensajes.

Uso:
    # Modo desarrollo (logs legibles con colores)
    APP_ENV=development python demo_logging.py
    
    # Modo producción (logs JSON)
    APP_ENV=production python demo_logging.py
    
    # Modo test (logs mínimos)
    APP_ENV=test python demo_logging.py
"""

import sys
import os
from pathlib import Path

# Agregar el directorio raíz al path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend.app import create_app
from backend.config import Config
from flask import g


def demo_basic_logging(app):
    """Demostración de logging básico."""
    print("\n" + "="*80)
    print("1. LOGGING BÁSICO (compatible con código existente)")
    print("="*80 + "\n")
    
    with app.app_context():
        app.logger.debug("Mensaje de DEBUG: detalles internos del sistema")
        app.logger.info("Mensaje de INFO: operación normal del sistema")
        app.logger.warning("Mensaje de WARNING: situación anormal pero recuperable")
        app.logger.error("Mensaje de ERROR: algo falló y requiere atención")
        app.logger.critical("Mensaje de CRITICAL: error grave del sistema")


def demo_formatted_logging(app):
    """Demostración de logging con formato."""
    print("\n" + "="*80)
    print("2. LOGGING CON FORMATO (printf-style)")
    print("="*80 + "\n")
    
    with app.app_context():
        user_email = "demo@example.com"
        ip_address = "192.168.1.100"
        app.logger.info("Usuario %s inició sesión desde %s", user_email, ip_address)
        
        filename = "data.csv"
        line_count = 1500
        app.logger.info("Archivo %s procesado con %d líneas", filename, line_count)


def demo_structured_logging(app):
    """Demostración de logging estructurado con campos adicionales."""
    print("\n" + "="*80)
    print("3. LOGGING ESTRUCTURADO (con campos extra)")
    print("="*80 + "\n")
    
    with app.app_context():
        # Evento de login exitoso
        app.logger.info(
            "Login exitoso",
            extra={
                "event": "auth.login.success",
                "user_id": "12345",
                "user_email": "demo@example.com",
                "ip_address": "192.168.1.100",
                "user_agent": "Mozilla/5.0 Firefox/120.0",
            }
        )
        
        # Error al enviar email
        app.logger.error(
            "No se pudo enviar correo de verificación",
            extra={
                "event": "email.send_failed",
                "user_id": "12345",
                "recipient": "demo@example.com",
                "error_type": "SMTPException",
                "smtp_code": 550,
                "retry_count": 3,
            }
        )
        
        # Evento de pago procesado
        app.logger.info(
            "Pago procesado correctamente",
            extra={
                "event": "payment.success",
                "user_id": "12345",
                "amount": 99.99,
                "currency": "USD",
                "payment_method": "stripe",
                "transaction_id": "txn_abc123",
            }
        )


def demo_request_context_logging(app):
    """Demostración de logging con contexto de request."""
    print("\n" + "="*80)
    print("4. LOGGING CON CONTEXTO DE REQUEST (incluye request_id)")
    print("="*80 + "\n")
    
    with app.test_request_context("/api/demo", method="POST"):
        # Simular un request_id (normalmente generado automáticamente)
        g.request_id = "demo-1234-5678-90ab"
        
        # Simular un usuario autenticado
        class MockUser:
            id = 12345
            email = "demo@example.com"
        
        g.current_user = MockUser()
        
        # Estos logs incluirán automáticamente request_id, method, path, user_id, email
        app.logger.info("Procesando solicitud de demo")
        app.logger.info("Validación de datos completada")
        app.logger.info("Operación finalizada exitosamente")


def demo_exception_logging(app):
    """Demostración de logging de excepciones."""
    print("\n" + "="*80)
    print("5. LOGGING DE EXCEPCIONES (con stack trace)")
    print("="*80 + "\n")
    
    with app.app_context():
        try:
            # Simular un error
            result = 10 / 0
        except ZeroDivisionError as e:
            app.logger.error(
                "Error al procesar cálculo matemático",
                exc_info=True,
                extra={
                    "event": "calculation.error",
                    "operation": "division",
                    "dividend": 10,
                    "divisor": 0,
                }
            )


def main():
    """Función principal."""
    # Configurar el entorno si no está establecido
    app_env = os.getenv("APP_ENV", "development")
    
    print("\n" + "#"*80)
    print(f"# DEMO: Sistema de Logging Estructurado de EcuPlotWeb")
    print(f"# Entorno: {app_env.upper()}")
    print("#"*80)
    
    # Crear la aplicación
    app = create_app(Config)
    
    # Ejecutar demos
    demo_basic_logging(app)
    demo_formatted_logging(app)
    demo_structured_logging(app)
    demo_request_context_logging(app)
    demo_exception_logging(app)
    
    print("\n" + "="*80)
    print("DEMO COMPLETADO")
    print("="*80)
    print("\nPrueba con diferentes entornos:")
    print("  APP_ENV=development python demo_logging.py  # Logs con colores")
    print("  APP_ENV=production python demo_logging.py   # Logs en JSON")
    print("  APP_ENV=test python demo_logging.py         # Logs mínimos")
    print()


if __name__ == "__main__":
    main()
