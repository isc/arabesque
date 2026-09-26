"""Signed App Store Connect API client, and the lookups every script here starts
from: which app, which build.

Credentials are never committed. Everything is read from ~/.appstoreconnect:

    private_keys/AuthKey_<KEYID>.p8   the key; the key id is read off the name
    issuer_id                         or $ASC_ISSUER_ID
    review_contact.json               name, email and phone for App Review

That is the directory altool and xcodebuild already use for the key, and the
three files are all a machine needs to drive this API.
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
BUNDLE_ID = "app.arabesque.Arabesque"


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


def review_contact():
    """The contact lives outside the repo — it is personal data. None means it is
    not there; callers differ on whether that is fatal."""
    path = KEY_DIR / "review_contact.json"
    if not path.exists():
        return None
    contact = json.loads(path.read_text())
    missing = [k for k in ("firstName", "lastName", "email", "phone") if not contact.get(k)]
    if missing:
        raise SystemExit(f"{path} is missing: {', '.join(missing)}")
    return contact


def review_notes_attributes(notes):
    """The contact-and-notes block both review resources take, App Store and
    beta alike."""
    contact = review_contact()
    if contact is None:
        return None
    return {
        "notes": notes,
        "demoAccountRequired": False,
        "contactFirstName": contact["firstName"],
        "contactLastName": contact["lastName"],
        "contactEmail": contact["email"],
        # Apple wants +<country code> first, and says so unhelpfully late.
        "contactPhone": contact["phone"],
    }


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


_token = (None, 0)  # (jwt, expiry) — a run makes a dozen calls off one signature


def token() -> str:
    global _token
    jwt, expires_at = _token
    if jwt and time.time() < expires_at - 60:
        return jwt
    path = _key_path()
    key_id = path.stem.removeprefix("AuthKey_")
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    expires_at = int(time.time()) + 900
    payload = {
        "iss": _issuer_id(),
        "iat": int(time.time()),
        "exp": expires_at,
        "aud": "appstoreconnect-v1",
    }
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}".encode()
    r, s = utils.decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    jwt = f"{signing_input.decode()}.{_b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    _token = (jwt, expires_at)
    return jwt


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


def app_id():
    """Nothing here carries a pasted app id: everything starts from the bundle."""
    _, d = call("GET", f"/v1/apps?filter[bundleId]={BUNDLE_ID}")
    apps = d.get("data") or []
    if not apps:
        raise SystemExit(f"no app with bundle id {BUNDLE_ID} on this account")
    return apps[0]["id"]


def newest_build(app):
    """The build to ship or to test: last uploaded one that processed and has
    not aged out of its 90 days. Sorted by date rather than by version, which
    is a string and stops being an integer the day it stops being one."""
    _, d = call("GET", f"/v1/builds?filter[app]={app}&filter[processingState]=VALID"
                       "&filter[expired]=false&sort=-uploadedDate&limit=1")
    builds = d.get("data") or []
    if not builds:
        raise SystemExit("no valid unexpired build — run the TestFlight workflow first")
    return builds[0]
