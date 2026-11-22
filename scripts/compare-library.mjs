#!/usr/bin/env node
// scripts/compare-library.mjs
//
// Renders every score in public/scores twice, once from a base revision and
// once from the working tree, and reports which ones look different. It is the
// library check of an OSMD bump (.claude/skills/bump-osmd): a new OSMD moves
// pixels across the whole library, and only a side-by-side shows whether the
// move is a fix or a regression.
//
//   node scripts/compare-library.mjs [--base <rev>]
//
// The base defaults to where the branch left origin/main (git merge-base), so
// main's own later changes don't mix in. Its public/ is taken with
// `git archive`, so it needs no checkout. Both trees are served by two static
// servers on 127.0.0.1 (no-store, so nothing one side fetched can answer for
// the other), and each score goes through score.html in Chromium, through the
// `playwright` package @playwright/cli brings in. The page waits for
// #score[data-render-complete], everything but the score is hidden, and #score
// is screenshotted whole. Rendering is deterministic: on the 3.0.0 bump, 145
// of the 181 scores came out byte-identical. About 1m30 on charras.
//
// For a score that differs, the two renders are cut into tiles from the top,
// and the tile pairs that differ are kept, side by side in one image (before
// on the left): that is where to look. When the score's height changed, only
// the first one: below it everything may have shifted, so later tiles say
// nothing more, and the report says the rest is unchecked. When it did not,
// nothing moved vertically, and every differing tile is kept, up to MAX_TILES.
// On the 3.0.0 bump that is what showed a lost slur in Mariage d'amour, bar
// 35, under a first tile that already differed at bar 31.
//
// Writes tmp/compare-library/report.md (each differing score with its image
// lines, ready for a pull request description) and tiles/<score>-<top>.png.
// Page errors on the working tree that the base does not have are a
// regression in their own right: the score may not render at all.

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const OUT = resolve('tmp/compare-library')
const WIDTH = 1280
const TILE = 700
const MAX_TILES = 6
// Measured on charras (6 P-cores and 4 E-cores): 4 jobs took 115s, 8 took 83s;
// past that, the browsers contend.
const JOBS = 8
const SCORE = /\.(mxl|musicxml|xml)$/

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const { values: args } = parseArgs({ options: { base: { type: 'string' } } })
const base = args.base || git('merge-base', 'HEAD', 'origin/main')
const baseLabel = base.length > 12 ? base.slice(0, 8) : base

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'base'), { recursive: true })
mkdirSync(join(OUT, 'tiles'))
execFileSync('sh', ['-c', `git archive "$1" public | tar -x -C "$2"`, 'sh', base, join(OUT, 'base')])

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml',
  '.musicxml': 'application/xml', '.webmanifest': 'application/manifest+json',
}

function serve(root) {
  const server = createServer((request, response) => {
    let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
    if (path.endsWith('/')) path += 'index.html'
    const file = join(root, path)
    try {
      if (!statSync(file).isFile()) throw new Error()
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(readFileSync(file))
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

const roots = { base: join(OUT, 'base', 'public'), head: resolve('public') }
const servers = { base: await serve(roots.base), head: await serve(roots.head) }
const listScores = (side) => new Set(readdirSync(join(roots[side], 'scores')).filter((f) => SCORE.test(f)))
const inBase = listScores('base')
const inHead = listScores('head')
const files = [...inHead].filter((f) => inBase.has(f)).sort()

const browser = await chromium.launch()
const errors = { base: {}, head: {} }

// Opens one score on one side, rendered and with everything but #score hidden.
async function open(side, file) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, serviceWorkers: 'block' })
  // The one CDN the app reaches at runtime (supabase-js, the sampled piano),
  // blocked as test/test_helper.rb does: neither draws anything on the score.
  await context.route('https://esm.sh/**', (route) => route.abort())
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error).split('\n')[0]))
  const { port } = servers[side].address()
  try {
    await page.goto(`http://127.0.0.1:${port}/score.html?url=scores/${encodeURIComponent(file)}`)
    await page.waitForSelector('#score[data-render-complete]', { timeout: 60_000 })
    await page.addStyleTag({
      content: 'body * { visibility: hidden !important } #score, #score * { visibility: visible !important }'
        + ' #score img { visibility: hidden !important }',
    })
    const box = await page.locator('#score').boundingBox()
    return { context, page, box, shot: await page.locator('#score').screenshot() }
  } catch (error) {
    pageErrors.push(`not rendered: ${error.message.split('\n')[0]}`)
    return { context }
  } finally {
    if (pageErrors.length) errors[side][file] = pageErrors
  }
}

const tile = (side, top) => side.page.screenshot({
  fullPage: true,
  clip: { x: side.box.x, y: side.box.y + top, width: side.box.width, height: Math.min(TILE, side.box.height - top) },
})

// The two tiles side by side, labelled, drawn by the same browser.
async function sideBySide(before, after) {
  const page = await browser.newPage({ viewport: { width: 2 * WIDTH + 12, height: 100 } })
  const img = (png, label) => `<figure><figcaption>${label}</figcaption>`
    + `<img src="data:image/png;base64,${png.toString('base64')}"></figure>`
  await page.setContent(`<style>body { margin: 0; display: flex; gap: 12px; background: #888 }
    figure { margin: 0; background: #fff } figcaption { font: bold 20px sans-serif; padding: 6px 10px;
    background: #eee }</style>${img(before, `before (${baseLabel})`)}${img(after, 'after (working tree)')}`)
  await page.locator('img').evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())))
  const png = await page.screenshot({ fullPage: true })
  await page.close()
  return png
}

let identical = 0
const changed = []

async function compare(file) {
  const before = await open('base', file)
  const after = await open('head', file)
  try {
    if (!before.shot || !after.shot) return
    if (before.shot.equals(after.shot)) {
      identical++
      return
    }
    const entry = { file, baseHeight: Math.round(before.box.height), headHeight: Math.round(after.box.height), tiles: [] }
    const keep = entry.baseHeight === entry.headHeight ? MAX_TILES : 1
    const bottom = Math.min(before.box.height, after.box.height)
    for (let top = 0; top < bottom && entry.tiles.length < keep; top += TILE) {
      const [a, b] = await Promise.all([tile(before, top), tile(after, top)])
      if (a.equals(b)) continue
      const image = `tiles/${file}-${top}.png`
      writeFileSync(join(OUT, image), await sideBySide(a, b))
      entry.tiles.push({ top, image })
    }
    changed.push(entry)
  } finally {
    await before.context.close()
    await after.context.close()
  }
}

let next = 0
await Promise.all(Array.from({ length: JOBS }, async () => {
  while (next < files.length) await compare(files[next++])
}))
await browser.close()
for (const server of Object.values(servers)) server.close()

const newErrors = Object.keys(errors.head).filter((f) => !errors.base[f])
const lines = [
  `# Library comparison: ${baseLabel} → working tree, at ${WIDTH}px`,
  '',
  `${files.length} scores: ${identical} identical, ${changed.length} different, `
    + `${newErrors.length} with page errors only on the working tree.`,
  '',
]
if (changed.length) lines.push('## Different', '')
for (const c of changed.sort((a, b) => a.file.localeCompare(b.file))) {
  const resized = c.headHeight !== c.baseHeight
  let note = resized ? `${c.baseHeight} → ${c.headHeight}px` : `${c.baseHeight}px`
  if (!c.tiles.length) note += ', only the length differs'
  else if (resized) note += `, so below ${c.tiles[0].top + TILE}px nothing is checked`
  lines.push(`### ${c.file}`, '', `${note}.`, '', ...c.tiles.map((t) => `![${c.file}](${t.image})`), '')
}
for (const [side, label] of [['base', baseLabel], ['head', 'working tree']]) {
  const failing = Object.entries(errors[side])
  if (!failing.length) continue
  lines.push(`## Page errors, ${label}`, '', ...failing.map(([file, list]) => `- ${file}: ${list.join(' · ')}`), '')
}
const notCompared = [
  ...[...inBase].filter((f) => !inHead.has(f)).map((f) => `- ${f}: only in ${baseLabel}`),
  ...[...inHead].filter((f) => !inBase.has(f)).map((f) => `- ${f}: only in the working tree`),
]
if (notCompared.length) lines.push('## Not compared', '', ...notCompared, '')
writeFileSync(join(OUT, 'report.md'), lines.join('\n'))
console.log(lines[2])
console.log(`Report: ${join(OUT, 'report.md')}`)
