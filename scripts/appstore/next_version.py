#!/usr/bin/env python3
"""The version the next TestFlight build goes out as.

    python3 scripts/appstore/next_version.py     # prints it, e.g. 1.2

An approved version closes its train: TestFlight takes no more builds of it,
and says so only at the upload, twenty minutes into the run ("Invalid
Pre-Release Train. The train version '1.0' is closed"). So the version is read
off Apple's side first: the one ios/project.yml names while nothing that high
has been approved, else the minor version after the highest approved — 1.1 on
sale makes the next build 1.2. project.yml is a floor, raised by hand for a
bigger step (2.0); the TestFlight workflow's own input overrides both.
"""
import pathlib
import re
import sys

import asc

PROJECT = pathlib.Path(__file__).resolve().parents[2] / "ios" / "project.yml"

# A version Apple has not approved yet still takes builds; every other state
# comes after an approval.
NOT_YET_APPROVED = {
    "PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW",
    "WAITING_FOR_EXPORT_COMPLIANCE", "DEVELOPER_REJECTED", "REJECTED",
    "METADATA_REJECTED", "INVALID_BINARY",
}


def parse(version):
    return tuple(int(part) for part in version.split("."))


def next_version(floor, approved):
    highest = max(approved, key=parse, default=None)
    if highest is None or parse(floor) > parse(highest):
        return floor
    major, minor = (parse(highest) + (0,))[:2]
    return f"{major}.{minor + 1}"


def project_version():
    match = re.search(r"MARKETING_VERSION:\s*'([^']+)'", PROJECT.read_text())
    if not match:
        raise SystemExit(f"no MARKETING_VERSION in {PROJECT}")
    return match.group(1)


def approved_versions():
    status, payload = asc.call(
        "GET", f"/v1/apps/{asc.app_id()}/appStoreVersions"
               "?filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState&limit=200")
    if not 200 <= status < 300:
        raise SystemExit(f"could not list the App Store versions ({status}): {asc.errors_of(payload)}")
    return [v["attributes"]["versionString"] for v in payload["data"]
            if v["attributes"]["appStoreState"] not in NOT_YET_APPROVED]


if __name__ == "__main__":
    floor, approved = project_version(), approved_versions()
    version = next_version(floor, approved)
    # Only the version on stdout, for the workflow to read; the why on stderr.
    print(f"{floor} in ios/project.yml, approved: {', '.join(approved) or 'none'} → {version}", file=sys.stderr)
    print(version)
