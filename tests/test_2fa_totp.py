from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import struct
import time


TOTP_PERIOD = 30
TOTP_DIGITS = 6


def _normalize_base32(secret):
    value = (secret or '').strip().upper()
    padding = '=' * ((8 - len(value) % 8) % 8)
    return value + padding


def _totp_value(secret, timestamp):
    key = base64.b32decode(_normalize_base32(secret), casefold=True)
    counter = int(timestamp // TOTP_PERIOD)
    msg = struct.pack('>Q', counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return f'{code:0{TOTP_DIGITS}d}'


def _totp_now(secret):
    return _totp_value(secret, time.time())


def _login(client, email, password, otp=None):
    payload = {"email": email, "password": password}
    if otp:
        payload["otp"] = otp
    return client.post("/api/login", json=payload)


def test_totp_flow(client, user_factory, session_token_factory):
    user = user_factory(email="twofa@example.com", password="Secret.123")
    token, _ = session_token_factory(user=user)
    headers = {"Authorization": f"Bearer {token}"}

    # Initial status
    status_res = client.get("/api/account/2fa/status", headers=headers)
    assert status_res.status_code == 200
    assert status_res.get_json()["enabled"] is False

    # Generate setup data
    setup_res = client.post("/api/account/2fa/setup", headers=headers)
    assert setup_res.status_code == 200
    setup_data = setup_res.get_json()
    secret = setup_data["secret"]
    assert secret

    code = _totp_now(secret)

    # Enable 2FA
    enable_res = client.post(
        "/api/account/2fa/enable",
        headers=headers,
        json={"code": code},
    )
    assert enable_res.status_code == 200
    backup_codes = enable_res.get_json()["backup_codes"]
    assert isinstance(backup_codes, list) and len(backup_codes) >= 1

    # Status should now be enabled
    status_res = client.get("/api/account/2fa/status", headers=headers)
    assert status_res.status_code == 200
    assert status_res.get_json()["enabled"] is True

    # Login without OTP should fail
    fail_login = _login(client, "twofa@example.com", "Secret.123")
    assert fail_login.status_code == 401
    assert fail_login.get_json().get("requires_2fa") is True

    # Login with valid TOTP should succeed
    login_ok = _login(client, "twofa@example.com", "Secret.123", otp=_totp_now(secret))
    assert login_ok.status_code == 200

    # Login with backup code should succeed once
    backup_code = backup_codes[0]
    login_backup = _login(client, "twofa@example.com", "Secret.123", otp=backup_code)
    assert login_backup.status_code == 200

    # Reuse same backup code should fail
    reuse_backup = _login(client, "twofa@example.com", "Secret.123", otp=backup_code)
    assert reuse_backup.status_code == 401

    # Regenerate backup codes
    regen_res = client.post(
        "/api/account/2fa/backup-codes/regenerate",
        headers=headers,
        json={"code": _totp_now(secret)},
    )
    assert regen_res.status_code == 200
    new_codes = regen_res.get_json()["backup_codes"]
    assert isinstance(new_codes, list) and len(new_codes) >= 1

    # Disable 2FA
    disable_res = client.post(
        "/api/account/2fa/disable",
        headers=headers,
        json={"code": _totp_now(secret)},
    )
    assert disable_res.status_code == 200

    status_res = client.get("/api/account/2fa/status", headers=headers)
    assert status_res.status_code == 200
    assert status_res.get_json()["enabled"] is False

    # Login without OTP should now succeed
    final_login = _login(client, "twofa@example.com", "Secret.123")
    assert final_login.status_code == 200
