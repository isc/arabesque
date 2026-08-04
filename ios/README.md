# Arabesque — iOS wrapper

Safari/iOS does not support the Web MIDI API, which makes the web app unusable
on iPad/iPhone — even though an iPad on the music stand is the ideal device.
This directory contains a minimal native wrapper that bridges the gap:

- a full-screen **WKWebView** loads the deployed web app, unchanged;
- **CoreMIDI** collects MIDI on the native side (USB and Bluetooth devices);
- an injected script (`Arabesque/Resources/webmidi-shim.js`) emulates
  `navigator.requestMIDIAccess` so `public/js/midi.js` works as-is;
- a small overlay button opens the system **Bluetooth MIDI pairing** sheet
  (`CABTMIDICentralViewController`), needed because BLE MIDI devices are paired
  per-app, not in iOS Settings.

## How the bridge works

```
MIDI device ──CoreMIDI──▶ MIDIBridge.swift ──evaluateJavaScript──▶ webmidi-shim.js ──▶ midi.js (unchanged)
                                            ◀──messageHandlers────  output.send()
```

- Native → JS: `window.__pianoTrainerMIDI.setPorts([...])` pushes the current
  device list (also on hot-plug, which feeds the app's auto-reconnect), and
  `window.__pianoTrainerMIDI.receiveMIDI(id, bytes)` delivers incoming
  messages to the right input port.
- JS → native: `webkit.messageHandlers.midiBridge` carries `{type: 'ready'}`
  (asks for the port list) and `{type: 'send', id, data}` (MIDI output, used
  by playback).

The shim keeps port object identity stable across updates because `midi.js`
compares ports with `===` in its `onstatechange` auto-reconnect logic. Its
logic is covered by `test/js/webmidiShim.test.js` at the repo root.

## Building

Requires a Mac with Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`). The Xcode project is generated, not committed:

```bash
cd ios
xcodegen generate
open Arabesque.xcodeproj
```

Then select your signing team in *Signing & Capabilities* and run on a device
(the simulator has no CoreMIDI devices; USB/Bluetooth MIDI requires real
hardware).

## Configuration

The web app URL lives in the `PTWebAppURL` Info.plist key (see `project.yml`),
and defaults to the production deployment (https://isc.github.io/piano-trainer/).
For development against a local server, point it at your Mac
(e.g. `http://<your-mac>.local:4567`) — `NSAllowsLocalNetworking` is already
enabled — and regenerate the project.

## Connecting a keyboard

- **USB**: plug the keyboard into the iPad (camera adapter / USB-C). It is
  picked up automatically, including when plugged in after launch.
- **Bluetooth**: tap the antenna button in the bottom-right corner and pair
  the keyboard from the system sheet. Pairing is remembered by the app.
