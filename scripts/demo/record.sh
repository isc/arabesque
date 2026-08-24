#!/bin/bash
# Record the App Review walkthrough from a simulator.
#
#   scripts/demo/record.sh [output.mp4] [iphone|ipad]
#
# App Review has no MIDI keyboard, so it cannot exercise what this app is for.
# Guideline 2.1 asks for a demonstration video in exactly that case; this makes
# one. See scripts/demo/README.md for what the video shows and how to describe
# it honestly in the review notes.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$REPO/tmp/arabesque-review-demo.mp4}"
DEVICE="${2:-ipad}"
PORT=45801

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

die() { echo "error: $*" >&2; exit 1; }

case "$DEVICE" in
  ipad) SIM_NAME="iPad Pro 13-inch (M5)" ;;
  iphone) SIM_NAME="iPhone 17 Pro Max" ;;
  *) die "device must be iphone or ipad" ;;
esac

# The ceiling play.js puts on how long its walkthrough may take.
RECORD_SECONDS="$(grep -oE 'TOUR_TIMEOUT_SECONDS = [0-9]+' "$REPO/scripts/demo/play.js" | grep -oE '[0-9]+')"
[ -n "$RECORD_SECONDS" ] || die "could not read TOUR_TIMEOUT_SECONDS from scripts/demo/play.js"

[ -d "$DEVELOPER_DIR" ] || die "no Xcode at $DEVELOPER_DIR (set DEVELOPER_DIR)"
command -v xcodegen > /dev/null || die "xcodegen missing — brew install xcodegen"

SITE="$(mktemp -d)"
SERVER_PID=""
RECORDER_PID=""
cleanup() {
  if [ -n "$RECORDER_PID" ]; then kill -INT "$RECORDER_PID" 2> /dev/null || true; fi
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2> /dev/null || true; fi
  rm -rf "$SITE"
}
trap cleanup EXIT

cp -R "$REPO/public/." "$SITE/"
cp "$REPO/scripts/demo/seed.js" "$REPO/scripts/demo/play.js" "$SITE/"
python3 - "$SITE/score.html" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
html = path.read_text()
if '</head>' not in html:
    sys.exit('error: no </head> in public/score.html')
path.write_text(html.replace(
    '</head>',
    '    <script type="module" src="seed.js"></script>\n'
    '    <script type="module" src="play.js"></script>\n  </head>', 1))
PY
python3 - "$SITE/js/midi.js" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
old = "state.midiInput = { name: 'Mock MIDI Keyboard' }"
if source.count(old) != 1:
    sys.exit("error: midi.js no longer sets the mock device name where record.sh expects it.")
path.write_text(source.replace(old, "state.midiInput = { name: 'Roland FP-30' }"))
PY

# exec, so $! is the server's own pid: without it the subshell is what
# gets killed at exit and python keeps the port, which the next run then
# mistakes for its own server.
( cd "$SITE" && exec python3 -m http.server "$PORT" > /dev/null 2>&1 ) &
SERVER_PID=$!
disown "$SERVER_PID" 2> /dev/null || true
sleep 2
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/score.html" || die "demo server did not come up on $PORT"

( cd "$REPO/ios" && xcodegen generate > /dev/null )
( cd "$REPO/ios" && xcodebuild -project Arabesque.xcodeproj -target Arabesque \
    -sdk iphonesimulator -configuration Debug build \
    CODE_SIGNING_ALLOWED=NO SYMROOT="$REPO/ios/build" > /dev/null ) || die "the app did not build"
APP="$REPO/ios/build/Debug-iphonesimulator/Arabesque.app"

UDID="$(xcrun simctl list devices available --json |
  python3 -c "import json,sys; print(next((d['udid'] for r in json.load(sys.stdin)['devices'].values() for d in r if d['name'] == sys.argv[1]), ''))" "$SIM_NAME")"
[ -n "$UDID" ] || die "no simulator named '$SIM_NAME'"

TOUR="score.html?url=scores/Arabesque_L._66_No._1_in_E_Major.mxl&demotour=1"
plutil -replace PTWebAppURL -string "http://127.0.0.1:$PORT/$TOUR" "$APP/Info.plist"

xcrun simctl boot "$UDID" 2> /dev/null || true
xcrun simctl bootstatus "$UDID" -b > /dev/null
xcrun simctl terminate "$UDID" app.arabesque.Arabesque 2> /dev/null || true
xcrun simctl install "$UDID" "$APP"

# One throwaway launch so the seeding and its two reloads are already done: the
# recording should open on the score, not on a blank page settling down.
xcrun simctl launch "$UDID" app.arabesque.Arabesque > /dev/null
sleep 22
xcrun simctl terminate "$UDID" app.arabesque.Arabesque > /dev/null 2>&1 || true

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
# Launch first and start recording a moment later, or the video opens on the
# springboard. The walkthrough waits for the score to render and then some, so
# the recorder is always running well before anything happens on screen.
echo "Recording up to ${RECORD_SECONDS}s on ${SIM_NAME}…"
xcrun simctl launch "$UDID" app.arabesque.Arabesque > /dev/null
sleep 3
xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT" &
RECORDER_PID=$!
sleep "$RECORD_SECONDS"

kill -INT "$RECORDER_PID" 2> /dev/null || true
wait "$RECORDER_PID" 2> /dev/null || true
RECORDER_PID=""
xcrun simctl shutdown "$UDID" 2> /dev/null || true

[ -s "$OUT" ] || die "no video was written to $OUT"
echo
echo "$OUT"
echo "  $(du -h "$OUT" | cut -f1) · ${SIM_NAME}"
echo
echo "Watch it before sending it to App Review, and describe it in the review"
echo "notes for what it is — see scripts/demo/README.md."
