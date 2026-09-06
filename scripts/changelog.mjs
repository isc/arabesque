#!/usr/bin/env node
// scripts/changelog.mjs
//
// One changelog entry = one file in `changelog.d/`, so two pull requests
// landing the same day touch two different files instead of the same three
// lines at the top of `public/js/changelog.js` and of `CHANGELOG`. Every
// conflict those two files produced was resolved the same way — keep both —
// which is what git does on its own once each entry has a file of its own.
//
// A fragment is named `YYYY-MM-DD-a-short-slug.md`, the date being the day the
// entry is published (a merge to main deploys straight away, so normally the
// day you write it; `git mv` it if the branch then sits for a while, or the
// entry lands under a date the reader has already been shown). It holds the
// one item, in both languages:
//
//     # fr
//     Le décompte du mode strict se voit. Le bandeau affiche les temps de la
//     mesure de départ, celui en cours en évidence.
//
//     # en
//     The strict-mode count-in can be seen. The band shows the beats of the
//     count-in bar, the one sounding picked out.
//
// Lines inside a section are joined into one paragraph, so wrap where you
// like. Both are required and neither may be empty: one item per file is what
// makes "same count, same order" hold by construction rather than by review,
// and test/js/changelog.test.js parses every fragment in the repository, so a
// missing English half fails the pull request instead of shipping.
//
// A section is also capped at MAX_ITEM_LENGTH. Entries drifted into paragraphs
// justifying the implementation — the modal became unreadable and a player
// said so — and a cap is the only version of "keep it short" that survives
// contact with the next writer. CLAUDE.md has the wording rule; this is what
// makes it fail the pull request.
//
//   node scripts/changelog.mjs build   # → PENDING in public/js/changelog.js
//   node scripts/changelog.mjs fold    # fragments → HISTORY + CHANGELOG
//
// `build` runs in the Pages deploy and in the branch previews, on the checked
// out copy, never committed back — the same arrangement as stamp-version.mjs,
// and for the same reason: a generated snapshot committed to the repo would be
// the conflict all over again. Entries reach production the moment the pull
// request merges, with nobody folding anything. Restore
// public/js/changelog.js from git to undo a local `build`.
//
// `fold` is housekeeping, not a release step: it moves published fragments
// into the two committed files and deletes them, so `changelog.d/` stays short
// and `CHANGELOG` stays the French record it has always been. Nothing breaks
// if it is not run for a month. Folding the whole history the other way — no
// HISTORY, no CHANGELOG, everything a fragment forever — was the alternative;
// it was turned down because the published French of the two files is not
// always the same text, so migrating them would have to invent one, and the
// rule here is that what is already published does not get rewritten.
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mergeChangelog } from '../public/js/changelog.js'
import { replaceOnce } from './replace-once.mjs'

const ROOT = join(import.meta.dirname, '..')
export const FRAGMENT_DIR = join(ROOT, 'changelog.d')
const CHANGELOG_JS = join(ROOT, 'public', 'js', 'changelog.js')
const CHANGELOG_MD = join(ROOT, 'CHANGELOG')

const FRAGMENT_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const HEADING = /^#\s+(\S+)\s*$/
export const LANGS = ['fr', 'en']

// A title sentence plus one or two sentences, in either language. Everything
// the modal has ever needed; anything longer was a commit message in disguise.
export const MAX_ITEM_LENGTH = 320

// The width CHANGELOG has been hand-wrapped at, and the two-space indent its
// continuation lines carry.
const WRAP_WIDTH = 78
const INDENT = '  '

const fail = (name, problem) => {
  throw new Error(`changelog.d/${name}: ${problem}`)
}

// Spaces and tabs only, never \s: French copy is full of U+00A0 (« 94 % »,
// « ⏸ : »), and collapsing those would take away the space the typography
// needs.
const collapse = (text) => text.replace(/[ \t\r\n]+/g, ' ').trim()

// → { date, name, fr, en }. Throws on anything a reader would call malformed,
// naming the file, so a mistake is caught by the test suite rather than by a
// player looking at an English-only changelog.
export function parseFragment(name, text) {
  const named = FRAGMENT_NAME.exec(name)
  if (!named) fail(name, 'name must be YYYY-MM-DD-a-short-slug.md')

  const sections = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      const lang = heading[1]
      if (!LANGS.includes(lang)) fail(name, `unknown section "# ${lang}" (expected # fr and # en)`)
      if (sections.has(lang)) fail(name, `two "# ${lang}" sections`)
      current = lang
      sections.set(lang, [])
    } else if (current) {
      sections.get(current).push(line)
    } else if (line.trim()) {
      fail(name, `text before the first section: "${collapse(line).slice(0, 40)}"`)
    }
  }

  const item = { date: named[1], name }
  for (const lang of LANGS) {
    if (!sections.has(lang)) fail(name, `missing the "# ${lang}" section`)
    const body = collapse(sections.get(lang).join('\n'))
    if (!body) fail(name, `the "# ${lang}" section is empty`)
    if (body.length > MAX_ITEM_LENGTH)
      fail(name, `the "# ${lang}" section is ${body.length} characters, over the ${MAX_ITEM_LENGTH} an entry gets — a title sentence and one or two more, see CLAUDE.md`)
    item[lang] = body
  }
  return item
}

// Every fragment on disk, oldest date first and, within a date, by file name:
// an order that does not depend on the order the files landed in.
export function readFragments(dir = FRAGMENT_DIR) {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => parseFragment(name, readFileSync(join(dir, name), 'utf8')))
}

// Into the shape public/js/changelog.js holds — one entry per date, newest
// first — with the grouping done by the same function the app groups with.
export const groupByDate = (fragments) =>
  mergeChangelog(
    fragments.map(({ date, fr, en }) => ({ date, items: { fr: [fr], en: [en] } })),
    [],
  )

// --- build: the pending entries into the file the app imports ---------------

// One line of JSON, like SHELL in sw.js: it is written on a throwaway checkout
// and read by nobody, and staying on one line keeps the marker matchable
// whether it holds the committed `[]` or a previous build's entries.
export const PENDING_LINE = /^const PENDING = \[.*\]$/m

export function build(fragments) {
  replaceOnce(CHANGELOG_JS, PENDING_LINE, `const PENDING = ${JSON.stringify(groupByDate(fragments))}`)
  const items = fragments.length
  console.log(`Built ${items} pending changelog ${items === 1 ? 'entry' : 'entries'} into public/js/changelog.js.`)
}

// --- fold: the pending entries into the two committed files -----------------

const renderJsEntry = (entry) =>
  [
    '  {',
    `    date: '${entry.date}',`,
    '    items: {',
    ...LANGS.flatMap((lang) => [
      `      ${lang}: [`,
      ...entry.items[lang].map((item) => `        ${JSON.stringify(item)},`),
      '      ],',
    ]),
    '    },',
    '  },',
    '',
  ].join('\n')

// Greedy wrap on plain spaces only — see `collapse` on why not /\s/.
export function wrap(text, width = WRAP_WIDTH, indent = INDENT) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (line && candidate.length > width) {
      lines.push(line)
      line = indent + word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

// CHANGELOG's bullets bold the item's opening sentence, which is the sentence
// the modal shows first. Same French text, written once: the two files used to
// say the same thing in slightly different words only because it was typed
// twice.
export function renderMarkdownItem(item) {
  const split = /^(.+?[.!?…])(\s+)(.+)$/s.exec(item)
  return wrap(split ? `- **${split[1]}** ${split[3]}` : `- **${item}**`)
}

export function foldIntoMarkdown(existing, entries) {
  let out = existing
  // Oldest first, each prepended in turn, so the newest ends up on top.
  for (const entry of [...entries].reverse()) {
    const bullets = entry.items.fr.map(renderMarkdownItem).join('\n\n')
    // A date already at the top gains bullets under its heading rather than a
    // second heading of its own.
    out = out.startsWith(`${entry.date}\n\n`)
      ? out.replace(`${entry.date}\n\n`, `${entry.date}\n\n${bullets}\n\n`)
      : `${entry.date}\n\n${bullets}\n\n${out}`
  }
  return out
}

export function fold(fragments) {
  if (!fragments.length) {
    console.log('Nothing to fold: changelog.d/ is empty.')
    return
  }
  const entries = groupByDate(fragments)

  // Prepended blind: a date this puts into HISTORY twice is merged back into
  // one group by mergeChangelog(), which is what the modal reads.
  replaceOnce(CHANGELOG_JS, /^const HISTORY = \[\n/m, `const HISTORY = [\n${entries.map(renderJsEntry).join('')}`)
  writeFileSync(CHANGELOG_MD, foldIntoMarkdown(readFileSync(CHANGELOG_MD, 'utf8'), entries))
  for (const fragment of fragments) rmSync(join(FRAGMENT_DIR, fragment.name))

  console.log(`Folded ${fragments.length} entries over ${entries.length} dates into CHANGELOG and public/js/changelog.js.`)
}

if (process.argv[1] === import.meta.filename) {
  const command = process.argv[2]
  if (!['build', 'fold'].includes(command)) {
    console.error('usage: node scripts/changelog.mjs build|fold')
    process.exit(1)
  }
  const fragments = readFragments()
  if (command === 'build') build(fragments)
  else fold(fragments)
}
