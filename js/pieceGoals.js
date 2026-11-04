// What a piece has to offer a player who comes back to it: the status above
// the one it wears and what that still lacks (BWV 847 spent six days one clean
// pass of bar 34 short of Répertoire, with nothing to say so — feedback
// 9e9ca6df), and goals besides, as a video game gives a level several reasons
// to be played again.
//
// A goal is read off the runs in full with both hands, the piece as written,
// and off nothing else: no goal is stored, so the runs already played count,
// and a run taken out of the history takes its stars with it. A star stays
// once earned, being a record: a bad evening costs none.
//
// Pure — an aggregate and runs in, words out; the page holds what is on screen
// (app.js, resultModal.js).
import { nextStatus, statusRules } from './aggregates.js?v=30281db77d3e'
import { byStartedAt, sessionDay } from './days.js?v=30281db77d3e'
import { TWO_HANDS } from './hands.js?v=30281db77d3e'
import { t, tn } from './i18n.js?v=30281db77d3e'
import { wrongNotesText } from './playthroughHistory.js?v=30281db77d3e'
import { statusCriteria } from './statusCriteria.js?v=30281db77d3e'
import { formatDuration } from './utils.js?v=30281db77d3e'

// How much of a run may go wrong for each star of a goal: its share of the
// notes for accuracy, of the attacks for steadiness. Set against the runs played
// on the fourteen pieces most played by October 2026: the first star was within
// reach of twelve of them, the second of two, and no run has earned the third.
const TIERS = [0.05, 0.02, 0]
// The first run of a day, cold, held to the first star's accuracy.
const FIRST_GO_ALLOWANCE = TIERS[0]

const percentOf = (allowance) => Math.round((1 - allowance) * 100)

// What the history's summary says of a piece.
export function pieceFigures(aggregate, practiceTimeMs) {
  return [
    { label: t('goals.figureTime'), value: formatDuration(practiceTimeMs) },
    { label: t('goals.figureRuns'), value: aggregate?.timesCompleted ?? 0 },
    { label: t('goals.figureDays'), value: aggregate?.practiceDays?.length ?? 0 },
  ]
}

// Where a piece stands against the next status, null when there is none above
// it: its rules, how far along each, and a map of the bars there are to play
// (runSize in noteExtraction.js), the closest one short of the mark offered as
// work while the bars are what is missing.
export function statusProgress(aggregate, playableBars) {
  const status = aggregate && nextStatus(aggregate.status)
  if (!status) return null
  const { runs, days, bars } = statusRules(aggregate, status)
  const words = statusCriteria(status)
  const rule = ({ have, need }, text) => ({ text, done: have >= need, progress: `${have}/${need}` })

  const map = playableBars.map((bar) => {
    const clean = aggregate.measures?.[bar]?.cleanAttempts ?? 0
    return {
      bar,
      clean,
      done: clean >= bars.times,
      fill: Math.min(clean / bars.times, 1),
      label: t('goals.barCell', { bar: bar + 1, clean, need: bars.times }),
    }
  })
  const barsRule = rule(bars, words.bars)
  const closest = barsRule.done ? null : map.filter((cell) => !cell.done).sort((a, b) => b.clean - a.clean || a.bar - b.bar)[0]

  return {
    status,
    heading: words.heading,
    bars: barsRule,
    map,
    rules: [rule(runs, words.runs), ...(words.days ? [rule(days, words.days)] : [])],
    closest: closest
      ? { bar: closest.bar, label: t('goals.workBar', { bar: closest.bar + 1, clean: closest.clean, need: bars.times }) }
      : null,
  }
}

// A run a goal reads.
const counts = (run) => run?.hands === TWO_HANDS && !run.strict

// A goal counted in faults over `total` chances of one: the fewest a run took,
// the stars that earns, and how few the next star allows, null when none is left.
function tiered(faults, total) {
  const limits = TIERS.map((allowance) => Math.floor(total * allowance))
  const best = faults.length > 0 ? Math.min(...faults) : null
  const stars = best == null ? 0 : limits.filter((limit) => best <= limit).length
  return { total, best, stars, limit: limits[stars] ?? null }
}

// The days the player ran the piece, and those whose first run held up: the
// one played cold, which says what the day before left in the hands.
function firstGo(runs, notes) {
  const firstOfDay = new Map()
  for (const run of [...runs].sort(byStartedAt)) {
    const day = sessionDay(run)
    if (!firstOfDay.has(day)) firstOfDay.set(day, run)
  }
  const limit = Math.floor(notes * FIRST_GO_ALLOWANCE)
  return { days: firstOfDay.size, done: [...firstOfDay.values()].filter((run) => run.wrongNotes <= limit).length }
}

// The goals of a piece from its runs, in any order, and what a run of it holds
// (runSize in noteExtraction.js). A run from before the pace was judged says
// nothing of its steadiness (playthroughHoles in practiceTime.js).
export function pieceGoals(playthroughs, { notes, attacks }) {
  const runs = playthroughs.filter(counts)
  return {
    accuracy: tiered(runs.map((run) => run.wrongNotes), notes),
    steadiness: tiered(runs.map((run) => run.holes).filter((holes) => holes != null), attacks),
    firstGo: firstGo(runs, notes),
  }
}

// The goals counted in stars, and their faults in words.
const FAULTS_TEXT = {
  accuracy: wrongNotesText,
  steadiness: (n) => (n ? tn('goals.holes', n) : t('goals.noHole')),
}
const TIERED = Object.keys(FAULTS_TEXT)

const starParts = (n) => ['★'.repeat(n), '☆'.repeat(TIERS.length - n)]
const starsText = (n) => starParts(n).join('')

// What the next star allows, in words. Nothing at all reads better than "at
// most none".
function targetText(key, limit) {
  const faults = FAULTS_TEXT[key](limit)
  return limit ? t('goals.atMost', { what: faults }) : faults
}

// A goal as the history shows it: how far the record is from the next star,
// as a meter that fills as the faults come down, the last of them included.
function tieredLine(key, { best, limit, stars }) {
  const [earned, left] = starParts(stars)
  const line = { key, title: t(`goals.${key}`), earned, left, caption: t('goals.record') }
  if (best == null) return { ...line, value: '—', note: t('goals.noRun'), progress: 0 }
  return {
    ...line,
    value: FAULTS_TEXT[key](best),
    note: limit == null ? t('goals.complete') : t('goals.next', { target: targetText(key, limit) }),
    progress: limit == null ? 1 : (limit + 1) / (best + 1),
  }
}

export function goalLines(goals) {
  const { days, done } = goals.firstGo
  return [
    ...TIERED.map((key) => tieredLine(key, goals[key])),
    {
      key: 'firstGo',
      title: t('goals.firstGo'),
      earned: '',
      left: '',
      caption: t('goals.firstGoCaption'),
      value: days > 0 ? tn('goals.firstGoCount', done, { days }) : '—',
      note: t('goals.firstGoRule', { percent: percentOf(FIRST_GO_ALLOWANCE) }),
      progress: days > 0 ? done / days : 0,
    },
  ]
}

export const goalsHint = () => {
  const [one, two, three] = TIERS.map(percentOf)
  return t('goals.hint', { one, two, three })
}

// How far a goal's record is from its next star, as a share of its chances.
const gap = ({ best, limit, total }) => (best - limit) / total

// A goal's stars after the run: those it already had, those the run won, which
// the end of the run draws in, and those still to win.
function earnedLine(key, starsBefore, stars) {
  const [had] = starParts(starsBefore)
  const [all, left] = starParts(stars)
  const won = all.slice(had.length)
  return { key, title: tn('goals.newStar', won.length, { goal: t(`goals.${key}`) }), had, won, left }
}

// The star closest to hand, in words, while one is left to win.
function nextStarText(goals) {
  const [key] = TIERED
    .filter((candidate) => goals[candidate].best != null && goals[candidate].limit != null)
    .sort((a, b) => gap(goals[a]) - gap(goals[b]))
  if (!key) return ''
  const { best, limit, stars } = goals[key]
  return t('goals.nextStar', {
    goal: t(`goals.${key}`),
    stars: starsText(stars + 1),
    target: targetText(key, limit),
    record: FAULTS_TEXT[key](best),
  })
}

// What the run just played did for the goals, for the end of it: the stars it
// earned, or else the star closest to hand. Nothing for a run no goal reads.
// `playthroughs` comes most recent first (getAllPlaythroughs).
export function goalNews(playthroughs, size) {
  const [latest, ...earlier] = playthroughs
  if (!counts(latest)) return { earned: [], next: '' }

  const goals = pieceGoals(playthroughs, size)
  const before = pieceGoals(earlier, size)
  const earned = TIERED
    .filter((key) => goals[key].stars > before[key].stars)
    .map((key) => earnedLine(key, before[key].stars, goals[key].stars))
  if (goals.firstGo.done > before.firstGo.done) {
    earned.push({ key: 'firstGo', title: t('goals.firstGoDone'), had: '', won: starParts(1)[0], left: '' })
  }
  return { earned, next: earned.length > 0 ? '' : nextStarText(goals) }
}
