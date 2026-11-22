#!/usr/bin/env node
// scripts/compare-library.mjs
//
// Renders every score in public/scores twice, once from a base revision and
// once from the working tree, and reports which ones look different. It is the
// library check of an OSMD bump (.claude/skills/bump-osmd): a new OSMD moves
// pixels across the whole library, and only a side-by-side shows whether the
// move is a fix or a regression.
//
//   node scripts/compare-library.mjs [--base origin/main] [--out tmp/compare-library]
//                                    [--width 1280] [--jobs 4]
//
// The base's public/ is taken with `git archive`, so it needs no checkout. Both
// trees are served by two static servers on 127.0.0.1 (no-store, so nothing
// one side fetched can answer for the other), and each score goes through
// score.html in Chromium, through the `playwright` package @playwright/cli
// brings in. The page waits for #score[data-render-complete], everything but
// the score is hidden, and #score is screenshotted whole. Rendering is
// deterministic: on the 3.0.0 bump, 145 of the 181 scores came out
// byte-identical.
//
// For a score that differs, the two renders are cut into tiles of --tile
// pixels from the top, and the first tile pair that differs is kept, side by
// side in one image (before on the left): that is where to look. Past it,
// everything below may have shifted, so later tiles say nothing more.
//
// Writes, under --out:
//   report.json   { base, width, scores, identical, changed: [{ file,
//                   baseHeight, headHeight, tileTop, tile }],
//                   onlyIn: { base, head }, errors: { base, head } }
//   report.md     the same, to read
//   tiles/        <score>.png, the first differing tile, before | after
// Page errors on the head side that the base does not have are a regression
// in their own right: the score may not render at all.

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'origin/main' },
    out: { type: 'string', default: 'tmp/compare-library' },
    width: { type: 'string', default: '1280' },
    jobs: { type: 'string', default: '4' },
    tile: { type: 'string', default: '700' },
  },
})
const width = Number(args.width)
const tileHeight = Number(args.tile)
const out = resolve(args.out)
const SCORE = /\.(mxl|musicxml|xml)$/

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'base'), { recursive: true })
mkdirSync(join(out, 'tiles'))
execFileSync('sh', ['-c', `git archive "$1" public | tar -x -C "$2"`, 'sh', args.base, join(out, 'base')])

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
      if (!file.startsWith(root) || !statSync(file).isFile()) throw new Error()
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

const roots = { base: join(out, 'base', 'public'), head: resolve('public') }
const servers = { base: await serve(roots.base), head: await serve(roots.head) }
const listScores = (side) => readdirSync(join(roots[side], 'scores')).filter((f) => SCORE.test(f))
const inBase = new Set(listScores('base'))
const inHead = new Set(listScores('head'))
const files = [...inHead].filter((f) => inBase.has(f)).sort()

const browser = await chromium.launch()
const errors = { base: {}, head: {} }

// Opens one score on one side, rendered and with everything but #score hidden.
async function open(side, file) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
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
    await page.waitForTimeout(150)
    const box = await page.locator('#score').boundingBox()
    const shot = await page.locator('#score').screenshot()
    return { context, page, box, shot, pageErrors }
  } catch (error) {
    pageErrors.push(`not rendered: ${error.message.split('\n')[0]}`)
    return { context, pageErrors }
  } finally {
    if (pageErrors.length) errors[side][file] = pageErrors
  }
}

const tile = (side, top) => side.page.screenshot({
  fullPage: true,
  clip: { x: side.box.x, y: side.box.y + top, width: side.box.width, height: Math.min(tileHeight, side.box.height - top) },
})

// The two tiles side by side, labelled, drawn by the same browser.
async function sideBySide(before, after) {
  const page = await browser.newPage({ viewport: { width: 2 * width + 12, height: 100 } })
  const img = (png, label) => `<figure><figcaption>${label}</figcaption>`
    + `<img src="data:image/png;base64,${png.toString('base64')}"></figure>`
  await page.setContent(`<style>body { margin: 0; display: flex; gap: 12px; background: #888 }
    figure { margin: 0; background: #fff } figcaption { font: bold 20px sans-serif; padding: 6px 10px;
    background: #eee }</style>${img(before, `before (${args.base})`)}${img(after, 'after (working tree)')}`)
  await page.locator('img').evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())))
  const png = await page.screenshot({ fullPage: true })
  await page.close()
  return png
}

const identical = []
const changed = []

async function compare(file) {
  const base = await open('base', file)
  const head = await open('head', file)
  try {
    if (!base.shot || !head.shot) return
    if (base.shot.equals(head.shot)) {
      identical.push(file)
      return
    }
    const entry = { file, baseHeight: Math.round(base.box.height), headHeight: Math.round(head.box.height) }
    const bottom = Math.min(base.box.height, head.box.height)
    for (let top = 0; top < bottom; top += tileHeight) {
      const [a, b] = await Promise.all([tile(base, top), tile(head, top)])
      if (a.equals(b)) continue
      entry.tileTop = top
      entry.tile = `tiles/${file}.png`
      writeFileSync(join(out, entry.tile), await sideBySide(a, b))
      break
    }
    // No tile differs: the shorter render matches the top of the longer one,
    // which only grew (or shrank) at the bottom.
    changed.push(entry)
  } finally {
    await base.context.close()
    await head.context.close()
  }
}

let next = 0
await Promise.all(Array.from({ length: Number(args.jobs) }, async () => {
  while (next < files.length) await compare(files[next++])
}))
await browser.close()
for (const server of Object.values(servers)) server.close()

changed.sort((a, b) => a.file.localeCompare(b.file))
const onlyIn = {
  base: [...inBase].filter((f) => !inHead.has(f)).sort(),
  head: [...inHead].filter((f) => !inBase.has(f)).sort(),
}
const report = { base: args.base, width, scores: files.length, identical: identical.sort(), changed, onlyIn, errors }
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

const newErrors = Object.keys(errors.head).filter((f) => !errors.base[f])
const lines = [
  `# Library comparison: ${args.base} → working tree, at ${width}px`,
  '',
  `${files.length} scores: ${identical.length} identical, ${changed.length} different, `
    + `${newErrors.length} with page errors only on the working tree.`,
  '',
]
if (changed.length) {
  lines.push('## Different', '')
  for (const c of changed) {
    const height = c.headHeight === c.baseHeight ? `${c.baseHeight}px` : `${c.baseHeight} → ${c.headHeight}px`
    const where = c.tileTop === undefined ? 'only the length differs' : `first difference in the tile at ${c.tileTop}px`
    lines.push(`- ${c.file}: ${height}, ${where}`)
  }
  lines.push('')
}
for (const side of ['base', 'head']) {
  const failing = Object.entries(errors[side])
  if (!failing.length) continue
  lines.push(`## Page errors, ${side === 'base' ? args.base : 'working tree'}`, '')
  for (const [file, list] of failing) lines.push(`- ${file}: ${list.join(' · ')}`)
  lines.push('')
}
if (onlyIn.base.length || onlyIn.head.length) {
  lines.push('## Not compared', '')
  for (const f of onlyIn.base) lines.push(`- ${f}: only in ${args.base}`)
  for (const f of onlyIn.head) lines.push(`- ${f}: only in the working tree`)
  lines.push('')
}
writeFileSync(join(out, 'report.md'), lines.join('\n'))
console.log(lines[2])
console.log(`Report: ${join(out, 'report.md')}`)
