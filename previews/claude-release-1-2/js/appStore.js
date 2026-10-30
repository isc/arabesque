// Links to the App Store listing, marked [data-app-store] and shipped hidden.
//
// The iOS app is a WKWebView on this same site, so every page it shows is the
// page a browser shows. Inviting someone to download the app they are already
// using would be silly, hence hidden by default and revealed only outside it —
// a flash of the link inside the app would be worse than a late reveal in a
// browser. The Web MIDI shim the wrapper injects at document start is how a page
// tells (see nativePairingAvailable in midi.js: the user agent cannot).
if (!globalThis.__pianoTrainerMIDI) {
  document.querySelectorAll('[data-app-store]').forEach((el) => {
    el.hidden = false
  })
}
