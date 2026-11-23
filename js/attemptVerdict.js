// What a go at a passage came to, in words a player reads from the bench in
// the second before the next one: a repetition in training, a run of a strict
// loop. Until there was this, a spoiled repetition said so by a dot turning
// red, and a strict loop by a "0 sur 3 propres" the count-in then covered: the
// player started again without knowing whether it was a wrong note, a hole or
// the click they had lost, nor where.
//
// A fault is what an engine noticed, as it noticed it:
//   { kind: 'wrong', bar, hand, expected, played }  a key none of the notes owed
//   { kind: 'missed', bar, hand }                   a note the click went past
//   { kind: 'hole', bar, beat, lostMs }              the flow stopping (steadiness.js)
//   { kind: 'late' | 'early', bar, hand }            a note off the click
// `bar` is the bar's index (sourceMeasureIndex), `hand` 'right' or 'left',
// `expected` and `played` the two notes already named (wrongKeyNames in
// noteExtraction.js), `beat` counted from 1.
//
// Pure: faults in, words out.
import { locale, t, tn } from './i18n.js?v=c43a07152313'

// The order faults are told in, the one to fix first ahead: a wrong note is
// learnt if it is not stopped, a hole is the hand looking for the next one,
// and the click is the last thing worth chasing while the notes are not there.
const FAULT_ORDER = ['wrong', 'missed', 'hole', 'late', 'early']

// Bars named in a line before it gives up and counts the rest.
const BARS_LISTED = 3

const COUNT_KEYS = {
  wrong: 'score.wrongNotes',
  missed: 'score.missedNotes',
  hole: 'score.holes',
  late: 'verdict.late',
  early: 'verdict.early',
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

// A bar and what in it, in full where it is said alone — "mes. 9, main
// gauche", "mes. 3, temps 2" — and shortened in a list of bars: "mes. 9 MG".
// A key struck in the count-in has no bar.
function barPlace({ bar, within }, kind, short) {
  if (bar == null) return t('verdict.countIn')
  const place = t('verdict.bar', { n: bar + 1 })
  if (within.length === 0) return place
  const parts = kind === 'hole'
    ? t(short ? 'verdict.beatShort' : 'verdict.beat', { n: LIST.format(within.map(String)) })
    : LIST.format(within.map((hand) => t(short || within.length > 1 ? `hands.${hand}` : `handsFull.${hand}`)))
  return short ? `${place} ${parts}` : `${place}, ${parts}`
}

// What is worth saying of a kind of fault beyond its count: where, and what
// one of them was — the note played for the one owed, or the time lost.
function whereAndWhat(kind, faults) {
  const bars = byBar(faults)
  const [first] = faults
  const alone = bars.length === 1
  const more = bars.length > BARS_LISTED ? ` ${t('verdict.more', { n: bars.length - BARS_LISTED })}` : ''
  const place = alone ? barPlace(bars[0], kind, false) : bars.slice(0, BARS_LISTED).map((bar) => barPlace(bar, kind, true)).join(', ') + more
  let what = null
  if (kind === 'hole') what = t(alone && faults.length === 1 ? 'verdict.stop' : 'verdict.upTo', { s: longest(faults) })
  else if (kind === 'wrong' && alone && first.expected) what = t('verdict.instead', first)
  return what ? t('verdict.at', { place, what }) : place
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
