# Arabesque

Practise the piano with real-time feedback. Connect a MIDI keyboard, open a
score and play: every note lights up depending on whether you nailed it,
missed it or jumped ahead, and your practice is logged bar by bar.

Live at [arabesque.app](https://arabesque.app), in French and English. It runs
in the browser, installs as an app on Android, and ships as a native wrapper on
iPhone and iPad.

## Features

- **MIDI keyboard over USB or Bluetooth**: Web MIDI in the browser, CoreMIDI in
  the iOS app.
- **Note-by-note feedback** on the score as you play.
- **Practice modes**: free sight-reading, training on a passage, and a strict
  mode to the metronome that loops a passage and raises the tempo with every
  clean run.
- **Practice journal**: time, reworked bars, full run-throughs, a status per
  piece (sight-reading → refining → repertoire) and a year-at-a-glance calendar.
- **Fingerings** shown and edited right on the score.
- **Library** of 70+ public-domain scores, filterable by composer and period,
  and findable by playing their opening notes. You can also drop your own
  MusicXML file (`.xml`, `.mxl`) onto the page.
- **Listen** plays the piece at a chosen tempo from any bar.
- **Offline**: a score opened once stays available without a network.
- **Profiles**, one per pianist on a shared device, and an optional account to
  sync practice across devices.

## How it is built

A static site with no build step: everything the browser loads lives in
`public/`, and the few libraries it uses are vendored in `public/vendor/`
(Alpine.js, OpenSheetMusicDisplay, Tone.js, JSZip). Production and the branch
previews are served from GitHub Pages.

- **Data stays on the device**, in IndexedDB. Signing in (an emailed code,
  Supabase auth) syncs practice sessions, fingerings and profiles between
  devices. `supabase/` holds the canonical DDL and auth config.
- **A service worker** (`public/sw.js`) precaches the app shell and caches
  scores as they are opened.
- **`app.rb`** is a small Sinatra server for development and the test suite.
  It serves `public/`, plus a `/api/cassettes` endpoint that records and replays
  MIDI performances. Cassettes are a development tool: the tests replay them,
  and the recording bar only appears when that API answers, which it never does
  in production.
- **`ios/`** is the native wrapper: a WKWebView over the deployed app, with
  CoreMIDI injected as `navigator.requestMIDIAccess`. See
  [ios/README.md](ios/README.md).

### Where things are

| Path | What |
|---|---|
| `public/index.html` | Landing page |
| `public/library.html` | Score library |
| `public/score.html` | Score page, where the playing happens |
| `public/practice.html` | Practice calendar |
| `public/data.html` | Account, profiles, backup import/export |
| `public/js/` | One ES module per concern, e.g. `midi.js`, `musicxml.js`, `practiceTracker.js`, `storage.js`, `sync.js`, `i18n.js` (strings in `locales/`) |
| `public/styles.css` | The whole stylesheet: tokens, base layer, `.pt-*` components |
| `public/data/scores.json` | The library catalog |
| `public/data/fingerprints.json` | Opening-note fingerprints, generated from the catalog |
| `public/scores/` | The MusicXML files |
| `changelog.d/` | Pending entries for the in-app "What's new" |
| `supabase/` | Database schema and auth config |
| `scripts/` | Maintenance tools: fingerprints, changelog, feedback, deploy stamping, App Store, score sourcing |
| `landing-video/` | Build pipeline for the landing page's hero video |
| `test/` | Browser tests (Minitest + Capybara + Cuprite) and `test/js/` (Vitest) |

## Running it locally

Requires Ruby 3.3 and, to play, Chrome or Edge (Web MIDI).

```bash
bundle install
ruby app.rb
```

Then open <http://localhost:4567/library.html>. No keyboard is needed to browse
and view scores.

## Tests

Two suites, both run in CI on every pull request:

```bash
bundle exec rake test:parallel > tmp/test-output.txt 2>&1; cat tmp/test-output.txt
```

```bash
npm ci && npm run test:js
```

The first drives a headless Chrome through the real pages
(`DISABLE_HEADLESS=1` to watch it). `rake test` runs it serially. The second
unit-tests the modules with Vitest. No Ruby or Chrome on the machine?
`scripts/test-in-docker.sh` runs the browser suite in a container.

## Contributing

Every change goes through a pull request, squash-merged. Each pull request is
deployed at `https://arabesque.app/previews/<branch-slug>/library.html`.

[CLAUDE.md](CLAUDE.md) holds the working conventions: how to add a score, write
a changelog entry, handle user feedback, change the Supabase config, and write
browser tests that do not flake.

## Troubleshooting MIDI

If no keyboard shows up after clicking "Connect MIDI keyboard":

1. Check the keyboard is connected over USB, or paired over Bluetooth.
2. Use Chrome or Edge: Safari has no Web MIDI, so on iPhone and iPad use the app.
3. Allow MIDI access when the browser asks.

**Roland FP-30X (or FP-30) over Bluetooth**, if it does not appear:

1. Pair the keyboard in the operating system's Bluetooth settings.
2. On the keyboard, hold **Bluetooth** together with the **first black key**
   (F#/Gb), then release both.
3. Hold **Bluetooth** together with the **first white key** (F), then release
   both.
4. Re-pair the keyboard in the OS settings, then reload the page.

This resets the keyboard's Bluetooth connection state.

## License

[MIT License](https://opensource.org/licenses/MIT)

## Credits

- [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org): score rendering
- [Alpine.js](https://alpinejs.dev): UI
- [Tone.js](https://tonejs.github.io) and [@tonejs/piano](https://github.com/tambien/Piano): playback
- [Supabase](https://supabase.com): accounts and sync
