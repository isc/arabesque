import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shellAssets, htmlPages } from '../../scripts/stamp-version.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const read = (...path) => readFileSync(join(PUBLIC_DIR, ...path), 'utf8')

// The app's own pages, and the pages around it: the landing and the two the
// App Store links to. Every page is one or the other (see the test below), so
// a page added later is placed in one of them on purpose.
const APP_PAGES = ['library.html', 'score.html', 'practice.html', 'data.html']
const OTHER_PAGES = ['index.html', 'privacy.html', 'support.html']

describe('the service worker shell', () => {
  const shell = shellAssets()

  it('is left empty and unstamped in the repo', () => {
    expect(read('sw.js')).toContain("const VERSION = 'dev'")
    expect(read('sw.js')).toContain('const SHELL = []')
  })

  it('carries every page, script and vendor bundle', () => {
    for (const page of htmlPages()) expect(shell).toContain(page)
    expect(shell).toContain('styles.css')
    expect(shell).toContain('js/version.js')
    expect(shell).toContain('js/swRegister.js')
    expect(shell).toContain('js/locales/fr.js')
    expect(shell).toContain('vendor/opensheetmusicdisplay.2.1.3.min.js')
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
    // The install icons are fetched by the browser process, not by a page, so
    // the worker never gets to answer for them — a cached copy is dead weight
    // re-downloaded on every deploy.
    expect(shell.filter((asset) => asset.startsWith('icons/'))).toEqual([])
    expect(shell).not.toContain('sw.js')
  })
})

describe('which pages install it', () => {
  const registers = (page) => read(page).includes('src="js/swRegister.js"')
  const linksManifest = (page) => read(page).includes('rel="manifest"')

  // The worker answers for the whole origin whoever registered it, so the app's
  // own pages are enough — and a landing visitor who bounces is not made to
  // precache the app first. A manifest without a worker is not installable,
  // so the two travel together.
  it.each(APP_PAGES)('%s does, and links the install manifest', (page) => {
    expect(registers(page)).toBe(true)
    expect(linksManifest(page)).toBe(true)
  })

  it.each(OTHER_PAGES)('%s does not, nor links the manifest', (page) => {
    expect(registers(page)).toBe(false)
    expect(linksManifest(page)).toBe(false)
  })

  it('knows every page as the app’s or not', () => {
    expect([...APP_PAGES, ...OTHER_PAGES].toSorted()).toEqual(htmlPages().toSorted())
  })

  // Android tints its status bar with this, and it sits directly above the page
  // ground — see the note on --pt-bg in styles.css, which is the same value.
  it.each(APP_PAGES)(
    '%s declares the theme colour the manifest does',
    (page) => {
      const manifest = JSON.parse(read('manifest.webmanifest'))
      expect(read(page)).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`)
    },
  )
})

describe('the install manifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'))

  it('opens the app rather than the pitch, and not in a browser tab', () => {
    expect(manifest.start_url).toBe('library.html')
    expect(manifest.display).toBe('standalone')
  })

  // The app is also served from a project subpath on GitHub Pages, where a
  // root-absolute path resolves off the base.
  it('addresses everything relative to itself', () => {
    expect(manifest.start_url.startsWith('/')).toBe(false)
    for (const icon of manifest.icons) expect(icon.src.startsWith('/')).toBe(false)
  })

  it('carries the sizes Chrome asks for, and a maskable one', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    // Without one, Android boxes the artwork inside a white circle.
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('points only at icons that exist', () => {
    for (const icon of manifest.icons) {
      expect(() => readFileSync(join(PUBLIC_DIR, icon.src))).not.toThrow()
    }
  })
})
