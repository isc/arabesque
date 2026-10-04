import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import fr from '../../public/js/locales/fr.js'
import en from '../../public/js/locales/en.js'
import { htmlPages } from '../../scripts/stamp-version.mjs'

// The two catalogs hold the same keys. Nothing else would say so when they
// drift: t() falls back to the other language, then to the key itself, so a
// French player is simply shown English — or "score.something".
const flatten = (tree, prefix = '') =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`))
const FR = new Map(flatten(fr))
const EN = new Map(flatten(en))
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join()

describe('the locale catalogs', () => {
  it('hold the same keys', () => {
    expect([...FR.keys()].sort()).toEqual([...EN.keys()].sort())
  })

  // A placeholder one language leaves out drops the value there, and a
  // misspelt one is printed as it stands.
  it('give a string the same placeholders in both languages', () => {
    const mismatched = [...FR.keys()].filter((key) => EN.has(key) && placeholders(FR.get(key)) !== placeholders(EN.get(key)))
    expect(mismatched).toEqual([])
  })
})

// The pages carry their French in the markup too: what a reader without
// JavaScript gets — the privacy page, for one — and what paints until i18n
// writes the catalog's text over it. Nothing else holds the two copies
// together: editing the page changes nothing on screen, and editing fr.js
// leaves the page behind.
const PUBLIC = join(import.meta.dirname, '..', '..', 'public')
const listed = (dir) => readdirSync(dir).map((name) => join(dir, name))
const SOURCES = [
  ...htmlPages().map((page) => join(PUBLIC, page)),
  // The markup some modules build: the ⚙️ menu, the journal, the tempo field.
  ...listed(join(PUBLIC, 'js')).filter((path) => path.endsWith('.js')),
]

// Each element's key and the text written in its place: content named by
// data-i18n, data-i18n-html or an Alpine $t('key') without parameters, up to
// the element's first closing tag (none nests another of its kind), and each
// attribute a data-i18n-<attribute> names.
function fallbacks(source) {
  const found = []
  const opening = /<([a-z][a-z0-9]*)\b[^>]*\b(?:data-i18n(?:-html)?="([^"]+)"|x-text="\$t\('([^']+)'\)")[^>]*>/g
  for (const match of source.matchAll(opening)) {
    const [tag, name, dataKey, alpineKey] = match
    const start = match.index + tag.length
    found.push({ key: dataKey ?? alpineKey, text: source.slice(start, source.indexOf(`</${name}>`, start)) })
  }
  for (const [tag] of source.matchAll(/<[a-z][^>]*>/g)) {
    for (const [, attribute, key] of tag.matchAll(/\bdata-i18n-(?!html)([a-z-]+)="([^"]+)"/g)) {
      found.push({ key, text: tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))?.[1] ?? '' })
    }
  }
  return found.filter(({ text }) => text.trim())
}

// Whitespace is the markup's own, and an apostrophe is one whichever way it
// curls.
const normalised = (text) => text.replace(/\s+/g, ' ').replace(/’/g, "'").trim()

describe('the French written into the pages', () => {
  it('is the catalog’s', () => {
    const drifted = SOURCES.flatMap((path) =>
      fallbacks(readFileSync(path, 'utf8'))
        .filter(({ key, text }) => normalised(text) !== normalised(FR.get(key) ?? ''))
        .map(({ key, text }) => `${relative(PUBLIC, path)} ${key}: "${normalised(text)}"`))
    expect(drifted).toEqual([])
  })
})
