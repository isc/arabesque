# App Store screenshots

Regenerates the whole screenshot set from real simulators, so a UI change means
re-running one command rather than rediscovering how any of this worked.

```bash
scripts/demo/capture.sh                 # into tmp/appstore-screenshots
scripts/demo/capture.sh ~/Desktop/shots # or wherever
```

Takes about five minutes: it builds the app, boots two simulators and installs
into each one per shot.

## What it produces

| File | Size | Apple |
|---|---|---|
| `iphone-1-partition` … `iphone-4-historique` | 1320 × 2868 | 6.9" — **required** |
| `ipad-1-partition` … `ipad-3-historique` | 2064 × 2752 | 13" — **required** while the app ships for iPad |

In French: the listing's primary locale is `fr-FR`. Screenshots are per-locale,
so an English set means adding an `en-US` localization first.

## Needs

- macOS with **Xcode** (not just the command line tools) — set `DEVELOPER_DIR`
  if it is not at `/Applications/Xcode.app`
- **xcodegen** (`brew install xcodegen`)
- **Pillow** (`pip3 install --user pillow`) — Apple rejects screenshots with an
  alpha channel and the simulator always writes one
- The two simulators named at the top of `capture.sh`. New iPhone every year:
  when the 6.9" model changes, that name is the one line to edit.

## How it works

`public/` is copied to a temporary directory, two scripts are injected into the
copy, and that copy is served on port 45800. The app's `PTWebAppURL` is pointed
at it, one page per shot. Nothing in `public/` is touched, and no demo hook ever
ships to a real user.

- **`seed.js`** writes a few months of practice *sessions*, then lets the app
  recompute its own aggregates. The statuses on screen — Répertoire,
  Perfectionnement, Déchiffrage — are therefore whatever the real rules make of
  that history. The profiles at the top are matched to the thresholds in
  `practiceTracker.js`; if a capture comes out with everything in "Déchiffrage",
  those thresholds have moved and the profiles need matching to them again.
- **`play.js`** plays the opening of the piece through the same mock MIDI input
  the test suite uses. The notes it sends come from `extractNotesFromScore` —
  the app's own reading of the sheet — so it is the app that decides what turns
  green. Only the source of the MIDI bytes differs from a keyboard on the desk.

The one place the app's own code is patched in the copy is the mock's device
name, which reads "Mock MIDI Keyboard" and would say so in a store screenshot.
That patch **fails the run** if the string moves, rather than quietly shipping
seven screenshots that advertise a mock.

## Reading the output

`capture.sh` checks the pixel sizes and nothing else. It cannot tell whether
OSMD rendered the score, whether the seed produced a sensible spread of
statuses, or whether a panel opened. **Look at all seven** before uploading.

Two known blemishes, neither introduced here:

- On iPhone widths the score's title block overflows and its subtitles overlap,
  which is why the score shot scrolls past it (`demoscroll=185`).
- The Arabesque carries tempo marks exported as bare `<words>` ("58", "68",
  "78", "98"), which OSMD floats above the staff around bar 5. Visible on the
  iPad score shot.
