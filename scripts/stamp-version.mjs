#!/usr/bin/env node
// scripts/stamp-version.mjs
//
// Writes one version stamp into every place that must agree at runtime, and
// generates the service worker's precache list while it is there:
//
//   - APP_VERSION in public/js/version.js and <meta name="app-version"> on each
//     page. They are cached independently by the browser, so this is what lets
//     a page tell whether its HTML and its scripts came from the same deploy —
//     see the note in public/js/version.js.
//   - VERSION and SHELL in public/sw.js: the cache name to keep, and what to
//     precache so the app opens with no network — see public/sw.js.
//
// Run by the Pages deploy on the checked-out copy, never committed back:
//   node scripts/stamp-version.mjs <version>
//
// 'dev' puts a checkout back the way it was. Fails loudly when a file is
// missing its marker, so a new page cannot ship unstamped and silently opt out.
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { replaceOnce } from './replace-once.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

// A page needs both halves: the stamp to compare against, and the module that
// compares it. Stamping one without the other would ship a page that cannot
// notice it is stale.
export const VERSION_SCRIPT = '<script type="module" src="js/version.js"></script>'

// Generated rather than hand-listed: a file added to public/ and left out would
// be the one thing missing offline, and nothing would say so.
//
// Scores stay out — they are cached as they are opened (sw.js) — and so do the
// videos, megabytes nobody needs offline. img/ holds the two hero posters,
// 120KB of JPEG shown only by the landing page, which is the one page that does
// not register the worker — and they front a video that is not cached either.
// Which cache each asset lands in is a separate decision, and it lives in sw.js.
// icons/ holds the PWA install icons, which the browser process fetches for the
// home screen and the splash — never a page, so the worker is never asked for
// them. Cached, they would be 16KB of the shell re-downloaded on every deploy
// and served to nobody. Same argument as img/ above, one step further.
const SHELL_SKIP = new Set(['video', 'scores', 'img', 'icons'])
const SHELL_EXTENSIONS = /\.(html|css|js|json|svg|jpg|png|webmanifest)$/

// The URL the iOS wrapper opens (ios/project.yml) and the one a bookmark keeps:
// the bare origin, which serves index.html but is not that file's name, so the
// walk below cannot produce it. Missing it meant every offline launch in the
// wrapper failed while every asset it needed sat in the cache.
const ENTRY_URLS = ['./']

// Paths relative to sw.js rather than root-absolute: the app is also served
// from a project subpath on GitHub Pages, where /js/... resolves off the base.
export function shellAssets() {
  const files = readdirSync(PUBLIC_DIR, { recursive: true })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => SHELL_EXTENSIONS.test(path) && !SHELL_SKIP.has(path.split('/')[0]))
    // A worker that precached itself would be serving its own predecessor.
    .filter((path) => path !== 'sw.js')
    .sort()
  return [...ENTRY_URLS, ...files]
}

// Every page the app ships: the HTML at the top of public/. Each is stamped
// here, and the tests hold each to the markers a page carries (CLAUDE.md, "New
// HTML pages").
export function htmlPages() {
  return readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))
}

// The line of public/sw.js listing the assets to precache, as a deploy writes
// it. The tests stamp a worker the same way.
export const SW_SHELL = /^const SHELL = \[[^\]]*\]$/m
export const shellLine = (shell) => `const SHELL = ${JSON.stringify(shell)}`

function stamp(version) {
  replaceOnce(
    join(PUBLIC_DIR, 'js', 'version.js'),
    /^export const APP_VERSION = '[^']*'$/m,
    `export const APP_VERSION = '${version}'`,
  )

  const pages = htmlPages()
  for (const page of pages) {
    const path = join(PUBLIC_DIR, page)
    replaceOnce(
      path,
      /<meta name="app-version" content="[^"]*" \/>/,
      `<meta name="app-version" content="${version}" />`,
    )
    if (!readFileSync(path, 'utf8').includes(VERSION_SCRIPT)) {
      console.error(`${path}: missing ${VERSION_SCRIPT}`)
      process.exit(1)
    }
  }

  // Left empty in the repo: a snapshot of public/ committed into sw.js would
  // only go stale, and swRegister.js declines to register an unstamped build.
  const shell = version === 'dev' ? [] : shellAssets()
  const sw = join(PUBLIC_DIR, 'sw.js')
  replaceOnce(sw, /^const VERSION = '[^']*'$/m, `const VERSION = '${version}'`)
  replaceOnce(sw, SW_SHELL, shellLine(shell))

  console.log(`Stamped ${version} into js/version.js, ${pages.length} pages and sw.js (${shell.length} assets).`)
}

if (process.argv[1] === import.meta.filename) {
  const version = process.argv[2]
  if (!version || !/^[\w.-]+$/.test(version)) {
    console.error('usage: node scripts/stamp-version.mjs <version>   (letters, digits, . _ -)')
    process.exit(1)
  }
  stamp(version)
}
