#!/usr/bin/env python3
"""Push the App Store listing: text, URLs, categories, age rating, screenshots.

    python3 scripts/appstore/push_listing.py                 # metadata only
    python3 scripts/appstore/push_listing.py --screenshots tmp/appstore-screenshots
    python3 scripts/appstore/push_listing.py --attach-build  # newest valid build

Idempotent: it looks everything up by bundle id rather than carrying pasted
identifiers, so it still works on version 1.1, and re-running overwrites rather
than duplicating. Screenshots replace what is already in each set.

It never submits for review — that stays a deliberate human act.

Two things it cannot do, because the API has no endpoint for them:

  * **App Privacy** (the nutrition labels). There is no appDataUsages resource
    in this API version; fill them in App Store Connect by hand.
  * **Review contact** name, phone and email. Those are personal details, so
    they live outside the repo — write them to
    ~/.appstoreconnect/review_contact.json and this script will send them with
    the notes:

        {"firstName": "...", "lastName": "...",
         "email": "...", "phone": "+33 6 12 34 56 78"}
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import asc  # noqa: E402
import listing_fr as copy  # noqa: E402

BUNDLE_ID = "app.arabesque.Arabesque"
LOCALE = "fr-FR"
PRIMARY_CATEGORY = "MUSIC"
SECONDARY_CATEGORY = "EDUCATION"
BASE_TERRITORY = "FRA"

# The API enum has no 6.9" or 13" value: Apple widened the sizes these older
# names accept instead. Verified — 1320x2868 and 2064x2752 upload clean and come
# back COMPLETE.
SCREENSHOT_SETS = {"APP_IPHONE_67": "iphone", "APP_IPAD_PRO_3GEN_129": "ipad"}

EDITABLE_STATES = {
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
    "METADATA_REJECTED", "INVALID_BINARY", "WAITING_FOR_REVIEW",
}


def find_ids():
    _, d = asc.call("GET", f"/v1/apps?filter[bundleId]={BUNDLE_ID}")
    apps = d.get("data") or []
    if not apps:
        raise SystemExit(f"no app with bundle id {BUNDLE_ID} on this account")
    app_id = apps[0]["id"]

    _, d = asc.call("GET", f"/v1/apps/{app_id}/appStoreVersions?limit=10")
    versions = [v for v in d.get("data", [])
                if v["attributes"]["appStoreState"] in EDITABLE_STATES]
    if not versions:
        raise SystemExit("no editable version — create one in App Store Connect first")
    version_id = versions[0]["id"]

    _, d = asc.call("GET", f"/v1/apps/{app_id}/appInfos")
    app_info_id = d["data"][0]["id"]

    def localization(path, kind):
        _, got = asc.call("GET", path)
        for loc in got.get("data", []):
            if loc["attributes"]["locale"] == LOCALE:
                return loc["id"]
        raise SystemExit(f"no {LOCALE} {kind} — add the language in App Store Connect first")

    return {
        "app": app_id,
        "version": version_id,
        "app_info": app_info_id,
        "version_loc": localization(f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations",
                                    "version localization"),
        "info_loc": localization(f"/v1/appInfos/{app_info_id}/appInfoLocalizations",
                                 "app info localization"),
    }


def push_metadata(ids):
    print("Metadata")
    asc.expect("subtitle, privacy policy URL", *asc.call(
        "PATCH", f"/v1/appInfoLocalizations/{ids['info_loc']}",
        {"data": {"type": "appInfoLocalizations", "id": ids["info_loc"], "attributes": {
            "subtitle": copy.SUBTITLE, "privacyPolicyUrl": copy.PRIVACY_URL}}}))

    asc.expect("description, keywords, URLs", *asc.call(
        "PATCH", f"/v1/appStoreVersionLocalizations/{ids['version_loc']}",
        {"data": {"type": "appStoreVersionLocalizations", "id": ids["version_loc"], "attributes": {
            "description": copy.DESCRIPTION,
            "keywords": copy.KEYWORDS,
            "promotionalText": copy.PROMOTIONAL_TEXT,
            "supportUrl": copy.SUPPORT_URL,
            "marketingUrl": copy.MARKETING_URL}}}))

    asc.expect("categories", *asc.call(
        "PATCH", f"/v1/appInfos/{ids['app_info']}",
        {"data": {"type": "appInfos", "id": ids["app_info"], "relationships": {
            "primaryCategory": {"data": {"type": "appCategories", "id": PRIMARY_CATEGORY}},
            "secondaryCategory": {"data": {"type": "appCategories", "id": SECONDARY_CATEGORY}}}}}))

    asc.expect("content rights", *asc.call(
        "PATCH", f"/v1/apps/{ids['app']}",
        {"data": {"type": "apps", "id": ids["app"], "attributes": {
            # The library is public-domain music: third-party content the app
            # has every right to show.
            "contentRightsDeclaration": "USES_THIRD_PARTY_CONTENT"}}}))

    # Nothing in the app touches any of these. The frequency questions take
    # "NONE"; the rest are booleans, and Apple rejects the wrong type outright.
    asc.expect("age rating", *asc.call(
        "PATCH", f"/v1/ageRatingDeclarations/{ids['app_info']}",
        {"data": {"type": "ageRatingDeclarations", "id": ids["app_info"], "attributes": {
            "alcoholTobaccoOrDrugUseOrReferences": "NONE",
            "contests": "NONE",
            "gamblingSimulated": "NONE",
            "gunsOrOtherWeapons": "NONE",
            "horrorOrFearThemes": "NONE",
            "matureOrSuggestiveThemes": "NONE",
            "medicalOrTreatmentInformation": "NONE",
            "profanityOrCrudeHumor": "NONE",
            "sexualContentGraphicAndNudity": "NONE",
            "sexualContentOrNudity": "NONE",
            "violenceCartoonOrFantasy": "NONE",
            "violenceRealistic": "NONE",
            "violenceRealisticProlongedGraphicOrSadistic": "NONE",
            "advertising": False,
            "ageAssurance": False,
            "gambling": False,
            "healthOrWellnessTopics": False,
            "lootBox": False,
            "messagingAndChat": False,
            "parentalControls": False,
            "socialMedia": False,
            # The webview only navigates arabesque.app; other links are handed
            # to Safari, so the app is not a browser.
            "unrestrictedWebAccess": False,
            # Own scores and fingerings stay on the device; nothing is shared
            # with other users.
            "userGeneratedContent": False}}}))

    contact = review_contact()
    if contact is None:
        print("  --    review notes: skipped, no ~/.appstoreconnect/review_contact.json")
        print("        Apple requires a name, email and phone alongside the notes;")
        print('        write {"firstName","lastName","email","phone"} there.')
        return False

    review_body = {
        "notes": copy.REVIEW_NOTES,
        "demoAccountRequired": False,
        "contactFirstName": contact["firstName"],
        "contactLastName": contact["lastName"],
        "contactEmail": contact["email"],
        # Apple wants +<country code> first, and says so unhelpfully late.
        "contactPhone": contact["phone"],
    }
    status, existing = asc.call("GET", f"/v1/appStoreVersions/{ids['version']}/appStoreReviewDetail")
    if existing.get("data"):
        detail_id = existing["data"]["id"]
        asc.expect("review notes", *asc.call(
            "PATCH", f"/v1/appStoreReviewDetails/{detail_id}",
            {"data": {"type": "appStoreReviewDetails", "id": detail_id, "attributes": review_body}}))
        return True
    else:
        asc.expect("review notes", *asc.call("POST", "/v1/appStoreReviewDetails", {
            "data": {"type": "appStoreReviewDetails", "attributes": review_body,
                     "relationships": {"appStoreVersion": {
                         "data": {"type": "appStoreVersions", "id": ids["version"]}}}}}))
        return True


def review_contact():
    """Read the App Review contact from outside the repo — it is personal data,
    and Apple will not take the notes without it."""
    path = pathlib.Path(os.path.expanduser("~/.appstoreconnect/review_contact.json"))
    if not path.exists():
        return None
    contact = json.loads(path.read_text())
    missing = [k for k in ("firstName", "lastName", "email", "phone") if not contact.get(k)]
    if missing:
        raise SystemExit(f"{path} is missing: {', '.join(missing)}")
    return contact


def push_price_free(ids):
    print("Pricing")
    _, d = asc.call("GET", f"/v1/apps/{ids['app']}/appPricePoints"
                           f"?filter[territory]={BASE_TERRITORY}&limit=200")
    free = [p for p in d.get("data", []) if float(p["attributes"]["customerPrice"]) == 0]
    if not free:
        raise SystemExit(f"no free price point for {BASE_TERRITORY}")
    asc.expect("free in every territory", *asc.call("POST", "/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": ids["app"]}},
            "baseTerritory": {"data": {"type": "territories", "id": BASE_TERRITORY}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${price}"}]}}},
        "included": [{"type": "appPrices", "id": "${price}",
                      "attributes": {"startDate": None, "endDate": None},
                      "relationships": {"appPricePoint": {
                          "data": {"type": "appPricePoints", "id": free[0]["id"]}}}}]}))


def push_screenshots(ids, folder):
    print(f"Screenshots from {folder}")
    _, d = asc.call("GET", f"/v1/appStoreVersionLocalizations/{ids['version_loc']}/appScreenshotSets")
    by_type = {s["attributes"]["screenshotDisplayType"]: s["id"] for s in d.get("data", [])}

    for display_type, prefix in SCREENSHOT_SETS.items():
        shots = sorted(folder.glob(f"{prefix}-*.png"))
        if not shots:
            print(f"  --    {display_type}: nothing named {prefix}-*.png, left alone")
            continue

        set_id = by_type.get(display_type)
        if set_id:
            # Replace rather than append, or a second run doubles the set.
            _, old = asc.call("GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots")
            for shot in old.get("data", []):
                asc.call("DELETE", f"/v1/appScreenshots/{shot['id']}")
        else:
            created = asc.expect(f"create {display_type}", *asc.call("POST", "/v1/appScreenshotSets", {
                "data": {"type": "appScreenshotSets",
                         "attributes": {"screenshotDisplayType": display_type},
                         "relationships": {"appStoreVersionLocalization": {
                             "data": {"type": "appStoreVersionLocalizations",
                                      "id": ids["version_loc"]}}}}}))
            set_id = created["data"]["id"]

        for shot in shots:
            upload_one(shot, set_id)


def upload_one(path, set_id):
    blob = path.read_bytes()
    reserved = asc.expect(f"reserve {path.name}", *asc.call("POST", "/v1/appScreenshots", {
        "data": {"type": "appScreenshots",
                 "attributes": {"fileSize": len(blob), "fileName": path.name},
                 "relationships": {"appScreenshotSet": {
                     "data": {"type": "appScreenshotSets", "id": set_id}}}}}))
    shot_id = reserved["data"]["id"]

    for operation in reserved["data"]["attributes"]["uploadOperations"]:
        chunk = blob[operation["offset"]:operation["offset"] + operation["length"]]
        status = asc.put_bytes(operation, chunk)
        if status >= 300:
            # A half-uploaded reservation would sit in the set forever as
            # AWAITING_UPLOAD and block the version.
            asc.call("DELETE", f"/v1/appScreenshots/{shot_id}")
            raise SystemExit(f"  FAIL  uploading {path.name} ({status}); reservation removed")

    asc.expect(f"commit {path.name}", *asc.call("PATCH", f"/v1/appScreenshots/{shot_id}", {
        "data": {"type": "appScreenshots", "id": shot_id, "attributes": {
            "uploaded": True, "sourceFileChecksum": hashlib.md5(blob).hexdigest()}}}))


def attach_newest_build(ids):
    print("Build")
    _, d = asc.call("GET", f"/v1/apps/{ids['app']}/builds?limit=20")
    valid = [b for b in d.get("data", [])
             if b["attributes"]["processingState"] == "VALID" and not b["attributes"]["expired"]]
    if not valid:
        raise SystemExit("  no valid build — run the TestFlight workflow first")
    newest = max(valid, key=lambda b: int(b["attributes"]["version"]))
    asc.expect(f"attach build {newest['attributes']['version']}", *asc.call(
        "PATCH", f"/v1/appStoreVersions/{ids['version']}/relationships/build",
        {"data": {"type": "builds", "id": newest["id"]}}))


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--screenshots", type=pathlib.Path, metavar="DIR",
                        help="upload the PNGs in DIR (see scripts/demo/capture.sh)")
    parser.add_argument("--attach-build", action="store_true",
                        help="attach the newest valid build to the version")
    parser.add_argument("--price-free", action="store_true",
                        help="create the free price schedule (only needed once)")
    parser.add_argument("--skip-metadata", action="store_true")
    args = parser.parse_args()

    try:
        ids = find_ids()
    except asc.ConfigError as e:
        raise SystemExit(f"error: {e}")

    print(f"App {ids['app']}, version {ids['version']}, locale {LOCALE}\n")
    contact_written = False
    if not args.skip_metadata:
        contact_written = push_metadata(ids)
    if args.price_free:
        push_price_free(ids)
    if args.screenshots:
        push_screenshots(ids, args.screenshots)
    if args.attach_build:
        attach_newest_build(ids)

    print("\nStill by hand in App Store Connect:")
    print("  • App Privacy (the nutrition labels) — no API endpoint exists")
    if not contact_written and not args.skip_metadata:
        print("  • Review contact: first name, last name, phone, email")
    print("  • Submitting for review")


if __name__ == "__main__":
    main()
