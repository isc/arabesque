#!/usr/bin/env node
// scripts/preload-modules.mjs
//
// Lists, in the <head> of every page, each module its scripts import, so the
// browser asks for all of them at once instead of finding them a level at a
// time.
//
// The app ships its modules unbundled, and a module's imports are only known
// once it has arrived: library.html reached its last one four round trips
// after the HTML, and Alpine, which alpineBoot.js asks for once the whole graph
// has run, a fifth. On a fast line nobody notices. On a train's 1 Mbit/s and
// 400ms, it was three of the five and a half seconds before the library listed
// anything, against 1.4s of actual transfer; the score page's modules, queued
// behind OpenSheetMusicDisplay, only started their own waterfall once it had
// arrived. A <link rel="modulepreload"> per module makes it one wave.
//
// Static, relative imports only: an import() is lazy on purpose (the Supabase
// client, Tone) and must stay out, and esm.sh is somebody else's origin.
// Alpine goes in for every page that boots it, being the next thing such a page
// asks for.
//
// The block goes in ahead of js/errorLog.js, which every page loads first
// (test/js/errorLog.test.js): early in the head, and after score.html's import
// map, which a module fetch started before it would leave unread.
//
// Run by the deploy on the checked-out copy, never committed back, like the
// version stamp (scripts/build-site.sh); a checkout goes without, which costs
// nothing on a local server. Running it twice gives the same pages.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { htmlPages } from './stamp-version.mjs'
import { replacedOnce } from './replace-once.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

// `import … from '…'`, `export … from '…'` and a bare `import '…'`, each at the
// start of a line, which is where the codebase writes them and what keeps one
// quoted in a comment out. The lazy run spans the lines of a long import list.
const STATIC_IMPORT = /^\s*(?:import|export)\s(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/gm
const MODULE_SRC = /<script type="module" src="([^"]+)"><\/script>/g
const INLINE_MODULE = /<script type="module">([\s\S]*?)<\/script>/g

const ANCHOR = /^( *)<script type="module" src="js\/errorLog\.js"><\/script>$/m
const BLOCK = /^ *<!-- preloads: [\s\S]*?<!-- \/preloads -->\n/m

const ALPINE_BOOT = 'js/alpineBoot.js'
const ALPINE_SRC = /^const ALPINE = '([^']+)'$/m

// Paths relative to public/, which is also what a page's own references are.
const BASE = 'https://page.invalid/'
const resolveFrom = (spec, from) => new URL(spec, BASE + from).pathname.slice(1)
const read = (path) => readFileSync(join(PUBLIC_DIR, path), 'utf8')

const importsOf = (source) =>
  [...source.matchAll(STATIC_IMPORT)].map((m) => m[1]).filter((spec) => spec.startsWith('.'))

// Every module the page's scripts import, breadth first, which is the order the
// browser would come across them in. A file that is not there throws: the page
// would fail to load it anyway, and the deploy should stop rather than ship it.
export function moduleGraph(html) {
  const queue = [
    ...[...html.matchAll(MODULE_SRC)].map((m) => m[1]),
    ...[...html.matchAll(INLINE_MODULE)].flatMap((m) => importsOf(m[1]).map((spec) => resolveFrom(spec, ''))),
  ]
  const seen = new Set()
  while (queue.length) {
    const path = queue.shift()
    if (seen.has(path)) continue
    seen.add(path)
    queue.push(...importsOf(read(path)).map((spec) => resolveFrom(spec, path)))
  }
  return [...seen]
}

export function withPreloads(html, where) {
  const bare = html.replace(BLOCK, '')
  const [anchor, indent] = bare.match(ANCHOR) ?? []
  const modules = moduleGraph(bare)
  const links = modules.map((path) => `<link rel="modulepreload" href="${path}" />`)
  if (modules.includes(ALPINE_BOOT)) {
    links.push(`<link rel="preload" as="script" href="${read(ALPINE_BOOT).match(ALPINE_SRC)[1]}" />`)
  }
  const block = [`<!-- preloads: written at deploy by scripts/preload-modules.mjs -->`, ...links, '<!-- /preloads -->']
  return replacedOnce(bare, ANCHOR, block.map((line) => indent + line + '\n').join('') + anchor, where)
}

if (process.argv[1] === import.meta.filename) {
  const pages = htmlPages()
  for (const page of pages) {
    const path = join(PUBLIC_DIR, page)
    try {
      writeFileSync(path, withPreloads(readFileSync(path, 'utf8'), path))
    } catch (error) {
      console.error(error.message)
      process.exit(1)
    }
  }
  console.log(`Listed the module preloads of ${pages.length} pages.`)
}
