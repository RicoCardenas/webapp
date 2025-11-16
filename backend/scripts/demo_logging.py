#!/usr/bin/env python3
"""
Demo script to show structured logging in action.

This script demonstrates the logging output in different environments.
"""

import sys
import os
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from flask import Flask, g
from backend.config import Config
from backend.app.logging_config import configure_logging, setup_request_logging


def demo_development_logging():
    """Show logs in development mode."""
    print("\n" + "=" * 80)
    print("DEVELOPMENT MODE - Human-Readable Logs")
    print("=" * 80 + "\n")
    
    class DevConfig(Config):
        APP_ENV = "development"
        LOG_JSON_ENABLED = False
        SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
        TESTING = False
    
    app = Flask(__name__)
    app.config.from_object(DevConfig)
    configure_logging(app)
    setup_request_logging(app)
    
    with app.app_context():
        app.logger.debug("This is a debug message with detailed information")
        app.logger.info("Application started successfully")
        app.logger.warning("This is a warning about something")
        app.logger.error("An error occurred while processing request")
        
        # Simulate a request with context
        with app.test_request_context("/api/login", method="POST"):
            g.request_id = "abc123-demo"
            
            class MockUser:
                id = 42
                email = "demo@example.com"
            
            g.current_user = MockUser()
            
            app.logger.info("User login successful")
            app.logger.warning("Password will expire in 7 days")
    
    print()


def demo_production_logging():
    """Show logs in production mode with JSON."""
    print("\n" + "=" * 80)
    print("PRODUCTION MODE - JSON Structured Logs")
    print("=" * 80 + "\n")
    
    class ProdConfig(Config):
        APP_ENV = "production"
        LOG_JSON_ENABLED = True
        SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
        TESTING = False
        SECRET_KEY = "demo-secret-key-for-testing"
    
    app = Flask(__name__)
    app.config.from_object(ProdConfig)
    configure_logging(app)
    setup_request_logging(app)
    
    with app.app_context():
        app.logger.info("Application started successfully")
        app.logger.warning("Cache miss for key: user_profile_123")
        app.logger.error(
            "Database connection failed",
            extra={
                "event": "database.connection.failed",
                "host": "localhost",
                "port": 5432,
                "error_type": "ConnectionError",
            }
        )
        
        # Simulate a request with context
        with app.test_request_context("/api/users/42", method="GET"):
            g.request_id = "550e8400-e29b-41d4-a716-446655440000"
            
            class MockUser:
                id = 42
                email = "demo@example.com"
            
            g.current_user = MockUser()
            
            app.logger.info(
                "User profile accessed",
                extra={
                    "event": "user.profile.accessed",
                    "target_user_id": 42,
                }
            )
    
    print()


def demo_structured_events():
    """Show structured logging with events."""
    print("\n" + "=" * 80)
    print("STRUCTURED EVENTS - Enhanced JSON Logs")
    print("=" * 80 + "\n")
    
    class ProdConfig(Config):
        APP_ENV = "production"
        LOG_JSON_ENABLED = True
        SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
        TESTING = False
        SECRET_KEY = "demo-secret-key-for-testing"
    
    app = Flask(__name__)
    app.config.from_object(ProdConfig)
    configure_logging(app)
    
    with app.app_context():
        # Authentication events
        app.logger.info(
            "Login successful",
            extra={
                "event": "auth.login.success",
                "user_id": 123,
                "email": "user@example.com",
                "ip_address": "192.168.1.100",
            }
        )
        
        app.logger.warning(
            "Failed login attempt",
            extra={
                "event": "auth.login.failed",
                "email": "attacker@evil.com",
                "ip_address": "10.0.0.1",
                "failed_attempts": 5,
                "reason": "invalid_password",
            }
        )
        
        # Payment events
        app.logger.info(
            "Payment processed",
            extra={
                "event": "payment.process.success",
                "user_id": 123,
                "amount": 99.99,
                "currency": "USD",
                "payment_method": "credit_card",
                "transaction_id": "txn_abc123",
            }
        )
        
        # Email events
        app.logger.error(
            "Email delivery failed",
            extra={
                "event": "email.send.failed",
                "recipient": "user@example.com",
                "template": "password_reset",
                "error_type": "SMTPException",
                "retry_count": 3,
            }
        )
        
        # API events
        app.logger.info(
            "API rate limit exceeded",
            extra={
                "event": "api.rate_limit.exceeded",
                "user_id": 456,
                "endpoint": "/api/data",
                "limit": 100,
                "window": "1 hour",
            }
        )
    
    print()


if __name__ == "__main__":
    print("\n" + "=" * 80)
    print("EcuPlotWeb Structured Logging Demo")
    print("=" * 80)
    
    demo_development_logging()
    demo_production_logging()
    demo_structured_events()
    
    print("\n" + "=" * 80)
    print("Demo Complete!")
    print("=" * 80 + "\n")
