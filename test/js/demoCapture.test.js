import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// scripts/demo/capture.sh regenerates the App Store screenshots on a Mac with
// simulators, which nothing here runs — so what it assumes about the site is
// checked here instead, where CI sees it. It broke in #319 when the line it
// rewrites moved, and stayed broken until someone next ran it.
const ROOT = join(import.meta.dirname, '..', '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const capture = read('scripts/demo/capture.sh')

describe('capture.sh', () => {
  it('finds the mock device name it replaces, once', () => {
    const [, file, old] = /python3 - "\$SITE\/(js\/[\w.]+)" <<'PY'[\s\S]*?old = "([^"]+)"/.exec(capture)
    expect(read(`public/${file}`).split(old)).toHaveLength(2)
  })

  it('injects its scripts into pages that exist and have a head', () => {
    const pages = [...capture.matchAll(/^inject (\S+) \S+$/gm)].map(([, page]) => page)
    expect(pages).not.toHaveLength(0)
    for (const page of pages) expect(read(`public/${page}`), page).toContain('</head>')
  })
})
