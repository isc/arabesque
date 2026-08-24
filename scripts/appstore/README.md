# Pushing the App Store listing

Most of an App Store listing can be written through the API, which beats
retyping 2 300 characters of description into a web form and hoping the next
version gets the same words.

```bash
python3 scripts/appstore/push_listing.py                              # text, URLs, categories, age rating
python3 scripts/appstore/push_listing.py --screenshots tmp/appstore-screenshots
python3 scripts/appstore/push_listing.py --attach-build               # newest valid build
python3 scripts/appstore/push_listing.py --price-free                 # once, unless the price changes
```

The copy lives in `listing_fr.py`. Edit it there; running that file on its own
checks every field against Apple's length limits before a rejection does.

Screenshots come from `scripts/demo/capture.sh`.

## What it will not do

- **Submit for review.** Deliberately: that is a decision, not a step.
- **App Privacy** — the nutrition labels. No endpoint exists for them in this
  API version (`appDataUsages` and friends all 404), so they are filled in App
  Store Connect by hand. They are also the one part that must be answered
  honestly about the app rather than copied from anywhere.

## Credentials

Nothing here is committed. The client reads:

| What | Where | Notes |
|---|---|---|
| Private key | `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` | Where altool and xcodebuild look too. The key id is read off the filename. |
| Issuer id | `$ASC_ISSUER_ID` or `~/.appstoreconnect/issuer_id` | Same for the whole team; on the same page as the key. |
| Review contact | `~/.appstoreconnect/review_contact.json` | `{"firstName","lastName","email","phone"}` — personal data, so out of the repo. Apple wants the phone as `+33 …`. |

The key must have the **Admin** role. App Manager can create certificates but
cannot use `xcodebuild`'s cloud signing, which fails much later and much less
clearly (see `ios/README.md`).

Without the review contact file the script skips the review notes and says so
rather than failing: Apple requires a name, an email and a phone alongside the
notes, and refuses the update without all four.

## Two things worth knowing about the API

**Screenshot display types stop at `APP_IPHONE_67` and
`APP_IPAD_PRO_3GEN_129`.** There is no 6.9" or 13" value; Apple widened the
sizes those older names accept instead. Verified rather than assumed —
1320 × 2868 and 2064 × 2752 upload clean and come back `COMPLETE`.

**Asset upload URLs are pre-signed.** Sending our `Authorization` header along
with the bytes gets a 400 with nothing in it to explain why. `asc.put_bytes`
sends only the headers Apple hands back. A chunk that fails leaves a
reservation stuck at `AWAITING_UPLOAD` that will block the version, so the
script deletes it on the way out.

## Re-running

Everything is looked up by bundle id rather than pasted in, so this still works
on version 1.1. Re-running overwrites, and screenshot sets are emptied before
they are refilled — a second run leaves four iPhone shots and three iPad ones,
not eight and six.
