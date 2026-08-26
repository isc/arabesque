#!/usr/bin/env node
// scripts/stamp-version.mjs
//
// Writes one version stamp into both places that must agree at runtime: the
// APP_VERSION constant in public/js/version.js and the <meta name="app-version">
// of every page. They are cached independently by the browser, so this is what
// lets a page tell whether its HTML and its scripts came from the same deploy —
// see the note in public/js/version.js.
//
// Run by the Pages deploy on the checked-out copy, never committed back:
//   node scripts/stamp-version.mjs <version>
//
// Fails loudly when a file is missing its marker, so a new page cannot ship
// unstamped and silently opt out of the check.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const version = process.argv[2]
if (!version || !/^[\w.-]+$/.test(version)) {
  console.error('usage: node scripts/stamp-version.mjs <version>   (letters, digits, . _ -)')
  process.exit(1)
}

function replaceOnce(file, pattern, replacement) {
  const before = readFileSync(file, 'utf8')
  const count = (before.match(new RegExp(pattern.source, pattern.flags + 'g')) ?? []).length
  if (count !== 1) {
    console.error(`${file}: expected exactly one ${pattern}, found ${count}`)
    process.exit(1)
  }
  writeFileSync(file, before.replace(pattern, replacement))
}

replaceOnce(
  join(PUBLIC_DIR, 'js', 'version.js'),
  /^export const APP_VERSION = '[^']*'$/m,
  `export const APP_VERSION = '${version}'`,
)

// A page needs both halves: the stamp to compare against, and the module that
// compares it. Stamping one without the other would ship a page that cannot
// notice it is stale.
const VERSION_SCRIPT = '<script type="module" src="js/version.js"></script>'
const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))
for (const page of pages) {
  const path = join(PUBLIC_DIR, page)
  replaceOnce(path, /<meta name="app-version" content="[^"]*" \/>/, `<meta name="app-version" content="${version}" />`)
  if (!readFileSync(path, 'utf8').includes(VERSION_SCRIPT)) {
    console.error(`${path}: missing ${VERSION_SCRIPT}`)
    process.exit(1)
  }
}

console.log(`Stamped ${version} into js/version.js and ${pages.length} pages.`)
