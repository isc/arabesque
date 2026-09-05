// Android's "add to home screen", as an offer that waits rather than interrupts.
//
// Chrome decides on its own when a site is installable and then fires
// beforeinstallprompt. Calling preventDefault() on it suppresses Chrome's own
// mini-infobar and hands us the event to fire later — which is the whole point
// here: the offer moves into the ⚙️ menu, where someone finds it when they are
// looking for it, instead of a banner over the library.
//
// The event fires once, and can fire before Alpine has booted, so it is caught
// at import time and held. Availability is published as a window event rather
// than a subscribe function (the shape of onDayChange / onForeground) because
// the only consumer is Alpine markup, which listens with @…​.window and needs no
// unsubscribe: installAvailable() covers the value the menu is built with, and
// the event covers every change after that.
//
// Nothing here needs a guard for iOS or for an app already installed: WebKit
// does not implement beforeinstallprompt, and Chrome does not fire it for an
// app it has already installed. Both simply leave the menu entry hidden.
export const INSTALL_AVAILABLE_EVENT = 'arabesque-install-available'

let prompt = null

function publish(event) {
  prompt = event
  window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT, { detail: Boolean(event) }))
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  publish(event)
})
window.addEventListener('appinstalled', () => publish(null))

export function installAvailable() {
  return prompt !== null
}

// Resolves once the browser has taken over; the outcome is Chrome's to report,
// and there is nothing for the app to do differently either way.
export async function promptInstall() {
  const pending = prompt
  if (!pending) return
  // Single-use: Chrome invalidates the event once prompted, whatever the answer.
  // Someone who dismisses the sheet installs from Chrome's own menu instead, or
  // from ours again once the browser offers a fresh event.
  publish(null)
  try {
    await pending.prompt()
  } catch {
    /* Refused by the browser rather than by the user — nothing to recover. */
  }
}
