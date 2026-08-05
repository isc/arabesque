# Landing hero video

Build pipeline for the animated product video on the landing page
(`public/video/hero.mp4`). The video is a [HyperFrames](https://github.com/heygen-com/hyperframes)
composition (HTML/CSS/GSAP → MP4) whose scenes are **real screenshots of the
app**, captured with Playwright while driving the app's own MIDI engine.

Only the final MP4 + poster are committed (under `public/`). The intermediate
screenshots live in `composition/assets/` and are **gitignored** — they're
derived from a personal practice-data backup, and regenerable from it.

```
landing-video/
  capture/
    lib.mjs            shared Playwright helpers (launch, openScore, mock-MIDI cookie)
    build-assets.mjs   seed the app from a backup, capture every screenshot
  composition/
    index.html         the HyperFrames composition (5 scenes + GSAP timeline)
    design.md          brand/design system (colours, type, motion)
    assets/            generated screenshots (gitignored)
  encode.sh            newest render → public/video/hero.mp4 + poster
```

## Prerequisites

- Node 22+ and FFmpeg (`ffmpeg -version`)
- `npm install` here, then `npx playwright install chromium`
  (or set `PT_CHROMIUM=/path/to/Chromium` to reuse an existing binary)
- A backup export: in the app, **Bibliothèque → ⚙️ Gestion des données →
  Exporter sauvegarde**. It lands in `~/Downloads/arabesque-backup-*.json`.

## Regenerate

The video is **bilingual**: the app is captured and the captions rendered once
per language, producing `public/video/hero.<lang>.mp4` (+ poster). The landing
serves the file matching the visitor's language. Repeat the steps below for each
language (`en`, `fr`), setting `PT_LANG` so the captured screenshots are in that
language and pointing `caps.active.js` at the matching caption catalog.

```bash
# 1. Run the app (from the repo root, in another terminal)
bundle exec ruby app.rb            # serves http://localhost:4567

cd landing-video && npm install

# 2. Point the composition at this language's captions
echo "export { default as CAPS } from './captions/en.js'" > composition/caps.active.js

# 3. Capture the app states (in that language) into composition/assets/
PT_LANG=en PT_BACKUP=~/Downloads/arabesque-backup-*.json npm run capture

# 4. Render (composition/renders/*.mp4)
npm run render

# 5. Encode the web-ready, language-suffixed hero assets into ../public/
bash encode.sh en                  # → ../public/video/hero.en.mp4 + poster

# …then repeat steps 2-5 with `fr`. Leave caps.active.js on fr at the end.
```

Then commit the updated `public/video/hero.{en,fr}.mp4` and
`public/img/hero-poster.{en,fr}.jpg`.

`caps.active.js` re-exports `captions/<lang>.js` for the render in progress;
it's committed pointing at French so `npm run dev`/`render` works unconfigured.
Caption text lives in `composition/captions/{fr,en}.js`; the screenshots come
from the running app, so the UI's own i18n keeps them in sync.

## Notes

- **Scenes** (see `composition/index.html`): library → real-time note feedback →
  training mode (3× per measure) → practice history → brand lockup.
- **Real engine feedback**: `build-assets.mjs` sets the `test-env` cookie to
  enable the in-app mock MIDI keyboard, reads expected pitches from the OSMD
  cursor (`Pitch.halfTone + 12`), and dispatches real `mock-midi-input` events
  so the app's matching engine colours the played notes — no fake overlays.
- **Score URLs load without a leading slash** (`scores/…`, the way the library
  links them) so `scoreUrl` matches the stored session ids and the history
  chart resolves.
- **Editing the video**: tweak `composition/index.html` and preview live with
  `cd composition && npm run dev`, or `npm run check` to lint. Keep the brand in
  `composition/design.md`.
- The landing page autoplays the result muted/looping and honours
  `prefers-reduced-motion` (poster fallback) — that lives in `public/index.html`.
