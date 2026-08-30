#!/usr/bin/env python3
"""Invite someone to test Arabesque on TestFlight.

    python3 scripts/appstore/testflight_invite.py alice@example.com
    python3 scripts/appstore/testflight_invite.py alice@example.com --name "Alice Martin"
    python3 scripts/appstore/testflight_invite.py --status

The invitation is the last step of a chain Apple insists on, so the script does
the whole chain and says what it did: an external beta group, the newest valid
build attached to it, the beta description and feedback address, the "what to
test" note, the beta review contact and notes, the review submission, then the
tester.

Apple mails the invitation once that beta review passes — a day or so, once per
build rather than per tester. `--status` says where it stands. Adding a tester
while the review is pending is fine: they are mailed on approval.

Unlike push_listing.py, which deliberately never submits anything, this does
submit for *beta* review. That is a different act: per build, seen only by the
group, and undone by shipping another build — not the public release the other
script leaves to a human.

Internal testing would skip the review, but an internal tester has to be a user
of the App Store Connect account itself, which is not something to hand to
someone who only wants to try the app.

Idempotent, like push_listing.py: everything is looked up rather than pasted,
re-running adds a tester to a group that already exists and re-submits nothing.
"""
import argparse
import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import asc  # noqa: E402
import listing_fr as copy  # noqa: E402

GROUP = "Testeurs"


def ensure_group(app, name):
    _, d = asc.call("GET", f"/v1/apps/{app}/betaGroups?limit=200")
    for group in d.get("data", []):
        if group["attributes"]["name"] != name:
            continue
        if group["attributes"]["isInternalGroup"]:
            raise SystemExit(f'"{name}" is an internal group: it only takes users of the '
                             "App Store Connect account. Pass --group with another name.")
        print(f"  ok    group {name}")
        return group["id"]
    # A group created through the API is external unless asked otherwise, which
    # is what an outside tester needs.
    created = asc.expect(f"group {name} created", *asc.call("POST", "/v1/betaGroups", {
        "data": {"type": "betaGroups", "attributes": {"name": name},
                 "relationships": {"app": {"data": {"type": "apps", "id": app}}}}}))
    return created["data"]["id"]


def attach_build(group, build):
    _, d = asc.call("GET", f"/v1/betaGroups/{group}/relationships/builds?limit=200")
    if any(b["id"] == build for b in d.get("data", [])):
        print("  ok    build already in the group")
        return
    asc.expect("build added to the group", *asc.call(
        "POST", f"/v1/betaGroups/{group}/relationships/builds",
        {"data": [{"type": "builds", "id": build}]}))


def upsert_localization(label, resource, owner, attributes):
    """Apple has no upsert: the fr-FR entry is looked up under its owner, then
    PATCHed or created. `owner` is the (relationship name, type, id) it hangs
    from — a build for what-to-test, the app for the beta description."""
    name, kind, owner_id = owner
    _, d = asc.call("GET", f"/v1/{kind}/{owner_id}/{resource}")
    for loc in d.get("data", []):
        if loc["attributes"]["locale"] == copy.LOCALE:
            asc.expect(label, *asc.call(
                "PATCH", f"/v1/{resource}/{loc['id']}",
                {"data": {"type": resource, "id": loc["id"], "attributes": attributes}}))
            return
    asc.expect(label, *asc.call("POST", f"/v1/{resource}", {
        "data": {"type": resource, "attributes": {**attributes, "locale": copy.LOCALE},
                 "relationships": {name: {"data": {"type": kind, "id": owner_id}}}}}))


def ensure_whats_new(build):
    """External testing is refused without a what-to-test note on the build."""
    upsert_localization("what to test", "betaBuildLocalizations",
                        ("build", "builds", build),
                        {"whatsNew": copy.BETA_WHATS_NEW})


def ensure_beta_description(app):
    """TestFlight carries its own description and feedback address, app-wide
    rather than per build. Apple refuses an external submission without them,
    and says so only at the submission itself."""
    contact = asc.review_contact()
    if contact is None:
        raise SystemExit(
            "no ~/.appstoreconnect/review_contact.json — TestFlight needs an "
            "address for tester feedback")
    upsert_localization("beta description", "betaAppLocalizations",
                        ("app", "apps", app),
                        {"description": copy.DESCRIPTION,
                         "feedbackEmail": contact["email"],
                         "marketingUrl": copy.MARKETING_URL,
                         "privacyPolicyUrl": copy.PRIVACY_URL})


def ensure_review_detail(app):
    """Same story as the App Store review notes: a reviewer with no MIDI keyboard
    needs telling what the app does without one, and Apple wants a contact."""
    attributes = asc.review_notes_attributes(copy.REVIEW_NOTES)
    if attributes is None:
        raise SystemExit(
            "no ~/.appstoreconnect/review_contact.json — beta review needs a name, "
            'an email and a phone: {"firstName","lastName","email","phone"}')
    asc.expect("beta review notes and contact", *asc.call(
        "PATCH", f"/v1/betaAppReviewDetails/{app}",
        {"data": {"type": "betaAppReviewDetails", "id": app, "attributes": attributes}}))


def submit_for_review(app, build):
    """Returns whether testers can already install: everything else means the
    invitation will only land once Apple has looked at the build."""
    state = external_state(build)
    if state != "READY_FOR_BETA_SUBMISSION":
        print(f"  ok    beta review: {readable(state)}")
        return state == "IN_BETA_TESTING"
    ensure_beta_description(app)
    ensure_whats_new(build)
    ensure_review_detail(app)
    asc.expect("submitted for beta review", *asc.call("POST", "/v1/betaAppReviewSubmissions", {
        "data": {"type": "betaAppReviewSubmissions",
                 "relationships": {"build": {"data": {"type": "builds", "id": build}}}}}))
    return False


def external_state(build):
    _, d = asc.call("GET", f"/v1/builds/{build}/buildBetaDetail")
    return d["data"]["attributes"]["externalBuildState"]


def readable(state):
    return (state or "unknown").lower().replace("_", " ")


def invite(group, email, name):
    first, _, last = (name or "").partition(" ")
    attributes = {"email": email}
    if first:
        attributes["firstName"] = first
    if last:
        attributes["lastName"] = last
    status, payload = asc.call("POST", "/v1/betaTesters", {
        "data": {"type": "betaTesters", "attributes": attributes,
                 "relationships": {"betaGroups": {
                     "data": [{"type": "betaGroups", "id": group}]}}}})
    if 200 <= status < 300:
        print(f"  ok    {email} invited")
        return
    # Already a tester of another group on this account: only the membership is
    # missing, and Apple refuses to create the tester twice.
    if status == 409:
        _, d = asc.call("GET", "/v1/betaTesters?filter[email]="
                               + urllib.parse.quote(email))
        existing = d.get("data") or []
        if existing:
            asc.expect(f"{email} added to the group", *asc.call(
                "POST", f"/v1/betaGroups/{group}/relationships/betaTesters",
                {"data": [{"type": "betaTesters", "id": existing[0]["id"]}]}))
            return
    asc.expect(f"{email} invited", status, payload)


def show_status(app):
    build = asc.newest_build(app)
    print(f"Build {build['attributes']['version']}, uploaded "
          f"{build['attributes']['uploadedDate'][:10]}")
    print(f"  external testing: {readable(external_state(build['id']))}")

    _, d = asc.call("GET", f"/v1/apps/{app}/betaGroups?limit=200")
    for group in d.get("data", []):
        kind = "internal" if group["attributes"]["isInternalGroup"] else "external"
        print(f"\n{group['attributes']['name']} ({kind})")
        _, builds = asc.call("GET", f"/v1/betaGroups/{group['id']}/builds?limit=10")
        versions = [b["attributes"]["version"] for b in builds.get("data", [])]
        print(f"  builds: {', '.join(versions) or 'none'}")
        _, d_testers = asc.call("GET", f"/v1/betaGroups/{group['id']}/betaTesters?limit=200")
        testers = d_testers.get("data") or []
        for tester in testers:
            a = tester["attributes"]
            print(f"  {a['email']} — {readable(a.get('state'))}")
        if not testers:
            print("  no tester")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("email", nargs="?", metavar="EMAIL")
    parser.add_argument("--name", help='"First Last", shown in the invitation email')
    parser.add_argument("--group", default=GROUP, help=f"beta group (default: {GROUP})")
    parser.add_argument("--status", action="store_true",
                        help="print groups, builds and testers, change nothing")
    args = parser.parse_args()
    if not args.email and not args.status:
        parser.error("give an email, or --status")

    app = asc.app_id()
    if args.status:
        show_status(app)
        return

    build = asc.newest_build(app)
    print(f"TestFlight — build {build['attributes']['version']}")
    group = ensure_group(app, args.group)
    attach_build(group, build["id"])
    in_testing = submit_for_review(app, build["id"])
    invite(group, args.email, args.name)

    if not in_testing:
        print("\nApple mails the invitation once beta review passes "
              "(--status to check).")


if __name__ == "__main__":
    main()
