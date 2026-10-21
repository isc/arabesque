import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { moduleGraph, withPreloads } from '../../scripts/preload-modules.mjs'
import { htmlPages } from '../../scripts/stamp-version.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const page = (name) => readFileSync(join(PUBLIC_DIR, name), 'utf8')
const preloaded = (html) => [...html.matchAll(/<link rel="(?:module)?preload"(?: as="script")? href="([^"]+)" \/>/g)].map((m) => m[1])

describe('module preloads', () => {
  it('lists the whole graph, the deepest module and Alpine included', () => {
    const hrefs = preloaded(withPreloads(page('library.html')))
    // Four imports down from the page, the last the browser used to find.
    expect(hrefs).toContain('js/noteLog.js')
    expect(hrefs).toContain('js/locales/en.js')
    expect(hrefs.at(-1)).toMatch(/^vendor\/alpinejs\.[\d.]+\.min\.js$/)
  })

  it('leaves out what is imported lazily', () => {
    expect(moduleGraph(page('library.html'))).not.toContain('js/supabaseClient.js')
  })

  it.each(htmlPages())('%s: names only files that exist, after any import map', (name) => {
    const html = withPreloads(page(name), name)
    for (const href of preloaded(html)) expect(existsSync(join(PUBLIC_DIR, href)), href).toBe(true)
    const importMap = html.indexOf('<script type="importmap">')
    if (importMap >= 0) expect(html.indexOf('<!-- preloads: ')).toBeGreaterThan(importMap)
  })

  it('gives the same page when run twice', () => {
    const once = withPreloads(page('score.html'))
    expect(withPreloads(once)).toBe(once)
  })
})
