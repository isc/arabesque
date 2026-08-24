"""Signed App Store Connect API client.

Credentials are never committed. The private key is the one the Supabase-style
convention already puts at ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8,
which is also where altool and xcodebuild look for it, and the key id is read
off that filename. The issuer id comes from the environment or a file beside
the key.

    export ASC_ISSUER_ID=...        # or: echo ... > ~/.appstoreconnect/issuer_id
"""
import base64
import glob
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

BASE = "https://api.appstoreconnect.apple.com"
KEY_DIR = pathlib.Path(os.path.expanduser("~/.appstoreconnect"))


class ConfigError(RuntimeError):
    pass


def _key_path() -> pathlib.Path:
    found = sorted(glob.glob(str(KEY_DIR / "private_keys" / "AuthKey_*.p8")))
    if not found:
        raise ConfigError(
            f"no App Store Connect key at {KEY_DIR / 'private_keys'}/AuthKey_<KEYID>.p8\n"
            "Create one under Users and Access → Integrations with the Admin role "
            "(App Manager is not enough) and save it there."
        )
    if len(found) > 1:
        raise ConfigError(f"several keys in {KEY_DIR / 'private_keys'} — leave the one to use")
    return pathlib.Path(found[0])


def _issuer_id() -> str:
    from_env = os.environ.get("ASC_ISSUER_ID")
    if from_env:
        return from_env.strip()
    stored = KEY_DIR / "issuer_id"
    if stored.exists():
        return stored.read_text().strip()
    raise ConfigError(
        "no issuer id: set ASC_ISSUER_ID, or write it to ~/.appstoreconnect/issuer_id.\n"
        "It is on the same App Store Connect page as the key, and is the same for the whole team."
    )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def token() -> str:
    path = _key_path()
    key_id = path.stem.removeprefix("AuthKey_")
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {
        "iss": _issuer_id(),
        "iat": int(time.time()),
        "exp": int(time.time()) + 900,
        "aud": "appstoreconnect-v1",
    }
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}".encode()
    r, s = utils.decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    return f"{signing_input.decode()}.{_b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def call(method, path, body=None):
    """Returns (status, parsed-json). Errors come back rather than raising, so a
    caller can report which step of a long sequence failed."""
    url = path if path.startswith("http") else BASE + path
    headers = {
        "Authorization": f"Bearer {token()}",
        # Apple's edge rejects urllib's default agent with an opaque 403.
        "User-Agent": "arabesque-listing/1.0",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, {"raw": e.read().decode()}


def put_bytes(operation, chunk):
    """One chunk of an asset upload. The URL Apple hands back is pre-signed and
    carries its own headers — adding our Authorization to it is what an
    otherwise unexplained 400 means."""
    headers = {h["name"]: h["value"] for h in operation["requestHeaders"]}
    req = urllib.request.Request(operation["url"], data=chunk, headers=headers,
                                 method=operation["method"])
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def errors_of(payload):
    try:
        return [f"{e.get('code')}: {e.get('detail') or e.get('title')}"
                for e in json.loads(payload["raw"])["errors"]]
    except Exception:
        return [str(payload)[:300]]


def expect(label, status, payload):
    if 200 <= status < 300:
        print(f"  ok    {label}")
        return payload
    print(f"  FAIL  {label} ({status})")
    for line in errors_of(payload):
        print(f"        {line[:220]}")
    raise SystemExit(1)
