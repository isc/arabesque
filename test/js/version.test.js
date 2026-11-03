import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installSessionStorage } from './support/browserGlobals.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, checkAppVersion, checkBoot } from '../../public/js/version.js'
import { recentErrors } from '../../public/js/errorLog.js'
import { htmlPages, VERSION_SCRIPT } from '../../scripts/stamp-version.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const pages = htmlPages()

// A document whose <meta name="app-version"> holds `content`, and nothing else
// the check reads.
const stampedPage = (content) => ({
  querySelector: () => (content === null ? null : { getAttribute: () => content }),
})

let reload

beforeEach(() => {
  reload = vi.fn()
  vi.stubGlobal('location', { reload, pathname: '/library.html' })
  installSessionStorage()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('checkAppVersion', () => {
  const check = (pageVersion) => {
    vi.stubGlobal('document', stampedPage(pageVersion))
    return checkAppVersion()
  }

  it('does nothing when the page and the scripts come from the same deploy', async () => {
    await check(APP_VERSION)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once for a mismatch, and not again for the same one', async () => {
    await check('older-deploy')
    await check('older-deploy')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again when a later deploy moves the scripts side', async () => {
    await check('older-deploy')
    await check('another-deploy')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it("gives each page its own attempt: one document cannot spend another's", async () => {
    await check('older-deploy')
    vi.stubGlobal('location', { reload, pathname: '/practice.html' })
    await check('older-deploy')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('says so in the error log before reloading', async () => {
    reload.mockImplementation(() =>
      expect(recentErrors().at(-1)).toMatchObject({
        where: 'Stale assets',
        message: 'Error: page yesterday-deploy, scripts dev',
      }),
    )
    await check('yesterday-deploy')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for `load`, since a reload sent before it did not get past memory', async () => {
    const window = new EventTarget()
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', stampedPage('older-deploy'))
    vi.resetModules()
    await import('../../public/js/version.js')
    expect(reload).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  // WebKit's memory cache pairs them behind a worker too (feedback 13c5d005).
  it('reloads a page a service worker serves as well', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } })
    await check('older-deploy')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('stays quiet on a page that carries no stamp at all', async () => {
    await check(null)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays quiet, rather than looping, when Web Storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await check('older-deploy')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('checkBoot', () => {
  const bootFailures = () => recentErrors().filter((error) => error.where === 'Boot failure')

  const check = ({ bindings, alpine }) => {
    vi.stubGlobal('window', { Alpine: alpine })
    vi.stubGlobal('document', { querySelector: (selector) => (selector === '[x-data]' && bindings) || null })
    return checkBoot()
  }

  it('leaves alone a page that got as far as Alpine, and one with no bindings to run', async () => {
    const before = bootFailures().length
    await check({ bindings: true, alpine: {} })
    await check({ bindings: false })
    expect(reload).not.toHaveBeenCalled()
    expect(bootFailures().length).toBe(before)
  })

  it('reloads a page that never started, and says so in the error log first', async () => {
    reload.mockImplementation(() =>
      expect(bootFailures().at(-1)).toMatchObject({ message: 'Error: /library.html did not start' }),
    )
    await check({ bindings: true })
    expect(reload).toHaveBeenCalledOnce()
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
    expect(html).toContain(VERSION_SCRIPT)
  })
})
