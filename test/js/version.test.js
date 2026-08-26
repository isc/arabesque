import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, checkAppVersion } from '../../public/js/version.js'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))

// A document whose <meta name="app-version"> holds `content`, and nothing else
// the check reads.
const stampedPage = (content) => ({
  querySelector: () => (content === null ? null : { getAttribute: () => content }),
})

// The node test environment has no Web Storage; the check only ever reads and
// writes one key.
const fakeSessionStorage = () => {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  }
}

describe('checkAppVersion', () => {
  let reload

  beforeEach(() => {
    reload = vi.fn()
    vi.stubGlobal('location', { reload, pathname: '/library.html' })
    vi.stubGlobal('sessionStorage', fakeSessionStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const check = (pageVersion) => {
    vi.stubGlobal('document', stampedPage(pageVersion))
    checkAppVersion()
  }

  it('does nothing when the page and the scripts come from the same deploy', () => {
    check(APP_VERSION)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once for a mismatch, and not again for the same one', () => {
    check('older-deploy')
    check('older-deploy')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again when a later deploy moves the scripts side', () => {
    check('older-deploy')
    check('another-deploy')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it("gives each page its own attempt: one document cannot spend another's", () => {
    check('older-deploy')
    vi.stubGlobal('location', { reload, pathname: '/practice.html' })
    check('older-deploy')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('stays quiet on a page that carries no stamp at all', () => {
    check(null)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays quiet, rather than looping, when Web Storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined)
    check('older-deploy')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('the version stamp', () => {
  it('is unstamped in the repo, so the check never fires outside a deploy', () => {
    expect(APP_VERSION).toBe('dev')
  })

  // The stamp is only useful if it covers every page: an unstamped one keeps
  // serving a stale pairing silently. scripts/stamp-version.mjs rewrites these
  // exact markers at deploy time and fails if one is missing.
  it.each(pages)('is carried by %s, which loads the check', (page) => {
    const html = readFileSync(join(PUBLIC_DIR, page), 'utf8')
    expect(html).toContain(`<meta name="app-version" content="${APP_VERSION}" />`)
    expect(html).toContain('<script type="module" src="js/version.js"></script>')
  })
})
