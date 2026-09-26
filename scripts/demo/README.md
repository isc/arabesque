# App Store screenshots and the App Review video

Two commands, one harness. Both work on a throwaway copy of `public/`, so no
demo hook ever ships to a real user.

- `capture.sh` — the screenshot set for the listing
- `record.sh` — a walkthrough recorded off a simulator

The video App Review watches is neither of them: it is filmed, and it is
committed at `public/video/review-demo.mp4`.

## The App Review video

App Review has no MIDI keyboard, so a reviewer cannot exercise the one thing
this app is for. Guideline 2.1 asks for a demonstration video in exactly that
case, and its absence is the likeliest reason a submission comes back.

**The video that ships is filmed, not generated.** It is
`public/video/review-demo.mp4`, served at
`https://arabesque.app/video/review-demo.mp4` — that URL is what the review
notes in `scripts/appstore/listing_fr.py` point at, so replacing the file
replaces the video Apple watches. Thirty-seven seconds, one take, a phone
pointed at the iPad sitting on the piano: the app is launched from the home
screen, a score is opened, the Bluetooth MIDI sheet pairs AURES2UP, and the
piece is played on that keyboard with the notes turning green as they are
struck. The camera never leaves the keyboard and the iPad together.

That framing is the whole point, and it is what version 1.0 was rejected for on
2026-08-31: a simulator recording is not accepted for hardware-dependent apps.
Apple asks for three things by name, and a replacement has to keep all three —
the current build **on a physical Apple device**, the **pairing** itself
(sheet, Connecting…, Connected), and the workflow **with the hardware in
frame**. Re-film rather than re-generate.

Roughly 6 MB is the budget: every branch preview publishes a copy of `public/`,
so the file lands in `gh-pages` once per pull request. What came off the phone
was 92 MB of 1080p120 HEVC; H.264, 30 fps, 810 × 1440, CRF 26 and `faststart`
keeps the pairing sheet and the note names readable at a fifteenth of that.

```bash
ffmpeg -i PXL_….mp4 -vf "fps=30,scale=810:1440" -c:v libx264 -profile:v high \
  -pix_fmt yuv420p -crf 26 -preset slow -c:a aac -b:a 96k -ac 1 \
  -movflags +faststart public/video/review-demo.mp4
```

### The generated walkthrough

```bash
scripts/demo/record.sh                        # tmp/arabesque-review-demo.mp4
scripts/demo/record.sh ~/Desktop/demo.mp4 iphone
```

`record.sh` still produces a simulator walkthrough, and it is still the quickest
way to see a whole session end to end after a UI change: the score opens with a
keyboard connected, notes turn green as they are played, a wrong note is struck
and the piece visibly **fails to advance** until the right one arrives, the
practice history opens on what was recorded, and training mode is switched on.
The stall is the point — in free mode a wrong note colours nothing, so a
sequence that stops and then resumes is what proves the app is checking rather
than animating.

Its MIDI is generated in software — the same mock input the test suite uses:
`play.js` sends the notes `extractNotesFromScore` says the piece expects, and
the app decides what turns green. The app handles both sources identically,
which is why this is a fair demonstration of the app and still not an answer to
guideline 2.1: no hardware is visible, and none is being paired.

## Screenshots

```bash
scripts/demo/capture.sh                 # into tmp/appstore-screenshots
scripts/demo/capture.sh ~/Desktop/shots # or wherever
```

Regenerates the whole set from real simulators, so a UI change means re-running
one command rather than rediscovering how any of this worked.

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

## How both of them work

`public/` is copied to a temporary directory, two scripts are injected into the
copy, and that copy is served locally. The app's `PTWebAppURL` is pointed at it —
one page per shot for `capture.sh`, one long-running page for `record.sh`.
Nothing in `public/` is touched, and no demo hook ever ships to a real user.

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
