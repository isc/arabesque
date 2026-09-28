import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceOnce, replacedOnce } from '../../scripts/replace-once.mjs'

describe('replaceOnce', () => {
  let dir
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes the replacement as it is, dollar signs included', () => {
    dir = mkdtempSync(join(tmpdir(), 'replace-once-'))
    const file = join(dir, 'marked.js')
    writeFileSync(file, 'before\nconst MARKER = []\nafter\n')
    const replacement = `const MARKER = ["$' $\` $& $$"]`

    replaceOnce(file, /^const MARKER = \[\]$/m, replacement)

    expect(readFileSync(file, 'utf8')).toBe(`before\n${replacement}\nafter\n`)
  })

  it('refuses text that has lost its marker, or holds it twice', () => {
    const marker = /^const MARKER = \[\]$/m
    expect(() => replacedOnce('before\n', marker, 'x')).toThrow('expected exactly one')
    expect(() => replacedOnce('const MARKER = []\nconst MARKER = []\n', marker, 'x')).toThrow('found 2')
  })
})
