"""Request-related utilities."""
from flask import request as flask_request


def get_client_ip(req=None):
    """
    Obtains the client IP, honoring X-Forwarded-For when present.
    
    Args:
        req: Flask request object. Defaults to the global request.
    """
    req = req or flask_request
    if req is None:
        return None

    forwarded_for = req.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        parts = [part.strip() for part in forwarded_for.split(",") if part.strip()]
        if parts:
            return parts[0]

    real_ip = req.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    return req.remote_addr
