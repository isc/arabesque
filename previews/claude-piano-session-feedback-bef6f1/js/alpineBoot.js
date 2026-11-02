// How every app page boots Alpine. In order:
// - the markup the page builds from modules goes in — the ⚙️ menu
//   (headerMenu.js), which every app page carries, then the page's own
//   (journalEntries.js, bpmField.js) — for Alpine to find its bindings and
//   for the static chrome to be translated with the rest;
// - the static chrome is translated and the FR/EN switch wired (initI18n), and
//   `$t`/`$tn` are registered for the templates, on alpine:init so they exist
//   before Alpine evaluates any expression;
// - the root components go on window, and only then is Alpine loaded — from
//   here, rather than from a sibling `defer` script, so that they exist before
//   Alpine evaluates `x-data`, however slow the page's import graph is to
//   resolve. Otherwise Alpine can win the race and every expression throws
//   "<name> is not defined".
import { initI18n, t, tn } from './i18n.js'
import { mountHeaderMenu } from './headerMenu.js'

const ALPINE = 'vendor/alpinejs.3.14.9.min.js'

export function startAlpine(components, mounts = []) {
  for (const mount of [mountHeaderMenu, ...mounts]) mount()
  initI18n()
  document.addEventListener('alpine:init', () => {
    window.Alpine.magic('t', () => (key, params) => t(key, params))
    window.Alpine.magic('tn', () => (key, n, params) => tn(key, n, params))
  })
  Object.assign(window, components)
  const alpine = document.createElement('script')
  alpine.src = ALPINE
  document.head.appendChild(alpine)
}
