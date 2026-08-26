import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, checkAppVersion } from '../../public/js/version.js'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))

// A <meta name="app-version"> holding `content`, and nothing else the check reads.
const docWith = (content) => ({
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
    vi.stubGlobal('location', { reload })
    vi.stubGlobal('sessionStorage', fakeSessionStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing when the page and the scripts come from the same deploy', () => {
    expect(checkAppVersion(docWith(APP_VERSION))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when the page was cached from another deploy', () => {
    expect(checkAppVersion(docWith('older-deploy'))).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads only once for the same mismatch, so it cannot loop', () => {
    checkAppVersion(docWith('older-deploy'))
    expect(checkAppVersion(docWith('older-deploy'))).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again when the mismatch is a different one', () => {
    checkAppVersion(docWith('older-deploy'))
    expect(checkAppVersion(docWith('another-deploy'))).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('stays quiet on a page that carries no stamp at all', () => {
    expect(checkAppVersion(docWith(null))).toBe(false)
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
  it.each(pages)('is carried by %s, which runs the check', (page) => {
    const html = readFileSync(join(PUBLIC_DIR, page), 'utf8')
    expect(html).toContain(`<meta name="app-version" content="${APP_VERSION}" />`)
    expect(html).toContain('checkAppVersion()')
  })
})
