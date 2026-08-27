# Arabesque — iOS wrapper

Safari/iOS does not support the Web MIDI API, which makes the web app unusable
on iPad/iPhone — even though an iPad on the music stand is the ideal device.
This directory contains a minimal native wrapper that bridges the gap:

- a full-screen **WKWebView** loads the deployed web app, unchanged;
- **CoreMIDI** collects MIDI on the native side (USB and Bluetooth devices);
- an injected script (`Arabesque/Resources/webmidi-shim.js`) emulates
  `navigator.requestMIDIAccess` so `public/js/midi.js` works as-is;
- a second one (`wakelock-shim.js`) does the same for `navigator.wakeLock`,
  which WebKit grants in Safari proper only, so the screen stays on with a
  score up — and the library still falls asleep (see below);
- a small overlay button opens the system **Bluetooth MIDI pairing** sheet
  (`CABTMIDICentralViewController`), needed because BLE MIDI devices are paired
  per-app, not in iOS Settings.

Everything on screen comes from the network, so a failed load has nowhere to
fall back to: `ViewController` covers the webview with a **retry screen**
instead of leaving the blank white page an offline launch used to land on. It
also reloads by itself when the app returns to the foreground while that screen
is up — coming back is usually the moment the connection has just been fixed.
The five native strings pick French or English from `Locale.preferredLanguages`
(the `Strings` enum), the way the web app reads `navigator.language`.

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

## Keeping the screen on

Playing a score means minutes without touching the glass, which is exactly what
the idle timer is watching for; the web app already asks for a screen wake lock
for that, but WebKit refuses it in a `WKWebView` (webkit.org/b/254545) and the
refusal is silent, so the iPad fell asleep mid-piece.

`wakelock-shim.js` therefore replaces `navigator.wakeLock` with one that posts
`{held: true|false}` through `webkit.messageHandlers.wakeLock`, and
`ViewController` follows it with `isIdleTimerDisabled`. Disabling the idle timer
outright would be simpler, but then a library left open would never sleep
either. A lock dies with the document that took it and the outgoing page gets no
chance to say so, which is why `didCommit` resets the flag on every navigation;
the new page asks again if it needs one. Covered by
`test/js/wakeLockShim.test.js`.

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
enabled — and add that host to `WKAppBoundDomains` (see below), otherwise the
webview refuses to navigate to it.

## App-bound domains

`project.yml` declares `WKAppBoundDomains: [arabesque.app]` and
`ViewController` sets `limitsNavigationsToAppBoundDomains = true`. This is the
opt-in that lets the webview run **service workers**, which is the only way the
web app can work without a network — an iPad on a music stand.

It is a trade, not a switch. Declaring the key puts every `WKWebView` in the app
into a restricted mode: injected scripts, style sheets, cookie manipulation and
message handlers are all denied, and only the `limitsNavigationsToAppBoundDomains`
flag gives them back — for the listed domains alone. Both halves matter here,
because both bridges *are* injected scripts (`webmidi-shim.js`,
`wakelock-shim.js`) plus message handlers (`midiBridge`, `wakeLock`): with the
key declared and the flag missing, the app would launch, show the web app, and
quietly accept no MIDI at all.

Consequences worth knowing:

- Up to 10 domains. A `PTWebAppURL` pointing outside the list fails to load
  with "App-bound domain failure" — visible, at least, since the load-failure
  screen catches it.
- Only top-level navigation is checked. The app's own `fetch` calls (Supabase
  sync, feedback, scores) are subresource requests and are not affected.
- Off-site links were already handed to Safari by `decidePolicyFor`
  (`ViewController.swift`), so nothing there changes.

Apple's own [App-Bound Domains post](https://webkit.org/blog/10882/app-bound-domains/)
documents the restrictions but says nothing about service workers; that link
comes from wrapper projects that hit it (e.g.
[Capacitor #4122](https://github.com/ionic-team/capacitor/issues/4122)). Which
is why the first thing to check on a build carrying this change is that a MIDI
keyboard still plays — before a line of service worker is written.

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
   `Arabesque`, bundle ID `app.arabesque.Arabesque`. C'est la seule
   vérification de disponibilité du **nom** qui fasse foi (voir `NAMING.md`).
   L'API App Store Connect ne sait pas créer une fiche d'app — elle répond
   `The resource 'apps' does not allow 'CREATE'` — donc cette étape reste
   manuelle. Le bundle ID, lui, est déjà enregistré.
3. **Signer** : rien à faire, l'équipe `HGPUW9Q6BQ` est figée dans `project.yml`.
4. **Incrémenter `CURRENT_PROJECT_VERSION`** dans `project.yml` : App Store
   Connect refuse deux envois avec le même numéro de build.
5. **Archiver** : destination *Any iOS Device*, puis *Product → Archive*, puis
   *Distribute App → TestFlight & App Store*.

Ce qui n'est **pas** fait : l'envoi automatisé depuis la CI. Il suppose une clé
d'API App Store Connect et un certificat de distribution importés dans le
trousseau du runner — un chantier à part, qui ne vaut le coup qu'une fois les
envois devenus fréquents. Pour les premiers builds, l'archive depuis Xcode est
plus courte.

### Envoi automatisé (workflow `TestFlight`)

Le workflow `.github/workflows/testflight.yml` archive, signe, exporte et
envoie sur TestFlight. Il se déclenche **à la main** (*Actions → TestFlight →
Run workflow*) : un envoi consomme un numéro de build et lance un cycle de
traitement chez Apple, ça se décide.

La signature n'a besoin d'aucun `.p12` : `-allowProvisioningUpdates` avec une
clé d'API App Store Connect laisse `xcodebuild` créer certificat et profil à la
demande. En revanche l'export et l'envoi sont deux commandes, la clé n'étant
pas honorée pour la destination `upload` de l'export.

**Créer la clé d'API** : App Store Connect → *Users and Access* → *Integrations*
→ *App Store Connect API* → *Team Keys* → générer une clé de rôle **Admin**.
*App Manager* ne suffit pas : il permet de créer un certificat via l'API, mais
pas d'utiliser la **signature cloud** d'`xcodebuild`, qui échoue alors sur
`Cloud signing permission error` au moment de l'export. Le fichier `.p8` ne se
télécharge **qu'une fois** — le perdre oblige à révoquer et recommencer. Noter
au passage le *Key ID* et l'*Issuer ID*.

**Renseigner trois secrets** dans *Settings → Secrets and variables → Actions* :

| Secret | Valeur |
|---|---|
| `APPSTORE_KEY_ID` | le *Key ID* de la clé |
| `APPSTORE_ISSUER_ID` | l'*Issuer ID*, commun à toute l'équipe |
| `APPSTORE_PRIVATE_KEY` | le contenu du `.p8`, lignes `BEGIN`/`END` comprises |

Le Team ID (`HGPUW9Q6BQ`) est écrit en clair dans `project.yml` et
`ExportOptions.plist` : ce n'est pas un secret, il se lit dans le bundle de
n'importe quelle app distribuée. Le committer évite en prime que
`xcodegen generate` efface l'équipe choisie dans Xcode à chaque régénération.

Le numéro de build vient de `github.run_number`, donc il est unique sans état à
maintenir. La version affichée aux testeurs se passe en paramètre du workflow,
ou reste celle de `project.yml`.

Le job tourne sur **`macos-26`** : Apple refuse tout envoi construit avec un SDK
antérieur à iOS 26, et `macos-15` s'arrête à Xcode 16.4 / SDK 18.5. Le message
d'erreur est explicite (`This app was built with the iOS 18.5 SDK`) mais
n'arrive qu'à la toute fin, après l'archive et l'export.

⚠️ La signature à la volée crée un **certificat de distribution**, et Apple en
limite le nombre à trois par compte — les révoquer depuis le portail si le quota
est atteint.

**Éprouvé le 2026-08-11**, au troisième essai : le build 3 est passé en `VALID`
et s'installe. Les deux échecs précédents sont désormais couverts par la
configuration (rôle Admin de la clé, runner `macos-26`), donc ils ne devraient
pas se reproduire.

### Un build TestFlight expire au bout de 90 jours

À l'échéance, l'app **cesse de s'ouvrir** chez les testeurs qui l'ont installée
— elle n'est pas seulement retirée du catalogue — et les données locales
partent avec, donc l'historique de pratique stocké dans l'IndexedDB de la
WebView. L'expiration ne se prolonge pas.

Le remède est un nouvel envoi : *Actions → TestFlight → Run workflow*, sans
rien modifier, le numéro de build s'incrémentant via `github.run_number`. À
faire au moins une fois par trimestre tant que l'app n'est pas publiée sur
l'App Store — une version publiée, elle, n'expire pas.
