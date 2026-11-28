// What a go at a passage came to, in words a player reads from the bench in
// the second before the next one: a repetition in training, a run of a strict
// loop. Until there was this, a spoiled repetition said so by a dot turning
// red, and a strict loop by a "0 sur 3 propres" the count-in then covered: the
// player started again without knowing whether it was a wrong note, a hole or
// the click they had lost, nor where.
//
// A fault is what an engine noticed, as it noticed it:
//   { kind: 'wrong', bar, hand }          a key none of the notes owed
//   { kind: 'missed', bar, hand }         a note the click went past
//   { kind: 'hole', bar, beat, lostMs }   the flow stopping (steadiness.js)
//   { kind: 'late' | 'early', bar, hand } a note off the click
//   { kind: 'released', bar, hand }       a tied note let go before it came round
// `bar` is the bar's index (sourceMeasureIndex), `hand` 'right' or 'left',
// `beat` counted from 1.
//
// Where, and not what: the note a wrong key was played for is red on the
// score, and naming the two — "fa♯ au lieu de fa" — made the line too long to
// read from the bench (feedback b758ae14).
//
// Pure: faults in, words out.
import { locale, t, tn } from './i18n.js?v=eb60a5897b58'

// The order faults are told in, the one to fix first ahead: a wrong note is
// learnt if it is not stopped, a hole is the hand looking for the next one,
// and the click is the last thing worth chasing while the notes are not there.
const FAULT_ORDER = ['wrong', 'missed', 'hole', 'late', 'early', 'released']

// Bars named in a line before it gives up and counts the rest.
const BARS_LISTED = 3

const COUNT_KEYS = {
  wrong: 'score.wrongNotes',
  missed: 'score.missedNotes',
  hole: 'score.holes',
  late: 'verdict.late',
  early: 'verdict.early',
  released: 'verdict.released',
}

// Built once: the language is fixed for the life of the page (i18n.js).
const LIST = new Intl.ListFormat(locale(), { type: 'conjunction' })
const SECONDS = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const capitalized = (text) => text && text[0].toLocaleUpperCase(locale()) + text.slice(1)

// The longest of a run of holes, in seconds: what the worst of them cost.
const longest = (holes) => SECONDS.format(Math.max(...holes.map((hole) => hole.lostMs ?? 0)) / 1000)

// The faults of a kind bar by bar, each bar once in the order it came, with
// what tells its faults apart: the beats a hole fell on, the hands that owed
// any other.
function byBar(faults) {
  const bars = new Map()
  for (const { bar, beat, hand } of faults) {
    const within = bars.get(bar) ?? new Set()
    if (beat ?? hand) within.add(beat ?? hand)
    bars.set(bar, within)
  }
  return [...bars].map(([bar, within]) => ({ bar, within: [...within] }))
}

// A bar and what in it: "mes. 9 MG", "mes. 3 t. 2 et 4". A key struck in
// the count-in has no bar.
function barPlace({ bar, within }, kind) {
  if (bar == null) return t('verdict.countIn')
  const place = t('verdict.bar', { n: bar + 1 })
  if (within.length === 0) return place
  const parts = kind === 'hole'
    ? t('verdict.beat', { n: LIST.format(within.map(String)) })
    : LIST.format(within.map((hand) => t(`hands.${hand}`)))
  return `${place} ${parts}`
}

// Where a kind of fault fell, the first few bars of it — and for holes, what
// the worst of them cost.
function whereAndWhat(kind, faults) {
  const bars = byBar(faults)
  const more = bars.length > BARS_LISTED ? ` ${t('verdict.more', { n: bars.length - BARS_LISTED })}` : ''
  const place = bars.slice(0, BARS_LISTED).map((bar) => barPlace(bar, kind)).join(', ') + more
  if (kind !== 'hole') return place
  return t('verdict.at', { place, what: t(faults.length === 1 ? 'verdict.stop' : 'verdict.upTo', { s: longest(faults) }) })
}

// { clean, headline, detail }: the verdict's line in bold, and the line under
// it. A clean go can still hold faults the rule lets through — a note or two
// off the click — which the line under says, so that "Propre" is not read as
// "perfect" when it was not.
export function attemptVerdict({ clean, faults = [] }) {
  const kinds = FAULT_ORDER
    .map((kind) => ({ kind, faults: faults.filter((fault) => fault.kind === kind) }))
    .filter(({ faults }) => faults.length > 0)
  const counts = kinds.map(({ kind, faults }) => tn(COUNT_KEYS[kind], faults.length))
  if (clean) return { clean: true, headline: t('verdict.clean'), detail: capitalized(counts.join(' · ')) }
  if (kinds.length === 0) return { clean: false, headline: t('verdict.spoiled'), detail: '' }
  const [main] = kinds
  return { clean: false, headline: capitalized(counts.join(' · ')), detail: capitalized(whereAndWhat(main.kind, main.faults)) }
}
