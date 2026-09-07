import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGELOG, mergeChangelog } from '../../public/js/changelog.js'
import {
  parseFragment,
  readFragments,
  groupByDate,
  wrap,
  renderMarkdownItem,
  foldIntoMarkdown,
  PENDING_LINE,
  MAX_ITEM_LENGTH,
  LANGS,
} from '../../scripts/changelog.mjs'

const ROOT = join(import.meta.dirname, '..', '..')

const fragment = (fr, en) => `# fr\n${fr}\n\n# en\n${en}\n`

describe('a changelog fragment', () => {
  it('takes its date from the file name and its items from the two sections', () => {
    expect(parseFragment('2026-09-06-a-slug.md', fragment('Bonjour.', 'Hello.'))).toEqual({
      date: '2026-09-06',
      name: '2026-09-06-a-slug.md',
      fr: 'Bonjour.',
      en: 'Hello.',
    })
  })

  it('joins a wrapped section into one paragraph', () => {
    const parsed = parseFragment('2026-09-06-a-slug.md', '# fr\nUne phrase\n  coupée en trois\nlignes.\n\n# en\nOne.\n')
    expect(parsed.fr).toBe('Une phrase coupée en trois lignes.')
  })

  it('keeps the non-breaking spaces French typography needs', () => {
    expect(parseFragment('2026-09-06-a-slug.md', fragment('94 % à 55 BPM.', 'x.')).fr).toBe(
      '94 % à 55 BPM.',
    )
  })

  // The failure modes, each caught before the entry can ship rather than after.
  it('refuses a missing English half', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', '# fr\nBonjour.\n')).toThrow(/missing the "# en" section/)
  })

  it('refuses an empty section', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', fragment('Bonjour.', '  '))).toThrow(/"# en" section is empty/)
  })

  // The bar a reader complained about: entries had grown into paragraphs
  // justifying the implementation, and the modal became unreadable.
  it('refuses a section longer than a title sentence and one or two more', () => {
    const long = 'a'.repeat(MAX_ITEM_LENGTH + 1)
    expect(() => parseFragment('2026-09-06-a-slug.md', fragment(long, 'One.'))).toThrow(
      new RegExp(`is ${MAX_ITEM_LENGTH + 1} characters, over the ${MAX_ITEM_LENGTH}`),
    )
  })

  it('accepts a section right at the limit', () => {
    const exact = 'a'.repeat(MAX_ITEM_LENGTH)
    expect(parseFragment('2026-09-06-a-slug.md', fragment(exact, 'One.')).fr).toBe(exact)
  })

  it('refuses a section that is neither French nor English', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', '# de\nHallo.\n')).toThrow(/unknown section "# de"/)
  })

  it('refuses two sections in the same language', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', `${fragment('Un.', 'One.')}\n# fr\nDeux.\n`)).toThrow(
      /two "# fr" sections/,
    )
  })

  it('refuses text that is in no section at all', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', `Oubli du titre.\n${fragment('Un.', 'One.')}`)).toThrow(
      /text before the first section/,
    )
  })

  it('refuses a file name without a date, or with a stray one', () => {
    for (const name of ['a-slug.md', '2026-9-6-a-slug.md', '2026-09-06.md', '2026-09-06-a-slug.txt']) {
      expect(() => parseFragment(name, fragment('Un.', 'One.'))).toThrow(/YYYY-MM-DD-a-short-slug\.md/)
    }
  })

  it('names the file it is complaining about', () => {
    expect(() => parseFragment('2026-09-06-a-slug.md', '# fr\nBonjour.\n')).toThrow(/changelog\.d\/2026-09-06-a-slug/)
  })
})

describe('the fragments in the repository', () => {
  // The guard that makes all of the above worth having: a fragment on a branch
  // is parsed by the suite the pull request runs, so a malformed one — or one
  // that never got its English — fails there and not at deploy.
  it('are all well-formed', () => {
    expect(() => readFragments()).not.toThrow()
  })
})

describe('grouping fragments', () => {
  const of = (date, slug, fr, en) => ({ date, name: `${date}-${slug}.md`, fr, en })

  it('makes one entry per date, newest first, both languages in step', () => {
    expect(
      groupByDate([of('2026-09-05', 'a', 'Un.', 'One.'), of('2026-09-06', 'b', 'Deux.', 'Two.'), of('2026-09-05', 'c', 'Trois.', 'Three.')]),
    ).toEqual([
      { date: '2026-09-06', items: { fr: ['Deux.'], en: ['Two.'] } },
      { date: '2026-09-05', items: { fr: ['Un.', 'Trois.'], en: ['One.', 'Three.'] } },
    ])
  })
})

describe('the changelog the app imports', () => {
  const source = readFileSync(join(ROOT, 'public', 'js', 'changelog.js'), 'utf8')

  it('carries the marker a deploy writes the pending entries over, and no entries', () => {
    expect(PENDING_LINE.test(source)).toBe(true)
    expect(source).toContain('const PENDING = []')
  })

  it('has both languages, in step, in every entry', () => {
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.items.fr.length).toBe(entry.items.en.length)
      expect(entry.items.fr.length).toBeGreaterThan(0)
    }
  })

  // What `parseFragment` enforces for a fragment, held over the entries that
  // are already folded in: shortening them once is worth nothing if the next
  // hand-written line brings the paragraphs back.
  it('keeps every item to what a modal can be read in', () => {
    for (const entry of CHANGELOG) {
      for (const lang of LANGS) {
        for (const item of entry.items[lang]) {
          expect(item.length, `${entry.date} ${lang}: ${item.slice(0, 60)}…`).toBeLessThanOrEqual(MAX_ITEM_LENGTH)
        }
      }
    }
  })

  it('is antechronological, one entry per date', () => {
    const dates = CHANGELOG.map((entry) => entry.date)
    expect(dates).toEqual([...new Set(dates)])
    expect(dates).toEqual([...dates].sort().reverse())
  })
})

// CHANGELOG's bullets, one string per item, `**` dropped. Normally `fold`
// writes them from fragments that already passed the cap, but the file is
// hand-edited often enough — this change included — to be worth its own gate.
const changelogBullets = (md) => {
  const items = []
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) items.push(line.slice(2))
    else if (items.length && line.startsWith('  ')) items[items.length - 1] += ` ${line.trim()}`
  }
  return items.map((item) => item.replaceAll('**', ''))
}

describe('the CHANGELOG file', () => {
  const bullets = changelogBullets(readFileSync(join(ROOT, 'CHANGELOG'), 'utf8'))

  it('parses into the bullets it is made of', () => {
    expect(bullets.length).toBeGreaterThan(20)
  })

  it('keeps every bullet to the length an entry gets', () => {
    for (const bullet of bullets) {
      expect(bullet.length, `${bullet.slice(0, 60)}…`).toBeLessThanOrEqual(MAX_ITEM_LENGTH)
    }
  })

  // The limit is written twice on purpose — once where it is enforced, once
  // where the writer reads it — so the two are held together here rather than
  // left to drift.
  it('is the limit CLAUDE.md tells writers to keep to', () => {
    expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')).toContain(`${MAX_ITEM_LENGTH} characters per section`)
  })
})

describe('mergeChangelog', () => {
  const entry = (date, fr, en) => ({ date, items: { fr: [fr], en: [en] } })

  it('puts a pending entry above the published ones', () => {
    expect(mergeChangelog([entry('2026-09-06', 'Neuf.', 'New.')], [entry('2026-09-05', 'Vieux.', 'Old.')])).toEqual([
      entry('2026-09-06', 'Neuf.', 'New.'),
      entry('2026-09-05', 'Vieux.', 'Old.'),
    ])
  })

  it('folds a shared date into one group, pending items first', () => {
    expect(mergeChangelog([entry('2026-09-05', 'Neuf.', 'New.')], [entry('2026-09-05', 'Vieux.', 'Old.')])).toEqual([
      { date: '2026-09-05', items: { fr: ['Neuf.', 'Vieux.'], en: ['New.', 'Old.'] } },
    ])
  })

  // What lets `fold` prepend a group without looking at what is already there.
  it('repairs a date that appears twice in the history', () => {
    expect(mergeChangelog([], [entry('2026-09-05', 'Un.', 'One.'), entry('2026-09-05', 'Deux.', 'Two.')])).toEqual([
      { date: '2026-09-05', items: { fr: ['Un.', 'Deux.'], en: ['One.', 'Two.'] } },
    ])
  })

  it('sorts by date whatever order it is handed', () => {
    const dates = mergeChangelog([], [entry('2026-08-01', 'a', 'a'), entry('2026-09-05', 'b', 'b')]).map((e) => e.date)
    expect(dates).toEqual(['2026-09-05', '2026-08-01'])
  })
})

describe('folding into CHANGELOG', () => {
  const entry = (date, ...fr) => ({ date, items: { fr, en: fr.map(() => 'x') } })

  it('bolds the opening sentence and wraps the rest', () => {
    expect(renderMarkdownItem('Le clic se voit. Une mesure complète s’écoule avant la première note, et rien ne le disait.')).toBe(
      '- **Le clic se voit.** Une mesure complète s’écoule avant la première note, et\n  rien ne le disait.',
    )
  })

  it('bolds the whole item when it is a single sentence', () => {
    expect(renderMarkdownItem('Le clic se voit')).toBe('- **Le clic se voit**')
  })

  it('never breaks a line on a non-breaking space', () => {
    const line = wrap(`${'mot '.repeat(19)}94 %`)
    expect(line).toContain('94 %')
    expect(line.split('\n').every((l) => l.length <= 78)).toBe(true)
  })

  it('prepends a new date above the file', () => {
    expect(foldIntoMarkdown('2026-09-05\n\n- **Vieux.**\n', [entry('2026-09-06', 'Neuf.')])).toBe(
      '2026-09-06\n\n- **Neuf.**\n\n2026-09-05\n\n- **Vieux.**\n',
    )
  })

  it('adds to a date already at the top rather than repeating its heading', () => {
    expect(foldIntoMarkdown('2026-09-05\n\n- **Vieux.**\n', [entry('2026-09-05', 'Neuf.')])).toBe(
      '2026-09-05\n\n- **Neuf.**\n\n- **Vieux.**\n',
    )
  })

  it('leaves the newest date on top when several are folded at once', () => {
    const folded = foldIntoMarkdown('2026-09-04\n\n- **Vieux.**\n', [entry('2026-09-06', 'Neuf.'), entry('2026-09-05', 'Hier.')])
    expect(folded.split('\n\n').map((block) => block.split('\n')[0])).toEqual([
      '2026-09-06',
      '- **Neuf.**',
      '2026-09-05',
      '- **Hier.**',
      '2026-09-04',
      '- **Vieux.**',
    ])
  })
})
