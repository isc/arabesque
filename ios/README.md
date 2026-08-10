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
and defaults to the production deployment (https://arabesque.app/).
For development against a local server, point it at your Mac
(e.g. `http://<your-mac>.local:4567`) — `NSAllowsLocalNetworking` is already
enabled — and regenerate the project.

## Connecting a keyboard

- **USB**: plug the keyboard into the iPad (camera adapter / USB-C). It is
  picked up automatically, including when plugged in after launch.
- **Bluetooth**: tap the antenna button in the bottom-right corner and pair
  the keyboard from the system sheet. Pairing is remembered by the app.

## Icône

`Arabesque/Assets.xcassets/AppIcon.appiconset/icon-1024.png` est dérivée de
`public/favicon.svg`, avec deux différences imposées par Apple : le fond est à
plein bord (iOS applique lui-même le masque arrondi — garder l'arrondi du
favicon donnerait un double arrondi) et l'image n'a pas de canal alpha. Pour la
regénérer après un changement de favicon :

```bash
rsvg-convert -w 1024 -h 1024 -b '#1095c1' icon.svg -o \
  ios/Arabesque/Assets.xcassets/AppIcon.appiconset/icon-1024.png
```

où `icon.svg` est le favicon dont on a retiré le `rx` du rectangle de fond.

## Publier sur TestFlight

Prérequis : l'**Apple Developer Program** (99 €/an). Aucune voie gratuite n'y
mène — la signature personnelle d'Xcode expire au bout de 7 jours et n'installe
que sur ses propres appareils.

1. **S'inscrire** sur <https://developer.apple.com/programs/enroll/>, puis
   récupérer le **Team ID** dans *Membership*.
2. **Réserver le nom** dans App Store Connect en créant l'app : nom
   `Arabesque`, bundle ID `com.arabesque.Arabesque`. C'est la seule
   vérification de disponibilité qui fasse foi (voir `NAMING.md`).
3. **Signer** : après `xcodegen generate`, ouvrir le projet et choisir l'équipe
   dans *Signing & Capabilities*. ⚠️ Le projet étant généré, régénérer efface ce
   choix — à refaire, ou à figer plus tard dans le spec quand on aura le Team ID.
4. **Incrémenter `CURRENT_PROJECT_VERSION`** dans `project.yml` : App Store
   Connect refuse deux envois avec le même numéro de build.
5. **Archiver** : destination *Any iOS Device*, puis *Product → Archive*, puis
   *Distribute App → TestFlight & App Store*.

Ce qui n'est **pas** fait : l'envoi automatisé depuis la CI. Il suppose une clé
d'API App Store Connect et un certificat de distribution importés dans le
trousseau du runner — un chantier à part, qui ne vaut le coup qu'une fois les
envois devenus fréquents. Pour les premiers builds, l'archive depuis Xcode est
plus courte.
