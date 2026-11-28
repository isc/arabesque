// How the score page tells a piece's runs through: the ranking at the end of a
// piece, and the history modal's charts, day lines and troubled bars. Pure —
// runs in, words and SVG out; the page holds what is on screen (app.js).
import { formatDuration, withRunKind } from './utils.js?v=cd8a61637d5a'
import { playthroughGroups } from './hands.js?v=cd8a61637d5a'
import { byStartedAt } from './days.js?v=cd8a61637d5a'
import { t, tn, locale } from './i18n.js?v=cd8a61637d5a'
import { isCleanRun } from './tempoTrainer.js?v=cd8a61637d5a'

// Built once: the active locale is fixed for the page lifetime (switching
// language reloads), so these don't need rebuilding per call/point.
const PLAYTHROUGH_LIST_FORMATTER = new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' })
const CHART_DATE_FULL = new Intl.DateTimeFormat(locale())
const CHART_DATE_AXIS = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })
const RUN_TIME = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })

// How many measures the result modal names before it only counts them.
const WRONG_MEASURES_LISTED = 6

// The headline figure of a strict run: notes in tempo, as a percentage.
export function strictAccuracy({ hit, total }) {
  return total ? Math.round((hit / total) * 100) : 0
}

// A free run's wrong notes. Runs filed before the count was shown carry it
// too: every measure attempt has always recorded its wrong notes.
export function wrongNotesText(n) {
  return n ? tn('score.wrongNotes', n) : t('score.noWrongNote')
}

// A free run's holes, in and between its bars (steadiness.js).
export function holesText(n) {
  return n ? tn('score.holes', n) : t('score.noHole')
}

// How clean a free run was: its wrong notes, and its holes when it has a
// count (playthroughHoles in practiceTime.js).
export function faultsText(pt) {
  const wrongNotes = wrongNotesText(pt.wrongNotes)
  return pt.holes == null ? wrongNotes : `${wrongNotes}, ${holesText(pt.holes)}`
}

// The stretch of a chart's vertical axis: a tenth of the spread of headroom
// either side, stopping at `ceiling`.
const paddedRange = (ceiling) => (low, high) => {
  const headroom = (high - low) * 0.1
  return [Math.max(0, low - headroom), Math.min(ceiling, high + headroom)]
}

// What a strict run's rate leaves out: its missed notes, and the wrong notes
// struck on top of the ones it played, which the rate never counts — a run at
// 100 % can hold some (feedback 9337d522). Empty for a clean run.
function strictFaultsText({ missed, wrongNotes }) {
  return [missed && tn('score.missedNotes', missed), wrongNotes && tn('score.wrongNotes', wrongNotes)]
    .filter(Boolean)
    .join(', ')
}

// The same as one count, for a strict run's record of them.
const strictFaults = ({ strict }) => (strict.missed ?? 0) + (strict.wrongNotes ?? 0)
const faultCountText = (n) => (n ? tn('score.faults', n) : t('score.noFault'))
const percentText = (pct) => t('score.percent', { pct: Math.round(pct) })

// A strict run's tempo. Its hit rate says nothing of a run at another one, so
// the runs it is ranked and measured against are those at its own (atTempo).
const tempoOf = (pt) => pt.strict.bpm
const atTempo = (runs, latest) => runs.filter((pt) => tempoOf(pt) === tempoOf(latest))

// What a chart draws under its line, one row each on the runs' own columns:
// what its figure says nothing of. Under a free run's time, the counts, as
// bars (countBars) in the colours the score itself gives a fumbled note and a
// late one. Under a strict run's hit rate, the tempo it was played at
// (tempoSteps): rates only compare at one tempo, and the line runs on across
// them as the player speeds up.
const FAULT_STRIPS = [
  { key: 'wrong-notes', name: 'score.chartWrongNotes', value: (pt) => pt.wrongNotes, draw: countBars },
  { key: 'holes', name: 'score.chartHoles', value: (pt) => pt.holes, draw: countBars },
]
const TEMPO_STRIP = { name: 'score.tempoBpm', value: tempoOf, draw: tempoSteps }

// What a run is measured by, per kind of run (see hands' playthroughGroups):
// a free run by the time it took, a strict run by its hit rate — which means
// nothing without the tempo, so its label carries it. Read wherever runs are
// listed, titled or plotted, so a kind is described in one place. A run's
// label says how clean it was as well — and a free run's, how steady: a time
// alone reads the same for a run that stumbled through as for one that didn't.
//
// `rank` orders the runs the end of a piece ranks, best first, and `faults`
// says what each got wrong beside its figure. `records` are the axes a run can
// beat the runs before it on (runRecords): what it reads off a run — null
// where the run says nothing on it — whether `lower` is better, and how it is
// said; `atTempo` for an axis only runs at the same tempo are measured on,
// `first` for one where the first run to have a figure at all is worth saying.
// `strips` are the rows its charts draw under their line.
const RUN_KINDS = {
  free: {
    title: 'score.playtimeEvolution',
    aria: 'score.chartAria',
    value: (pt) => pt.durationMs,
    best: Math.min,
    format: formatDuration,
    label: (pt) => `${formatDuration(pt.durationMs)} (${faultsText(pt)})`,
    range: paddedRange(Infinity),
    rank: (a, b) => a.durationMs - b.durationMs,
    faults: faultsText,
    records: [
      { key: 'time', title: 'score.recordTime', value: (pt) => pt.durationMs, lower: true, format: formatDuration },
      { key: 'wrong-notes', title: 'score.recordWrongNotes', value: (pt) => pt.wrongNotes, lower: true, format: wrongNotesText },
      { key: 'holes', title: 'score.recordHoles', value: (pt) => pt.holes, lower: true, format: holesText },
    ],
    strips: FAULT_STRIPS,
  },
  strict: {
    title: 'score.accuracyEvolution',
    aria: 'score.strictChartAria',
    value: (pt) => strictAccuracy(pt.strict),
    best: Math.max,
    format: percentText,
    label: (pt) => {
      const summary = t('score.strictRunSummary', { pct: strictAccuracy(pt.strict), bpm: pt.strict.bpm })
      const faults = strictFaultsText(pt.strict)
      return faults ? `${summary} (${faults})` : summary
    },
    range: paddedRange(100),
    rank: (a, b) => strictAccuracy(b.strict) - strictAccuracy(a.strict) || strictFaults(a) - strictFaults(b),
    faults: (pt) => strictFaultsText(pt.strict) || t('score.noFault'),
    records: [
      { key: 'accuracy', title: 'score.recordAccuracy', value: (pt) => strictAccuracy(pt.strict), format: percentText, atTempo: true },
      { key: 'faults', title: 'score.recordStrictFaults', value: strictFaults, lower: true, format: faultCountText, atTempo: true },
      // The tempo a run is clean at by the tempo trainer's rule, across tempi.
      {
        key: 'tempo',
        title: 'score.recordTempo',
        value: (pt) => (isCleanRun(pt.strict) ? pt.strict.bpm : null),
        format: (bpm) => t('score.atBpm', { bpm }),
        first: true,
      },
    ],
    strips: [TEMPO_STRIP],
  },
}

function runKind(strict) {
  return strict ? RUN_KINDS.strict : RUN_KINDS.free
}

// A strict run's line, from its verdict: the tempo trainer's result lists them.
export function strictRunLabel(verdict) {
  return RUN_KINDS.strict.label({ strict: verdict })
}

// The runs the most recent one is measured against: those of its kind and
// hands (playthroughGroups), itself included — a right-hand run beats every
// two-hand time on the clock without being the better performance, and a
// strict run's time is the metronome's, not the player's. `allPlaythroughs`
// comes most recent first (getAllPlaythroughs).
function comparableRuns(allPlaythroughs) {
  const [latest] = allPlaythroughs
  return playthroughGroups(allPlaythroughs).find((g) => g.playthroughs.includes(latest))?.playthroughs ?? []
}

// The result modal's ranking, best first — the fastest free runs, the most
// accurate strict ones at the same tempo — the run just played flagged so the
// modal can highlight it.
export function rankingOf(allPlaythroughs) {
  const [latest] = allPlaythroughs
  const comparable = comparableRuns(allPlaythroughs)
  const ranked = latest?.strict ? atTempo(comparable, latest) : comparable
  return ranked
    .map((pt) => ({ ...pt, isCurrent: pt === latest }))
    .sort(runKind(Boolean(latest?.strict)).rank)
}

// What the ranking is headed with: the tempo of a strict one, all at one.
export function rankingHeading(allPlaythroughs) {
  const [latest] = allPlaythroughs
  return latest?.strict ? t('score.rankingAtTempo', { bpm: tempoOf(latest) }) : ''
}

// The tempi a strict run's comparable runs were also played at, fastest first:
// how many runs at each, and the best rate. The ranking stays at the run's own
// tempo, where rates compare; this is where the others stand beside it.
export function otherTempi(allPlaythroughs) {
  const [latest] = allPlaythroughs
  if (!latest?.strict) return []
  const byTempo = Map.groupBy(comparableRuns(allPlaythroughs), tempoOf)
  byTempo.delete(tempoOf(latest))
  const { value, best, format } = RUN_KINDS.strict
  return [...byTempo]
    .sort(([a], [b]) => b - a)
    .map(([bpm, runs]) => ({ bpm, text: t('score.otherTempo', { bpm, n: runs.length, best: format(best(...runs.map(value))) }) }))
}

// A ranked run's figure, and what it got wrong, as the ranking shows them.
export function runFigure(pt) {
  const kind = runKind(Boolean(pt.strict))
  return kind.format(kind.value(pt))
}
export const runFaults = (pt) => runKind(Boolean(pt.strict)).faults(pt)

// What the most recent run beat, axis by axis (RUN_KINDS' records): its figure
// and the best before it among the runs it is measured against, `before` null
// for a first. Nothing on an axis the run is the first to be measured on, but
// for a first worth saying: the first clean run to the click.
export function runRecords(allPlaythroughs) {
  const [latest] = allPlaythroughs
  const comparable = comparableRuns(allPlaythroughs)
  if (comparable.length < 2) return []
  return runKind(Boolean(latest.strict)).records.flatMap((axis) => {
    const value = axis.value(latest)
    if (value == null) return []
    const pool = axis.atTempo ? atTempo(comparable, latest) : comparable
    const before = pool.filter((pt) => pt !== latest).map(axis.value).filter((v) => v != null)
    const record = { key: axis.key, title: t(axis.title, { bpm: latest.strict?.bpm }), value: axis.format(value) }
    if (before.length === 0) return axis.first ? [{ ...record, before: null }] : []
    const best = axis.lower ? Math.min(...before) : Math.max(...before)
    const beaten = axis.lower ? value < best : value > best
    return beaten ? [{ ...record, before: axis.format(best) }] : []
  })
}

// Where a run went wrong, kind by kind: the bars of each in score order —
// past a handful of them, only how many more. From the faults a strict run's
// engine noted (strictPlaythrough.js), or a free run's wrong measures as
// 'wrong' faults.
const WHERE = [
  { key: 'wrong', kinds: ['wrong'], label: 'score.whereWrong' },
  { key: 'missed', kinds: ['missed'], label: 'score.whereMissed' },
  { key: 'offClick', kinds: ['late', 'early'], label: 'score.whereOffClick' },
  { key: 'released', kinds: ['released'], label: 'score.whereReleased' },
]

export function faultBars(faults) {
  return WHERE.flatMap(({ key, kinds, label }) => {
    const bars = [...new Set(faults.filter((f) => kinds.includes(f.kind) && f.bar != null).map((f) => f.bar))].sort((a, b) => a - b)
    if (bars.length === 0) return []
    const numbers = bars.map((bar) => String(bar + 1))
    const more = bars.length - WRONG_MEASURES_LISTED
    const text = more > 0
      ? `${t('score.whereBars', { list: numbers.slice(0, WRONG_MEASURES_LISTED).join(', ') })} ${t('verdict.more', { n: more })}`
      : t(numbers.length === 1 ? 'score.whereBarsOne' : 'score.whereBars', { list: PLAYTHROUGH_LIST_FORMATTER.format(numbers) })
    return [{ key, label: t(label), bars: text }]
  })
}

// What a run lost, a chip a kind, under its figure: how many — a strict run's
// notes off the click, missed and wrong, a free run's wrong notes and holes —
// and the bars they fell in (faultBars). `dot` is the colour that kind leaves
// on the score, the chip's key to it. A strict run lists only what it lost:
// its rate says the rest. A free run always has both, "sans faute" being news.
export function faultChips({ run = null, verdict = null, faults = [] }) {
  const bars = Object.fromEntries(faultBars(faults).map((line) => [line.key, line.bars]))
  const chip = (key, dot, text, side = '') => ({ key, dot, text, detail: [side, bars[key]].filter(Boolean).join(' · ') })
  if (verdict) {
    const { offTempoEarly: early = 0, offTempoLate: late = 0, missed = 0, wrongNotes = 0 } = verdict
    const side = early && late
      ? `${early} ${t('score.strictTooEarly')}, ${late} ${t('score.strictTooLate')}`
      : t(early ? 'score.strictTooEarly' : 'score.strictTooLate')
    return [
      early + late && chip('offClick', 'offtempo', `${early + late} ${t('score.strictOffTempo')}`, side),
      missed && chip('missed', 'missed', tn('score.missedNotes', missed)),
      wrongNotes && chip('wrong', 'wrong', tn('score.wrongNotes', wrongNotes)),
      bars.released && chip('released', 'offtempo', t('score.whereReleased')),
    ].filter(Boolean)
  }
  if (!run) return []
  return [
    chip('wrong', run.wrongNotes ? 'wrong' : 'clean', wrongNotesText(run.wrongNotes)),
    run.holes != null && chip('holes', run.holes ? 'offtempo' : 'clean', holesText(run.holes)),
  ].filter(Boolean)
}

// A day of the history, with a line under it for each kind of run and hand
// selection it holds, and the runs of that line one by one, each by the
// session that holds it: what the line opens on, to take one back.
export function withRunLines(day) {
  return {
    ...day,
    runLines: playthroughGroups(day.fullPlaythroughs).map((group) => ({
      key: group.key,
      text: playthroughsSummary(group),
      runs: chronological(group).map((pt) => ({
        sessionId: pt.sessionId,
        time: RUN_TIME.format(new Date(pt.startedAt)),
        label: runKind(group.strict).label(pt),
      })),
    })),
  }
}

// Groups hold their runs most recent first.
function chronological(group) {
  return [...group.playthroughs].reverse()
}

function playthroughsSummary(group) {
  const runs = chronological(group)
  const list = runs.map(runKind(group.strict).label)
  const summary = t('score.playthroughsSummary', { n: runs.length, list: PLAYTHROUGH_LIST_FORMATTER.format(list) })
  return withRunKind(summary, group)
}

function chartTitle(group) {
  return withRunKind(t(runKind(group.strict).title), group)
}

// One evolution chart per kind of run and hand selection — play time for free
// runs, over their wrong notes and holes, hit rate for strict ones — each with
// its `title`, its `best` figure, the point it marks, and `draw`, which gives
// its SVG at the width it is shown at (chartSvg says why). A group with too few
// runs to plot simply drops out.
export function playthroughCharts(playthroughs) {
  return playthroughGroups(playthroughs)
    .filter((group) => group.playthroughs.length >= MIN_PLOTTED)
    .map((group) => {
      const metric = runKind(group.strict)
      const best = metric.best(...group.playthroughs.map(metric.value))
      return {
        key: group.key,
        title: chartTitle(group),
        draw: (width) => chartSvg(group.playthroughs, metric, metric.strips, width),
        best: t('score.chartBest', { value: metric.format(best) }),
      }
    })
}

// The chart at the end of a piece, of the runs it ranks: the same picture as
// the history's, under the same title — but for the tempo row: a strict
// ranking is all at one tempo (rankingOf), which its heading names. A list, as
// the history's is: empty below two runs.
export function resultCharts(runs) {
  if (runs.length < MIN_PLOTTED) return []
  const metric = runKind(runs[0].strict)
  const strips = metric.strips.filter((strip) => strip !== TEMPO_STRIP)
  return [{ key: metric.title, title: t(metric.title), draw: (width) => chartSvg(runs, metric, strips, width) }]
}

// A line needs two points.
const MIN_PLOTTED = 2

// A row of bars under a chart's line: the gap above it, its name, its bars.
const STRIP = { gap: 8, head: 16, bars: 28 }

// Built as a string (not <template x-for>) because Alpine's templates
// render in HTML namespace and won't show up inside <svg>. Drawn `width`
// pixels wide, the width of the element it goes into, so a pixel of the
// drawing is one of the screen: scaled down whole to a phone's width, as it
// once was, its labels came out at half their size. Nothing without a width,
// which is an element not laid out yet. The runs are all of one kind, the way
// playthroughGroups hands them over. `strips` are rows under the line, each
// run in its own column, each row named and drawn by its `draw`.
function chartSvg(playthroughs, metric, strips, width) {
  if (!width) return ''

  const sorted = [...playthroughs].sort(byStartedAt)
  const values = sorted.map(metric.value)
  const [yMin, yMax] = metric.range(Math.min(...values), Math.max(...values))

  const W = width
  // Taller as it gets wider, within what stays a readable slope.
  const LINE_H = Math.round(Math.min(220, Math.max(150, W * 0.28)))
  const stripH = STRIP.gap + STRIP.head + STRIP.bars
  const H = LINE_H + strips.length * stripH
  const PAD = { top: 12, right: 12, bottom: 28, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = LINE_H - PAD.top - PAD.bottom
  // Evenly spaced by playthrough index: gaps between dates aren't shown.
  const n = sorted.length
  const xScale = (i) => PAD.left + (i / (n - 1)) * innerW
  const yScale = (d) =>
    PAD.top + innerH - ((d - yMin) / (yMax - yMin || 1)) * innerH

  const points = sorted.map((p, i) => ({
    x: xScale(i),
    y: yScale(metric.value(p)),
    tip: `${CHART_DATE_FULL.format(new Date(p.startedAt))} — ${metric.label(p)}`,
  }))
  const fmtAxis = (iso) => CHART_DATE_AXIS.format(new Date(iso))

  const axisY = PAD.top + innerH
  const xMin = PAD.left
  const xMax = PAD.left + innerW

  const yLabels = [
    `<text x="${xMin - 8}" y="${yScale(yMax) + 4}" text-anchor="end" class="chart-label">${metric.format(yMax)}</text>`,
    `<text x="${xMin - 8}" y="${yScale(yMin) + 4}" text-anchor="end" class="chart-label">${metric.format(yMin)}</text>`,
  ].join('')
  const xLabels = [
    `<text x="${xMin}" y="${H - 8}" text-anchor="start" class="chart-label">${fmtAxis(sorted[0].startedAt)}</text>`,
    `<text x="${xMax}" y="${H - 8}" text-anchor="end" class="chart-label">${fmtAxis(sorted[n - 1].startedAt)}</text>`,
  ].join('')
  // The best run, the most recent when several tie as clean runs do, and the
  // latest stand out from the others, which thin out as they crowd the line.
  const bestIndex = values.lastIndexOf(metric.best(...values))
  const radius = n > 24 ? 2.5 : 3.5
  const circles = points
    .map((p, i) => {
      const r = i === bestIndex || i === n - 1 ? radius + 2 : radius
      const marks = `${i === n - 1 ? ' is-latest' : ''}${i === bestIndex ? ' is-best' : ''}`
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" class="chart-point${marks}"><title>${p.tip}</title></circle>`
    })
    .join('')
  const line = points.map((p) => `${p.x},${p.y}`).join(' ')

  const columns = { xScale, xMin, xMax, points }
  const stripsSvg = strips
    .map((strip, s) => {
      const top = axisY + s * stripH + STRIP.gap
      const row = { key: strip.key, values: sorted.map(strip.value), top: top + STRIP.head, base: top + STRIP.head + STRIP.bars }
      return `<text x="${xMin}" y="${top + 11}" class="chart-label">${t(strip.name)}</text>
    ${strip.draw(row, columns)}
    <line x1="${xMin}" x2="${xMax}" y1="${row.base}" y2="${row.base}" class="chart-axis" />`
    })
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" class="playthrough-chart" role="img" aria-label="${t(metric.aria)}">
    <line x1="${xMin}" x2="${xMax}" y1="${yScale(yMax)}" y2="${yScale(yMax)}" class="chart-guide" />
    <line x1="${xMin}" x2="${xMax}" y1="${axisY}" y2="${axisY}" class="chart-axis" />
    <polygon points="${xMin},${axisY} ${line} ${xMax},${axisY}" class="chart-area" />
    <polyline points="${line}" class="chart-line" />
    ${yLabels}
    ${xLabels}
    ${circles}
    ${stripsSvg}
  </svg>`
}

// A count per run as a bar, from zero to the worst run — one at the least —
// which the figure on the left gives. A run without a count (holes, before
// the pace was judged) is marked as such rather than left to read as a clean
// one, and a stretch of them is one block, however many they are.
function countBars({ key, values, top, base }, { xScale, xMin, points }) {
  const barW = Math.min(8, (xScale(1) - xScale(0)) * 0.6)
  const barX = (i) => xScale(i) - barW / 2
  const max = Math.max(1, ...values)
  const blocks = stretches(values.map((count) => count ?? null))
    .filter(({ value }) => value === null)
    .map(({ from, to }) => `<rect class="chart-unknown" x="${barX(from)}" y="${top}" width="${xScale(to) - xScale(from) + barW}" height="${base - top}"><title>${t('score.chartNotMeasured')}</title></rect>`)
    .join('')
  const bars = values
    .map((count, i) => {
      if (!count) return ''
      const h = Math.max(2, (count / max) * (base - top))
      return `<rect class="chart-bar chart-bar--${key}" x="${barX(i)}" y="${base - h}" width="${barW}" height="${h}" rx="1.5"><title>${points[i].tip}</title></rect>`
    })
    .join('')
  return `<text x="${xMin - 8}" y="${top + 8}" text-anchor="end" class="chart-label">${max}</text>${blocks}${bars}`
}

// The runs of equal values side by side, as index ranges: a stretch of runs
// without a count, a step at one tempo.
function stretches(values) {
  const found = []
  values.forEach((value, i) => {
    if (found.length && found.at(-1).value === value) found.at(-1).to = i
    else found.push({ value, from: i, to: i })
  })
  return found
}

// The room a digit of the row's figures takes, in pixels, at the chart's size.
const DIGIT_WIDTH = 7

// Each run's tempo as a step line, from the slowest at the bottom of the row
// to the fastest at the top, a run's step spanning its column. Each step at a
// tempo is written over its middle when it is wide enough to hold the figure
// — under the line at the top of the row, where the row's name sits above —
// so two figures never meet.
function tempoSteps({ values, top, base }, { xScale, xMin, xMax }) {
  const low = Math.min(...values)
  const high = Math.max(...values)
  const y = (bpm) => (high === low ? (top + base) / 2 : base - ((bpm - low) / (high - low)) * (base - top))
  const edge = (i) => (i === 0 ? xMin : i === values.length ? xMax : (xScale(i - 1) + xScale(i)) / 2)
  const steps = stretches(values).map(({ value, from, to }) => ({ bpm: value, from: edge(from), to: edge(to + 1) }))
  const path = steps.map(({ bpm, to }, i) => `${i ? 'V' : `M${xMin},`}${y(bpm)} H${to}`).join(' ')
  const labels = steps
    .filter(({ bpm, from, to }) => to - from >= String(bpm).length * DIGIT_WIDTH + 4)
    .map(({ bpm, from, to }) => `<text x="${(from + to) / 2}" y="${y(bpm) === top ? top + 12 : y(bpm) - 4}" text-anchor="middle" class="chart-label">${bpm}</text>`)
  return `<path d="${path}" class="chart-step" />${labels.join('')}`
}

// Top measures with the highest error rate, surfaced inside the history modal
// so practiced measures with persistent trouble are visible without diving
// into the data. From the score's aggregate row, or nothing without one.
const HOT_MEASURES_SHOWN = 5

export function hotMeasures(aggregate) {
  if (!aggregate?.measures) return []
  return Object.entries(aggregate.measures)
    .map(([idx, m]) => ({ index: Number(idx), attempts: m.totalAttempts || 0, errorRate: m.errorRate || 0 }))
    .filter((m) => m.attempts >= 2 && m.errorRate > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, HOT_MEASURES_SHOWN)
}
