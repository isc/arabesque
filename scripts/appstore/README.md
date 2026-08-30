# App Store Connect from the command line

`push_listing.py` writes the store listing, `testflight_invite.py` puts a tester
on TestFlight. Both talk to the App Store Connect API through `asc.py` and read
the same credentials.

## Pushing the App Store listing

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

## Inviting a TestFlight tester

```bash
python3 scripts/appstore/testflight_invite.py alice@example.com --name "Alice Martin"
python3 scripts/appstore/testflight_invite.py --status
```

Apple will not mail an invitation to an outsider until a chain of things exists,
so the script makes each of them and prints what it did: an external beta group
(`Testeurs`, `--group` for another), the newest valid build attached to it, a
what-to-test note, the beta review contact and notes, and the beta review
submission. Adding a tester before that review passes is fine — Apple mails them
on approval, and the review happens once per build, not once per tester.
`--status` says where it stands.

Internal testing would skip the review entirely, but an internal tester has to
be a user of the App Store Connect account. That is not something to hand to
someone who only wants to try the app — and on an individual membership there is
no one to add anyway.

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

Without the review contact file `push_listing.py` skips the review notes and
says so rather than failing: Apple requires a name, an email and a phone
alongside the notes, and refuses the update without all four.
`testflight_invite.py` stops instead — a beta submission with no contact is
rejected outright.

## From another machine

Everything here is HTTPS to Apple and nothing else, so it runs anywhere with
`python3`, `cryptography` and those three files — the whole API surface, not
just the parts these two scripts use today: listing, pricing, TestFlight groups
and testers, builds and their beta state, review submissions. A Linux box drives
App Store Connect as well as the Mac does.

```bash
rsync -a ~/.appstoreconnect/ HOST:.appstoreconnect/
ssh HOST 'chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys
          chmod 600 ~/.appstoreconnect/issuer_id ~/.appstoreconnect/review_contact.json \
                    ~/.appstoreconnect/private_keys/*.p8'
```

macOS ships an `rsync` with no `--chmod`, hence the modes set afterwards.

What does not travel is everything upstream of the API: archiving and signing
the app needs Xcode, and the screenshots come from simulators, so the binary is
made on the Mac or on the macOS runner the `TestFlight` workflow uses. From
anywhere else, the build is a thing you look up, not a thing you produce.

The key is the account's, not a machine's, and it is not scoped to one app: it
is worth putting only where the disk is trusted, and revoking in App Store
Connect if that stops being true.

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
