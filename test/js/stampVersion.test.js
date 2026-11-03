import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { htmlPages, moduleFiles, VERSION_SCRIPT, withVersionedUrls } from '../../scripts/stamp-version.mjs'
import { withPreloads } from '../../scripts/preload-modules.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const read = (path) => readFileSync(join(PUBLIC_DIR, path), 'utf8')

const modules = moduleFiles().map((path) => [path, read(path)])
const sources = [...htmlPages().map((page) => [page, withPreloads(read(page), page)]), ...modules]

// Every name a module goes by, whichever way it is written: a quoted relative
// path to a .js file, or a page's own js/ reference. Broader on purpose than
// what the stamp rewrites, so a form of import it does not know shows up here as
// a URL left bare, which would load that module a second time under another name.
const QUOTED_MODULE = /(['"`])((?:\.{1,2}\/|js\/)[^'"`]*\.js(?:\?[^'"`]*)?)\1/g
const moduleUrls = (text) => [...text.matchAll(QUOTED_MODULE)].map((match) => match[2])

describe('withVersionedUrls', () => {
  it.each([
    ["import { a } from './a.js'", "import { a } from './a.js?v=abc'"],
    ["import {\n  a,\n} from '../a.js'", "import {\n  a,\n} from '../a.js?v=abc'"],
    ["export { a } from './a.js'", "export { a } from './a.js?v=abc'"],
    ["import './a.js'", "import './a.js?v=abc'"],
    ["await import('./a.js')", "await import('./a.js?v=abc')"],
    ["import { a } from './js/a.js'", "import { a } from './js/a.js?v=abc'"],
    ['<script type="module" src="js/a.js"></script>', '<script type="module" src="js/a.js?v=abc"></script>'],
    ['<link rel="modulepreload" href="js/a.js" />', '<link rel="modulepreload" href="js/a.js?v=abc" />'],
    ['<link rel="stylesheet" href="styles.css" />', '<link rel="stylesheet" href="styles.css?v=abc" />'],
  ])('names the deploy in %s', (text, stamped) => {
    expect(withVersionedUrls(text, 'abc')).toBe(stamped)
  })

  it('leaves what carries its version in its name, and what is not ours', () => {
    for (const text of [
      '<script defer src="vendor/jszip.3.10.1.min.js"></script>',
      '"tone": "./vendor/tone.14.8.49.min.js"',
      "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'",
      "const { Piano } = await import('@tonejs/piano')",
    ]) {
      expect(withVersionedUrls(text, 'abc')).toBe(text)
    }
  })

  it('leaves version.js its bare name, in a page and in a module', () => {
    expect(withVersionedUrls(VERSION_SCRIPT, 'abc')).toBe(VERSION_SCRIPT)
    const importing = "import { APP_VERSION } from './version.js'"
    expect(withVersionedUrls(importing, 'abc')).toBe(importing)
  })

  it.each(modules)('%s: asks version.js for APP_VERSION and nothing else', (name, text) => {
    const imports = [...text.matchAll(/\{([^}]*)\}\s*from\s*['"]\.\/version\.js['"]/g)]
    for (const [, names] of imports) expect(names.split(',').map((n) => n.trim().split(' ')[0])).toEqual(['APP_VERSION'])
  })

  it.each(sources)('%s: reaches every module reference', (name, text) => {
    const left = moduleUrls(withVersionedUrls(text, 'abc')).filter(
      (url) => !url.endsWith('?v=abc') && !url.endsWith('/version.js') && !url.includes('/vendor/'),
    )
    expect(left).toEqual([])
  })

  it.each(sources)('%s: moves to another deploy, and back to the checkout', (name, text) => {
    const stamped = withVersionedUrls(text, 'abc')
    expect(withVersionedUrls(stamped, 'def')).toBe(withVersionedUrls(text, 'def'))
    expect(withVersionedUrls(stamped, 'dev')).toBe(text)
  })
})
