#!/bin/bash
# Regenerate the App Store screenshots from a booted simulator.
#
#   scripts/demo/capture.sh [output-dir]
#
# See scripts/demo/README.md for what it does and what it needs. Every failure
# mode here is loud on purpose: a screenshot that silently comes out wrong is
# worse than one that never gets taken, because nobody looks at 7 PNGs twice.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$REPO/tmp/appstore-screenshots}"
PORT=45800
IPHONE_NAME="iPhone 17 Pro Max"   # 6.9" — 1320 x 2868, the required iPhone size
IPAD_NAME="iPad Pro 13-inch (M5)" # 13"  — 2064 x 2752, required while the app ships for iPad
IPHONE_SIZE="1320 2868"
IPAD_SIZE="2064 2752"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

die() { echo "error: $*" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------
[ -d "$DEVELOPER_DIR" ] || die "no Xcode at $DEVELOPER_DIR (set DEVELOPER_DIR)"
command -v xcodegen > /dev/null || die "xcodegen missing — brew install xcodegen"
python3 -c "import PIL" 2> /dev/null ||
  die "Pillow missing — pip3 install --user pillow (needed to drop the alpha channel Apple rejects)"

SITE="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2> /dev/null || true; fi
  rm -rf "$SITE"
}
trap cleanup EXIT

# --- A throwaway copy of the site, with the demo hooks injected ---------------
cp -R "$REPO/public/." "$SITE/"
cp "$REPO/scripts/demo/seed.js" "$REPO/scripts/demo/play.js" "$SITE/"

inject() { # inject <file> <script>
  local file="$SITE/$1"
  [ -f "$file" ] || die "public/$1 is gone — the shot list below needs updating"
  grep -q '</head>' "$file" || die "no </head> in public/$1"
  # shellcheck disable=SC2016
  python3 - "$file" "$2" <<'PY'
import pathlib, sys
path, script = pathlib.Path(sys.argv[1]), sys.argv[2]
html = path.read_text()
path.write_text(html.replace('</head>', f'    <script type="module" src="{script}"></script>\n  </head>', 1))
PY
}

inject library.html seed.js
inject practice.html seed.js
inject score.html seed.js
inject score.html play.js

# The mock backend names itself for what it is, which is the truth in a test and
# noise in a store screenshot. Swap it for a real device name in the copy only.
python3 - "$SITE/js/midi.js" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
old = "state.midiInput = { name: 'Mock MIDI Keyboard' }"
if source.count(old) != 1:
    sys.exit("error: midi.js no longer sets the mock device name where capture.sh expects it.\n"
             "       Without this the screenshots would read 'Mock MIDI Keyboard'.")
path.write_text(source.replace(old, "state.midiInput = { name: 'Roland FP-30' }"))
PY

( cd "$SITE" && python3 -m http.server "$PORT" > /dev/null 2>&1 ) &
SERVER_PID=$!
# Off the job table, so killing it at exit doesn't print "Terminated" over the
# last thing the script has to say.
disown "$SERVER_PID" 2> /dev/null || true
sleep 2
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/library.html" || die "demo server did not come up on $PORT"

# --- The app ------------------------------------------------------------------
( cd "$REPO/ios" && xcodegen generate > /dev/null )
( cd "$REPO/ios" && xcodebuild -project Arabesque.xcodeproj -target Arabesque \
    -sdk iphonesimulator -configuration Debug build \
    CODE_SIGNING_ALLOWED=NO SYMROOT="$REPO/ios/build" > /dev/null ) || die "the app did not build"
APP="$REPO/ios/build/Debug-iphonesimulator/Arabesque.app"

udid_for() {
  xcrun simctl list devices available --json |
    python3 -c "import json,sys; print(next((d['udid'] for r in json.load(sys.stdin)['devices'].values() for d in r if d['name'] == sys.argv[1]), ''))" "$1"
}

shoot() { # shoot <udid> <relative-url> <out.png> <settle-seconds>
  plutil -replace PTWebAppURL -string "http://127.0.0.1:$PORT/$2" "$APP/Info.plist"
  xcrun simctl terminate "$1" app.arabesque.Arabesque 2> /dev/null || true
  xcrun simctl install "$1" "$APP"
  xcrun simctl launch "$1" app.arabesque.Arabesque > /dev/null
  sleep "$4"
  xcrun simctl io "$1" screenshot "$3" > /dev/null 2>&1
}

# The shot list. Order is the order they appear on the listing, so the piece
# that sells the app comes first.
SCORE="score.html?url=scores/Arabesque_L._66_No._1_in_E_Major.mxl"
capture_device() { # capture_device <name> <prefix> <expected "w h"> <score-scroll>
  local name="$1" prefix="$2" expected="$3" scroll="$4" udid
  udid="$(udid_for "$name")"
  [ -n "$udid" ] || die "no simulator named '$name' — xcrun simctl list devices available"
  echo "  $name"
  xcrun simctl boot "$udid" 2> /dev/null || true
  xcrun simctl bootstatus "$udid" -b > /dev/null

  shoot "$udid" "$SCORE&demoplay=14&demoscroll=$scroll" "$OUT/$prefix-1-partition.png" 28
  shoot "$udid" "library.html" "$OUT/$prefix-2-bibliotheque.png" 22
  if [ "$prefix" = iphone ]; then
    # Skipped on iPad: the whole year fits without scrolling there, leaving
    # most of a 2752px-tall screen empty.
    shoot "$udid" "practice.html" "$OUT/$prefix-3-assiduite.png" 22
    shoot "$udid" "$SCORE&demoplay=10&democlick=Historique" "$OUT/$prefix-4-historique.png" 30
  else
    shoot "$udid" "$SCORE&demoplay=14&democlick=Historique" "$OUT/$prefix-3-historique.png" 30
  fi
  xcrun simctl shutdown "$udid" 2> /dev/null || true

  for shot in "$OUT/$prefix-"*.png; do
    local got
    got="$(sips -g pixelWidth -g pixelHeight "$shot" | awk '/pixel/{printf "%s ", $2}' | xargs)"
    [ "$got" = "$expected" ] || die "$(basename "$shot") is ${got} — the listing needs ${expected}"
  done
}

mkdir -p "$OUT"
rm -f "$OUT"/*.png
echo "Capturing into $OUT"
capture_device "$IPHONE_NAME" iphone "$IPHONE_SIZE" 185
capture_device "$IPAD_NAME" ipad "$IPAD_SIZE" 0

# --- Apple rejects screenshots with an alpha channel --------------------------
python3 - "$OUT" <<'PY'
import pathlib, sys
from PIL import Image

for path in sorted(pathlib.Path(sys.argv[1]).glob('*.png')):
    image = Image.open(path)
    if image.mode != 'RGBA':
        continue
    flat = Image.new('RGB', image.size, (255, 255, 255))
    flat.paste(image, mask=image.split()[3])
    flat.save(path, 'PNG')
    print(f'  flattened {path.name}')
PY

echo
echo "Done. Look at every one of them before uploading — this script checks the"
echo "pixel sizes, not whether the app rendered something sensible."
ls -1 "$OUT"
