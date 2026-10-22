#!/usr/bin/env python3
"""Revoke the development certificates earlier TestFlight builds left behind.

    python3 scripts/appstore/revoke_ci_certificates.py            # revoke them
    python3 scripts/appstore/revoke_ci_certificates.py --dry-run  # list them

`xcodebuild -allowProvisioningUpdates` signs the archive with an Apple
Development certificate, and a CI runner starts with none: each build has the
API create one ("Created via API"), whose private key leaves with the runner.
Apple caps an account's certificates, and on 2026-10-04 the build after eleven
of them failed on "Your account has reached the maximum number of
certificates". The TestFlight workflow runs this ahead of its archive, so each
build finds room for its own; nothing can sign with the ones it revokes any
more. A certificate made any other way — Xcode on a Mac names it after its
owner — is left alone, and so is every distribution certificate: the builds
already out are signed with those.
"""
import argparse

import asc

CREATED_BY_CI = "Created via API"


def ci_certificates():
    status, payload = asc.call("GET", "/v1/certificates?limit=200&fields[certificates]=displayName,certificateType")
    asc.expect("list the certificates", status, payload)
    return [
        certificate
        for certificate in payload["data"]
        if certificate["attributes"]["certificateType"] == "DEVELOPMENT"
        and certificate["attributes"].get("displayName") == CREATED_BY_CI
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="list them, revoke nothing")
    args = parser.parse_args()

    certificates = ci_certificates()
    print(f"{len(certificates)} development certificate(s) left by earlier builds")
    for certificate in certificates:
        if args.dry_run:
            print(f"  would revoke {certificate['id']}")
            continue
        status, payload = asc.call("DELETE", f"/v1/certificates/{certificate['id']}")
        asc.expect(f"revoke {certificate['id']}", status, payload)


if __name__ == "__main__":
    main()
