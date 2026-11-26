#!/usr/bin/env node
// Writes the interface's icons into public/styles.css: one
// `[data-icon="<name>"] { --pt-glyph: url(…) }` rule per icon, between the
// markers of the block that holds them, for the [data-icon]::before rule above
// it to draw.
//
//   node scripts/icons.mjs
//
// The drawings are Lucide's (ISC licence), fetched at the version pinned below
// with `npm pack`: the package weighs 74 MB, too much to install for a handful
// of glyphs that change once in a long while. To add an icon, add a line to
// ICONS — its Lucide name if it differs, `fill` for a solid shape — and run
// this. test/js/icons.test.js holds the list to the names the app uses: one it
// names and the stylesheet does not draw would show as a solid square.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { replaceOnce } from './replace-once.mjs'

const LUCIDE = 'lucide-static@1.80.0'
const STYLES = fileURLToPath(new URL('../public/styles.css', import.meta.url))

// Named for what they say in the app rather than for what Lucide draws.
export const ICONS = {
  check: {},
  circle: {},
  file: { lucide: 'file-music' },
  history: {},
  listen: { lucide: 'headphones' },
  loop: { lucide: 'repeat' },
  metronome: {},
  pause: { fill: true },
  piano: {},
  play: { fill: true },
  search: {},
  settings: {},
  stop: { lucide: 'square', fill: true },
  target: {},
  trophy: {},
  x: {},
}

export const BLOCK = /\/\* icons:start[^*]*\*\/[\s\S]*?\/\* icons:end \*\//

// One Lucide drawing as a data: URI. The stroke colour is irrelevant — the
// icon is a mask, painted in the text's colour — so it is plain black.
function dataUri(svg, fill) {
  const body = svg
    .replace(/<!--.*?-->/gs, '')
    .replace(/\s*class="[^"]*"/, '')
    .replace(/\s*width="24"\s*height="24"/, '')
    .replace('stroke="currentColor"', 'stroke="black"')
    .replace('fill="none"', fill ? 'fill="black"' : 'fill="none"')
    .replace(/\s+/g, ' ')
    .replace(/\s*(\/?>)\s*/g, '$1')
    .replaceAll('"', "'")
    .trim()
  return `url("data:image/svg+xml,${body.replaceAll('<', '%3C').replaceAll('>', '%3E').replaceAll('#', '%23')}")`
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'lucide-'))
  try {
    const names = Object.keys(ICONS).sort()
    const file = (name) => `package/icons/${ICONS[name].lucide ?? name}.svg`
    const tarball = execFileSync('npm', ['pack', LUCIDE, '--silent'], { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('tar', ['-xzf', tarball, ...new Set(names.map(file))], { cwd: dir })
    const rules = names.map(
      (name) => `[data-icon="${name}"] { --pt-glyph: ${dataUri(readFileSync(join(dir, file(name)), 'utf8'), ICONS[name].fill)}; }`
    )
    replaceOnce(STYLES, BLOCK, ['/* icons:start — written by scripts/icons.mjs */', ...rules, '/* icons:end */'].join('\n'))
    console.log(`${names.length} icons written to public/styles.css`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
