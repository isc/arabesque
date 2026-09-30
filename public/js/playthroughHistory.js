// How the score page tells a piece's runs through: the ranking at the end of a
// piece, and the history modal's charts, day lines and troubled bars. Pure —
// runs in, words and SVG out; the page holds what is on screen (app.js).
import { formatDuration, withRunKind } from './utils.js'
import { playthroughGroups } from './hands.js'
import { byStartedAt } from './days.js'
import { t, tn, locale } from './i18n.js'

// Built once: the active locale is fixed for the page lifetime (switching
// language reloads), so these don't need rebuilding per call/point.
const PLAYTHROUGH_LIST_FORMATTER = new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' })
const CHART_DATE_FULL = new Intl.DateTimeFormat(locale())
const CHART_DATE_AXIS = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })

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

// What a run is measured by, per kind of run (see hands' playthroughGroups):
// a free run by the time it took, a strict run by its hit rate — which means
// nothing without the tempo, so its label carries it. Read wherever runs are
// listed, titled or plotted, so a kind is described in one place. A free run's
// label says how clean it was as well: a time alone reads the same for a run
// that stumbled through as for one that didn't.
const RUN_KINDS = {
  free: {
    title: 'score.playtimeEvolution',
    aria: 'score.chartAria',
    value: (pt) => pt.durationMs,
    format: formatDuration,
    label: (pt) => `${formatDuration(pt.durationMs)} (${wrongNotesText(pt.wrongNotes)})`,
    ceiling: Infinity,
  },
  strict: {
    title: 'score.accuracyEvolution',
    aria: 'score.strictChartAria',
    value: (pt) => strictAccuracy(pt.strict),
    format: (pct) => t('score.percent', { pct: Math.round(pct) }),
    label: (pt) => t('score.strictRunSummary', { pct: strictAccuracy(pt.strict), bpm: pt.strict.bpm }),
    ceiling: 100,
  },
}

function runKind(strict) {
  return strict ? RUN_KINDS.strict : RUN_KINDS.free
}

// A strict run's line, from its verdict: the tempo trainer's result lists them.
export function strictRunLabel(verdict) {
  return RUN_KINDS.strict.label({ strict: verdict })
}

// The result modal's ranking: fastest first, the run just played flagged so
// the modal can highlight it. `allPlaythroughs` comes most recent first
// (getAllPlaythroughs), and only the runs comparable with that one are in the
// running — playthroughGroups says which: a right-hand run beats every
// two-hand time on the clock without being the better performance, and a
// strict run's time is the metronome's, not the player's.
export function rankingOf(allPlaythroughs) {
  const mostRecent = allPlaythroughs[0]
  const comparable = playthroughGroups(allPlaythroughs).find((g) => g.playthroughs.includes(mostRecent))
  return (comparable?.playthroughs ?? [])
    .map((pt) => ({ ...pt, isCurrent: pt === mostRecent }))
    .sort((a, b) => a.durationMs - b.durationMs)
}

// Where a run went wrong, by measure number — past a handful of them, only
// how many: a list that long says nothing more.
export function wrongMeasuresText(measures) {
  if (measures.length === 0) return ''
  if (measures.length > WRONG_MEASURES_LISTED) return t('score.wrongMeasuresMany', { n: measures.length })
  const list = PLAYTHROUGH_LIST_FORMATTER.format(measures.map((m) => String(m + 1)))
  return tn('score.wrongMeasures', measures.length, { list })
}

// A day of the history, with a line under it for each kind of run and hand
// selection it holds.
export function withRunLines(day) {
  return { ...day, runLines: playthroughGroups(day.fullPlaythroughs).map((group) => ({ key: group.key, text: playthroughsSummary(group) })) }
}

function playthroughsSummary(group) {
  // Reverse to show chronological order (oldest first)
  const runs = [...group.playthroughs].reverse()
  const list = runs.map(runKind(group.strict).label)
  const summary = t('score.playthroughsSummary', { n: runs.length, list: PLAYTHROUGH_LIST_FORMATTER.format(list) })
  return withRunKind(summary, group)
}

function chartTitle(group) {
  return withRunKind(t(runKind(group.strict).title), group)
}

// One evolution chart per kind of run and hand selection — play time for free
// runs, hit rate for strict ones — each with its `title` and `svg`. A group
// with too few runs to plot simply drops out.
export function playthroughCharts(playthroughs) {
  return playthroughGroups(playthroughs)
    .map((group) => ({ key: group.key, title: chartTitle(group), svg: playthroughChartSvg(group.playthroughs) }))
    .filter((chart) => chart.svg)
}

// Built as a string (not <template x-for>) because Alpine's templates
// render in HTML namespace and won't show up inside <svg>. Returns ''
// when fewer than 2 points — the calling x-if then skips the section.
// Plots what the runs are measured by — they are all of one kind, the
// way playthroughGroups hands them over.
export function playthroughChartSvg(playthroughs) {
  if (playthroughs.length < 2) return ''
  const metric = runKind(playthroughs[0].strict)

  const sorted = [...playthroughs].sort(byStartedAt)
  const values = sorted.map(metric.value)
  const dMin = Math.min(...values)
  const dMax = Math.max(...values)
  // A tenth of the spread of headroom either side; a hit rate stops at 100.
  const yMin = Math.max(0, dMin - (dMax - dMin) * 0.1)
  const yMax = Math.min(metric.ceiling, (dMax + (dMax - dMin) * 0.1) || dMax * 1.1)

  const W = 600
  const H = 200
  const PAD = { top: 12, right: 12, bottom: 28, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  // Evenly spaced by playthrough index: gaps between dates aren't shown.
  const n = sorted.length
  const xScale = (i) => PAD.left + (i / (n - 1)) * innerW
  const yScale = (d) =>
    PAD.top + innerH - ((d - yMin) / (yMax - yMin || 1)) * innerH

  const points = sorted.map((p, i) => ({
    x: xScale(i),
    y: yScale(metric.value(p)),
    label: metric.label(p),
    date: CHART_DATE_FULL.format(new Date(p.startedAt)),
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
  const circles = points
    .map(
      (p) =>
        `<circle cx="${p.x}" cy="${p.y}" r="4" class="chart-point"><title>${p.date} — ${p.label}</title></circle>`,
    )
    .join('')

  return `<svg viewBox="0 0 ${W} ${H}" class="playthrough-chart" role="img" aria-label="${t(metric.aria)}">
    <line x1="${xMin}" x2="${xMax}" y1="${axisY}" y2="${axisY}" class="chart-axis" />
    ${yLabels}
    ${xLabels}
    ${circles}
  </svg>`
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
