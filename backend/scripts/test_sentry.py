#!/usr/bin/env python
"""
Script para verificar la configuración de Sentry.

Este script verifica que:
1. Sentry SDK está instalado
2. La configuración está cargada correctamente
3. Se puede enviar un evento de prueba a Sentry

Uso:
    python backend/scripts/test_sentry.py

Requiere:
    - SENTRY_DSN configurado en .env
    - APP_ENV=production o APP_ENV=staging
"""
import os
import sys
from pathlib import Path

# Agregar el directorio raíz al path para importar módulos
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()


def test_sentry_installation():
    """Verifica que Sentry SDK está instalado."""
    try:
        import sentry_sdk
        print("✅ Sentry SDK instalado correctamente")
        try:
            # Intenta obtener la versión de diferentes formas
            version = getattr(sentry_sdk, '__version__', None) or getattr(sentry_sdk, 'VERSION', 'desconocida')
            if version == 'desconocida':
                import pkg_resources
                version = pkg_resources.get_distribution('sentry-sdk').version
            print(f"   Versión: {version}")
        except:
            print("   Versión: instalada (no se pudo determinar)")
        return True
    except ImportError:
        print("❌ Sentry SDK no está instalado")
        print("   Ejecuta: pip install 'sentry-sdk[flask,sqlalchemy]'")
        return False


def test_sentry_configuration():
    """Verifica la configuración de Sentry desde variables de entorno."""
    sentry_dsn = os.getenv('SENTRY_DSN')
    app_env = os.getenv('APP_ENV', 'production')
    sentry_env = os.getenv('SENTRY_ENVIRONMENT', app_env)
    traces_sample_rate = os.getenv('SENTRY_TRACES_SAMPLE_RATE', '0.1')
    
    print("\n📋 Configuración detectada:")
    print(f"   APP_ENV: {app_env}")
    print(f"   SENTRY_DSN: {'✅ Configurado' if sentry_dsn else '❌ No configurado'}")
    
    if sentry_dsn:
        # Ocultar la mayor parte del DSN por seguridad
        dsn_parts = sentry_dsn.split('@')
        if len(dsn_parts) > 1:
            masked_dsn = f"{dsn_parts[0][:20]}...@{dsn_parts[1]}"
        else:
            masked_dsn = sentry_dsn[:20] + "..."
        print(f"   DSN (masked): {masked_dsn}")
    
    print(f"   SENTRY_ENVIRONMENT: {sentry_env}")
    print(f"   SENTRY_TRACES_SAMPLE_RATE: {traces_sample_rate}")
    
    if not sentry_dsn:
        print("\n⚠️  SENTRY_DSN no está configurado")
        print("   Configura SENTRY_DSN en .env para habilitar Sentry")
        return False
    
    if app_env not in {'production', 'staging'}:
        print(f"\n⚠️  APP_ENV='{app_env}' no activa Sentry")
        print("   Sentry solo se activa en 'production' o 'staging'")
        return False
    
    print("✅ Configuración correcta para Sentry")
    return True


def test_sentry_integration():
    """Prueba la integración de Sentry enviando un evento de prueba."""
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    
    sentry_dsn = os.getenv('SENTRY_DSN')
    app_env = os.getenv('APP_ENV', 'production')
    sentry_env = os.getenv('SENTRY_ENVIRONMENT', app_env)
    traces_sample_rate = float(os.getenv('SENTRY_TRACES_SAMPLE_RATE', '0.1'))
    
    try:
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=sentry_env,
            integrations=[
                FlaskIntegration(),
                SqlalchemyIntegration(),
            ],
            traces_sample_rate=traces_sample_rate,
            send_default_pii=False,
        )
        print("\n✅ Sentry inicializado correctamente")
        
        # Enviar evento de prueba
        print("\n🚀 Enviando evento de prueba a Sentry...")
        event_id = sentry_sdk.capture_message(
            "Test de configuración de Sentry desde test_sentry.py",
            level="info"
        )
        
        if event_id:
            print(f"✅ Evento enviado exitosamente")
            print(f"   Event ID: {event_id}")
            print(f"   Revisa el evento en: https://sentry.io")
        else:
            print("⚠️  No se generó Event ID (puede ser normal con sampling)")
        
        # Enviar un error de prueba
        print("\n🚀 Enviando error de prueba a Sentry...")
        try:
            # Generar un error intencional
            1 / 0
        except ZeroDivisionError as e:
            event_id = sentry_sdk.capture_exception(e)
            print(f"✅ Error enviado exitosamente")
            print(f"   Event ID: {event_id}")
        
        # Flush para asegurar que los eventos se envíen
        print("\n⏳ Esperando confirmación de envío...")
        sentry_sdk.flush(timeout=5)
        print("✅ Eventos enviados a Sentry")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error al inicializar Sentry: {e}")
        return False


def main():
    """Función principal del script."""
    print("=" * 60)
    print("🔍 VERIFICACIÓN DE CONFIGURACIÓN DE SENTRY")
    print("=" * 60)
    
    # Test 1: Instalación
    if not test_sentry_installation():
        return 1
    
    # Test 2: Configuración
    if not test_sentry_configuration():
        print("\n💡 Tip: Configura las variables en .env:")
        print("   SENTRY_DSN=https://...@o0.ingest.sentry.io/0")
        print("   APP_ENV=production")
        return 1
    
    # Test 3: Integración
    print("\n⚠️  Este test enviará eventos de prueba a Sentry")
    confirm = input("¿Continuar? (s/n): ").strip().lower()
    if confirm not in {'s', 'si', 'sí', 'y', 'yes'}:
        print("Test cancelado")
        return 0
    
    if not test_sentry_integration():
        return 1
    
    print("\n" + "=" * 60)
    print("✅ TODOS LOS TESTS PASARON")
    print("=" * 60)
    print("\n💡 Próximos pasos:")
    print("   1. Revisa los eventos en tu dashboard de Sentry")
    print("   2. Configura alertas para errores críticos")
    print("   3. Ajusta SENTRY_TRACES_SAMPLE_RATE según tu tráfico")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
