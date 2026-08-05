// One-time rename of the localStorage keys the app wrote under its former name
// (`pt-lang`, `pt:strictBpm:<url>`, …) to the current `arabesque:` prefix. The
// old code used two separators, `pt-` and `pt:`, for no reason; both land on the
// single one here.
//
// This runs as an import side effect rather than an exported function, and
// `i18n.js` imports it first, because `i18n.js` reads the stored language while
// its module body evaluates — anything called from a page's entry script would
// arrive after that read and lose the setting on the first load.

const LEGACY_PREFIXES = ['pt-', 'pt:']
export const KEY_PREFIX = 'arabesque:'

function migrate() {
  const renames = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    const prefix = LEGACY_PREFIXES.find((p) => key?.startsWith(p))
    if (prefix) renames.push([key, KEY_PREFIX + key.slice(prefix.length)])
  }
  // Collected first: writing while iterating would shift localStorage's indices.
  for (const [from, to] of renames) {
    if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(from))
    localStorage.removeItem(from)
  }
}

try {
  migrate()
} catch {
  /* localStorage unavailable (private mode, disabled cookies): nothing to move */
}
