import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { shellAssets } from '../../scripts/stamp-version.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const read = (...path) => readFileSync(join(PUBLIC_DIR, ...path), 'utf8')

describe('the service worker shell', () => {
  const shell = shellAssets()

  it('is left empty and unstamped in the repo', () => {
    expect(read('sw.js')).toContain("const VERSION = 'dev'")
    expect(read('sw.js')).toContain('const SHELL = []')
  })

  it('carries every page, script and vendor bundle', () => {
    for (const page of readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))) {
      expect(shell).toContain(page)
    }
    expect(shell).toContain('styles.css')
    expect(shell).toContain('js/version.js')
    expect(shell).toContain('js/swRegister.js')
    expect(shell).toContain('js/locales/fr.js')
    expect(shell).toContain('vendor/opensheetmusicdisplay.2.1.2.min.js')
    // Without the catalog, the library opens offline with no scores in it.
    expect(shell).toContain('data/scores.json')
    expect(shell).toContain('data/fingerprints.json')
  })

  it('carries the bare origin, which is what the iOS wrapper opens', () => {
    // It serves index.html but is not that file's name, so walking public/
    // cannot produce it — and missing it failed every offline launch there.
    expect(shell).toContain('./')
  })

  it('leaves out what nobody needs offline, and the worker itself', () => {
    expect(shell.filter((asset) => asset.startsWith('scores/'))).toEqual([])
    expect(shell.filter((asset) => asset.startsWith('video/'))).toEqual([])
    expect(shell.filter((asset) => asset.startsWith('cassettes/'))).toEqual([])
    expect(shell).not.toContain('sw.js')
  })
})

describe('which pages install it', () => {
  const registers = (page) => read(page).includes('src="js/swRegister.js"')

  // The worker answers for the whole origin whoever registered it, so the app's
  // own pages are enough — and a landing visitor who bounces is not made to
  // precache the app first.
  it.each(['library.html', 'score.html', 'practice.html', 'data.html'])('%s does', (page) => {
    expect(registers(page)).toBe(true)
  })

  it.each(['index.html', 'privacy.html', 'support.html'])('%s does not', (page) => {
    expect(registers(page)).toBe(false)
  })
})
