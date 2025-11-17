"""
Structured logging configuration for EcuPlotWeb backend.

This module configures Python's logging system to emit structured (JSON) logs
in production and human-readable logs in development/test environments.

Features:
- JSON logs in production for log aggregation
- Pretty-printed logs in development for debugging
- Minimal logging in test to reduce noise
- Contextual fields: request_id, user_id, path, method, status_code, etc.
- Backward compatible with existing logging calls
"""

import logging
import sys
import time
import uuid
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from flask import Flask, g, has_request_context, request
from pythonjsonlogger import jsonlogger
from .services.request_utils import get_client_ip


class ContextualJsonFormatter(jsonlogger.JsonFormatter):
    """
    JSON formatter that adds contextual fields from Flask's request context.
    
    Includes:
    - timestamp (ISO-8601)
    - level
    - logger name
    - message
    - app_env
    - request_id, method, path, remote_addr, user_agent (if in request context)
    - user_id, email (if user is authenticated)
    - exception info (if available)
    """

    def __init__(self, *args, app_env: str = "production", **kwargs):
        super().__init__(*args, **kwargs)
        self.app_env = app_env

    def add_fields(
        self,
        log_record: Dict[str, Any],
        record: logging.LogRecord,
        message_dict: Dict[str, Any],
    ) -> None:
        """Add custom fields to the log record."""
        super().add_fields(log_record, record, message_dict)

        # Standard fields
        log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["app_env"] = self.app_env

        # Request context fields
        if has_request_context():
            log_record["request_id"] = getattr(g, "request_id", None)
            log_record["method"] = request.method
            log_record["path"] = request.path
            
            # Query string if present
            if request.query_string:
                log_record["query_string"] = request.query_string.decode("utf-8")
            
            # Remote address (sanitized)
            log_record["remote_addr"] = get_client_ip(request)
            
            # User agent
            if request.user_agent:
                log_record["user_agent"] = request.user_agent.string

            # User context (if authenticated)
            current_user = getattr(g, "current_user", None)
            if current_user:
                log_record["user_id"] = getattr(current_user, "id", None)
                log_record["email"] = getattr(current_user, "email", None)
            
            # Response time (if available)
            request_start_time = getattr(g, "request_start_time", None)
            if request_start_time:
                response_time_ms = (time.time() - request_start_time) * 1000
                log_record["response_time_ms"] = round(response_time_ms, 2)

        # Exception info
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)


class DevelopmentFormatter(logging.Formatter):
    """
    Human-readable formatter for development environment.
    
    Includes color coding and structured output that's easy to read in terminal.
    """

    # ANSI color codes
    COLORS = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
        "RESET": "\033[0m",
    }

    def format(self, record: logging.LogRecord) -> str:
        """Format log record with colors and context."""
        color = self.COLORS.get(record.levelname, "")
        reset = self.COLORS["RESET"]

        # Base format
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        base = f"{color}[{timestamp}] {record.levelname:8s}{reset} {record.name:30s} | {record.getMessage()}"

        # Add request context if available
        context_parts = []
        if has_request_context():
            request_id = getattr(g, "request_id", None)
            if request_id:
                context_parts.append(f"request_id={request_id[:8]}")
            
            context_parts.append(f"{request.method} {request.path}")
            
            current_user = getattr(g, "current_user", None)
            if current_user:
                user_id = getattr(current_user, "id", None)
                if user_id:
                    context_parts.append(f"user_id={user_id}")

        if context_parts:
            base += f" [{' | '.join(context_parts)}]"

        # Add exception if present
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)

        return base


def configure_logging(app: Flask) -> None:
    """
    Configure structured logging for the Flask application.
    
    Args:
        app: Flask application instance
    
    This function:
    - Sets up appropriate formatter based on APP_ENV
    - Configures log level
    - Attaches handlers to app.logger and root logger
    - Sets up request/response logging hooks
    """
    app_env = app.config.get("APP_ENV", "production")
    log_level_str = app.config.get("LOG_LEVEL", None)
    
    # Determine log level based on environment
    if log_level_str:
        log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    else:
        if app_env == "test":
            log_level = logging.WARNING
        elif app_env == "development":
            log_level = logging.DEBUG
        else:
            log_level = logging.INFO
    
    # Determine if JSON logging is enabled
    json_enabled = app.config.get("LOG_JSON_ENABLED", None)
    if json_enabled is None:
        json_enabled = app_env == "production"
    
    # Create formatter
    if json_enabled:
        formatter = ContextualJsonFormatter(
            fmt="%(message)s",
            app_env=app_env,
        )
    else:
        formatter = DevelopmentFormatter()
    
    # Configure handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.setFormatter(formatter)
    
    # Configure app logger
    # In test mode, don't clear handlers to preserve pytest's caplog handler
    if app_env != "test":
        app.logger.handlers.clear()
    app.logger.addHandler(handler)
    app.logger.setLevel(log_level)
    # Enable propagation in test environment for caplog to work
    app.logger.propagate = (app_env == "test")
    
    # Also configure root logger for consistency
    root_logger = logging.getLogger()
    if app_env != "test":
        root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)
    
    # Reduce noise from werkzeug in development
    if app_env == "development":
        logging.getLogger("werkzeug").setLevel(logging.WARNING)
    
    app.logger.info(
        "Logging configured",
        extra={
            "app_env": app_env,
            "log_level": logging.getLevelName(log_level),
            "json_enabled": json_enabled,
        },
    )


def setup_request_logging(app: Flask) -> None:
    """
    Set up request/response logging hooks.
    
    Registers before_request and after_request handlers to:
    - Generate and attach request_id to each request
    - Log request start with method, path, and user info
    - Log request completion with status code and response time
    - Handle exceptions and log them with full context
    """

    @app.before_request
    def before_request_logging():
        """Generate request ID and log request start."""
        # Generate unique request ID
        g.request_id = str(uuid.uuid4())
        g.request_start_time = time.time()
        
        # Log request start
        app.logger.info(
            "Request started",
            extra={
                "event": "request.started",
                "method": request.method,
                "path": request.path,
            },
        )

    @app.after_request
    def after_request_logging(response):
        """Log request completion with status and timing."""
        if hasattr(g, "request_start_time"):
            response_time_ms = (time.time() - g.request_start_time) * 1000
            
            app.logger.info(
                "Request completed",
                extra={
                    "event": "request.completed",
                    "status_code": response.status_code,
                    "response_time_ms": round(response_time_ms, 2),
                },
            )
        
        return response

    @app.errorhandler(Exception)
    def handle_exception(error: Exception):
        """Log uncaught exceptions with full context."""
        from werkzeug.exceptions import HTTPException
        
        # Don't log HTTP exceptions (400, 404, etc.) as these are expected
        # and handled by Flask's normal error handling
        if isinstance(error, HTTPException):
            # Return the error response directly instead of re-raising
            # This allows tests to get 404/400 responses instead of exceptions
            return error
        
        # Log actual uncaught exceptions (500 errors, etc.)
        app.logger.error(
            f"Uncaught exception: {str(error)}",
            exc_info=True,
            extra={
                "event": "exception.uncaught",
                "exception_type": type(error).__name__,
            },
        )
        
        # Re-raise to let Flask handle it normally
        raise


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance with the given name.
    
    This is a convenience function for creating loggers in other modules.
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Logger instance
    """
    return logging.getLogger(name)
