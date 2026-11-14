#!/usr/bin/env node
// scripts/practice-report.mjs
//
// A player's practice of a score, read back from Supabase down to the key:
// where a run loses its time, which notes come out wrong and as what, and what
// a reinforcement session did to it. The session record keeps a count per bar
// (practiceTracker.js) and says that something went wrong; the note log keeps
// every key (noteLog.js) and says what. This reads the two together — what the
// analyses of Bach's C minor prelude did in October 2026 with scripts that
// lived in a session's scratchpad and left with it.
//
//     node scripts/practice-report.mjs sessions [--score <text>] [--days <n>]
//     node scripts/practice-report.mjs session <session id>
//     node scripts/practice-report.mjs trend --score <text> [--runs <n>]
//     node scripts/practice-report.mjs losses --score <text> [--runs <n>] [--top <n>]
//     node scripts/practice-report.mjs repeats --score <text> [--min <n>]
//     node scripts/practice-report.mjs pace --score <text> [--runs <n>]
//     node scripts/practice-report.mjs halves --score <text> [--runs <n>]
//     node scripts/practice-report.mjs progress --score <text> [--runs <n>] [--before <n>]
//
// `sessions` lists the player's sessions, oldest first, with their ids.
// `session` takes one apart: every bar of a run, every repetition of a drill,
// with its holes and its wrong notes, then where in the bar the time went.
// `trend` sets the score's last runs played in full side by side, bar by bar,
// from the session records alone. `losses` sets the same runs side by side
// by the time each beat of the score lost them, read off the note log the way
// reinforcement ranks what it offers, and ends on what it would offer now.
// `repeats` finds the wrong notes made the same way session after session —
// the same note owed, the same wrong key — which are learnt rather than slips,
// and which repetition does not cure — and when each was last made, which tells
// the ones cured from the ones still there.
//
// `pace` sets the last runs side by side by the pace they held and what their
// faults cost them, all weighed at the pace of the slowest, then the faster
// half against the slower. `halves` compares what the same notes cost the first
// time a bar plays them and the second, in the bars that play them twice.
// `progress` sets each bar in the last runs against the runs before them, beside
// how much it was drilled since, which shows the bars that stayed where they
// were.
//
// Every command reads the player `--player <email>` (default: git's
// user.email) and their profile `--profile` (default `main`), with the token
// scripts/lib/supabase.mjs uses. Times are Paris time. A position in a bar is
// `#n`, its nth attack: #1 is the downbeat, and the interval ending on it is
// the join from the bar before.
//
// ## How a hole is found
//
// By the app's own rule, through public/js/noteLogAnalysis.js, which says how
// attacks and traversals are rebuilt from the log. The score model it reads is
// built here from the file rather than through noteExtraction.js, which needs
// OSMD: keys by fileNumbering(), so that they name the notes the log names, and
// positions from the durations, <backup>s and <forward>s. The tempo a bar is
// judged at is the first one the bar marks, or the one it inherits — the app
// reads OSMD's, per bar too.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileNumbering } from '../public/js/fingeringKeys.js'
import {
  computeSessionDuration,
  median,
  playedInFull,
  playthroughOf,
  sessionAttempts,
} from '../public/js/practiceTime.js'
import {
  atPace,
  attackNumber,
  barsAcross,
  barsPlayed,
  barsRepeatingTheirHalf,
  crotchetsPerMinute,
  eventsOf,
  excess,
  figuresOf,
  halvesOf,
  paceOf,
  roundPosition,
  splitByPace,
  traversals,
} from '../public/js/noteLogAnalysis.js'
import { beatLength, handOfNote, positionsOf } from '../public/js/noteExtraction.js'
import { faultsOf } from '../public/js/fragments.js'
import { judged, reinforcementOffer } from '../public/js/fragmentSuggestions.js'
import { noteLogWindow } from '../public/js/noteLog.js'
import { TWO_HANDS } from '../public/js/hands.js'
import { scoreFile } from './import-fingerings.mjs'
import { die, query, quote } from './lib/supabase.mjs'
import { openScore } from './mxl.mjs'
import {
  PART,
  TIMED_TOKEN,
  measureOf,
  STAVES,
  STAFF,
  VOICE,
  REST,
  GRACE,
  CHORD,
  STEM_UP,
  TIE_START,
  TIE_STOP,
  CUE_OR_HIDDEN,
  DURATION,
  DIVISIONS,
  BEATS,
  BEAT_TYPE,
  TEMPO,
  FERMATA,
  numberOf,
  midiOf,
} from './lib/musicxml.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')


const durationOf = (token, divisions) => parseFloat(DURATION.exec(token)?.[1] ?? '0') / divisions / 4

// The score's notes by fingering key: { bar, staff, position, midi, grace,
// fermata, sounded }, `bar` the source index the key names and `position` in
// whole notes from the bar's start; `sounded` is false for a note no key plays
// — the tied-on half of a tie, a cue or hidden note. Next to them, per source
// bar, how long it is (as far as its notes reach, which a pickup shortens),
// the tempo it is judged at, how long a beat of it is (beatLength, as the app
// reads it), its attack positions in order, which number the `#n`, and the
// notes struck in it with their hand and how long they sound, ties included
// (analysisModel, as the app reads it).
export function scoreModel(xml) {
  const numbering = fileNumbering()
  const notes = new Map()
  const bars = []
  for (const [partXml] of xml.matchAll(PART)) {
    const declared = [...partXml.matchAll(STAVES)].map((match) => parseInt(match[1], 10))
    numbering.part(declared)
    const partStaves = Math.max(1, ...declared.filter(Number.isFinite))
    let divisions = 1
    let tempo = null
    let beat = beatLength()
    let bar = null
    let barIndex = -1
    let tempoMarked = false
    let at = 0
    let onset = 0
    // The struck note each tie under way goes on sounding, by staff and pitch.
    const tied = new Map()
    for (const [token] of partXml.matchAll(TIMED_TOKEN)) {
      if (token.startsWith('<measure')) {
        const { number, implicit } = measureOf(token)
        const { index, continues } = numbering.measure(number, implicit)
        // The second half of a split bar goes on where the first stopped.
        if (!continues) at = 0
        if (index !== barIndex) tempoMarked = false
        barIndex = index
        bar = bars[index] ??= { duration: 0, tempo, beat, struck: [] }
      } else if (token.startsWith('<divisions')) {
        divisions = parseFloat(DIVISIONS.exec(token)[1])
      } else if (token.startsWith('<time')) {
        beat = bar.beat = beatLength({ Numerator: Number(BEATS.exec(token)?.[1]), Denominator: Number(BEAT_TYPE.exec(token)?.[1]) })
      } else if (token.startsWith('<sound')) {
        tempo = parseFloat(TEMPO.exec(token)[1])
        if (!tempoMarked) bar.tempo = tempo
        tempoMarked = true
      } else if (token.startsWith('<backup')) {
        at -= durationOf(token, divisions)
      } else if (token.startsWith('<forward')) {
        at += durationOf(token, divisions)
      } else {
        const grace = GRACE.test(token)
        const chord = CHORD.test(token)
        const start = chord ? onset : at
        const length = durationOf(token, divisions)
        if (!chord) {
          onset = at
          if (!grace) at += length
        }
        bar.duration = Math.max(bar.duration, roundPosition(at))
        if (REST.test(token)) continue
        const { key, staff } = numbering.note(numberOf(token, STAFF), numberOf(token, VOICE))
        const tieStop = TIE_STOP.test(token)
        const sounded = !tieStop && !CUE_OR_HIDDEN.test(token)
        const position = roundPosition(start)
        const midi = midiOf(token)
        notes.set(key, { bar: barIndex, staff, position, midi, grace, fermata: FERMATA.test(token), sounded })
        if (grace) continue
        const pitch = `${staff}:${midi}`
        let held = tied.get(pitch)
        if (held && tieStop) held.until += length
        else if (sounded) {
          const inPart = numberOf(token, STAFF) - 1
          const innerStaff = inPart > 0 && inPart < partStaves - 1
          held = { position, until: position + length, hand: handOfNote({ staffIndex: staff, innerStaff, stemUp: STEM_UP.test(token) }) }
          bar.struck.push(held)
        }
        if (TIE_START.test(token)) tied.set(pitch, held)
        else tied.delete(pitch)
      }
    }
  }
  for (const bar of bars) bar.positions = positionsOf(bar.struck)
  return { notes, bars }
}

// How the `#n` of an attack prints: the interval ending on #1 is the join.
const positionLabel = (n) => (n === 1 ? 'join' : `#${n}`)

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
const hand = (staff) => (staff === 0 ? 'RH' : staff === 1 ? 'LH' : `staff${staff + 1}`)

const totalExcess = (attacks) => attacks.reduce((total, a) => total + excess(a), 0)

// --- Supabase ---------------------------------------------------------------

// The rows of the player's profile, in a table aliased `alias`.
const ownedBy = (player, alias) =>
  `${alias}.user_id = (select id from auth.users where email = ${quote(player.email)}) and ${alias}.profile_id = ${quote(player.profile)}`

async function sessionsOf(player, { score, days, id }) {
  return query(`
    select t.id, t.data from public.training_sessions t
    where ${ownedBy(player, 't')}
      ${score ? `and t.data->>'scoreId' ilike ${quote(`%${score}%`)}` : ''}
      ${days ? `and t.ended_at > now() - interval '${Number(days)} days'` : ''}
      ${id ? `and t.id = ${quote(id)}` : ''}
    order by t.ended_at`)
}

// Note log segments, with the score their session was played on: one
// session's, or every one of a score's — each in the shape noteLog.js wrote it,
// its columns beside its startedAt, as eventsOf() reads it.
async function segmentsOf(player, { score, days, id }) {
  const rows = await query(`
    select n.session_id as "sessionId", (extract(epoch from n.started_at) * 1000)::float8 as "startedAt", n.data,
      t.data->>'scoreId' as "scoreId"
    from public.session_notes n join public.training_sessions t on t.user_id = n.user_id and t.id = n.session_id
    where ${ownedBy(player, 'n')}
      ${score ? `and t.data->>'scoreId' ilike ${quote(`%${score}%`)}` : ''}
      ${days ? `and t.ended_at > now() - interval '${Number(days)} days'` : ''}
      ${id ? `and n.session_id = ${quote(id)}` : ''}
    order by n.started_at`)
  return rows.map(({ data, ...row }) => ({ ...row, ...data }))
}

const models = new Map()
function modelOf(scoreId) {
  const file = scoreFile(scoreId) ?? die(`no score file in ${scoreId}`)
  if (!models.has(file)) models.set(file, scoreModel(openScore(readFileSync(join(PUBLIC_DIR, 'scores', file))).xml))
  return models.get(file)
}

// --- Output -----------------------------------------------------------------

const PARIS = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' })
const when = (ms) => PARIS.format(new Date(ms))
const clock = (ms) => when(ms).slice(11)
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`
const minutes = (ms) => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const columns = (cells) => cells.map((cell) => String(cell).padStart(7)).join('')
// Rows of numbers added up, field by field.
const sumFields = (rows) =>
  Object.fromEntries(Object.keys(rows[0]).map((field) => [field, rows.reduce((total, row) => total + row[field], 0)]))

// A session, with the practice time the journal credits it.
const sessionHeading = (session) =>
  `${when(Date.parse(session.startedAt))}  ${session.mode.padEnd(8)} ${minutes(computeSessionDuration(session)).padStart(6)}`

function listSessions(rows) {
  if (rows.length === 0) console.log('no session in that range')
  for (const { id, data } of rows) {
    const attempts = sessionAttempts(data)
    const sum = (field) => attempts.reduce((total, a) => total + a[field], 0)
    const joins = attempts.filter((a) => a.joined)
    console.log(
      `${sessionHeading(data)}  ` +
        `${String(data.measures.length).padStart(3)} bars ${String(attempts.length).padStart(4)} attempts  ` +
        `${String(sum('wrongNotes')).padStart(3)} wrong ${String(sum('hesitations')).padStart(3)} holes` +
        (joins.length ? `  ${joins.filter((a) => a.entryHole).length}/${joins.length} joins holed` : '') +
        `  ${data.scoreTitle}  ${id}`,
    )
  }
}

const holeLabel = (attack, model) =>
  `${positionLabel(attackNumber(model, attack.sourceBar, attack.position))} ${seconds(attack.ms)} ×${attack.ratio.toFixed(1)}`

// One line per bar a traversal went through: how long it took — from its
// downbeat to the next bar's — its holes, and its wrong notes.
function barLines(run, model, prefix = '') {
  return barsPlayed(run).map(({ bar, sourceBar, attacks, ms }) => {
    const holes = attacks.filter((a) => a.hole)
    const wrong = wrongLabels(run, bar, attacks, model)
    const label = `${prefix}bar ${String(sourceBar + 1).padStart(3)} ${seconds(ms).padStart(6)}`
    return (
      label +
      (holes.length ? `  holes: ${holes.map((a) => holeLabel(a, model)).join(', ')}` : '') +
      (wrong.length ? `  wrong: ${wrong.join('; ')}` : '')
    )
  })
}

// A bar's wrong keys, by the attack they were owed for: its `#n`, how long the
// interval they fell in took — which no hole counts, the time being the
// mistake's — then per note owed, the keys played instead.
function wrongLabels(run, bar, attacks, model) {
  const byAttack = Map.groupBy(
    run.wrong.filter((w) => w.bar === bar),
    (w) => model.notes.get(w.key).position,
  )
  return [...byAttack].map(([position, wrong]) => {
    const attack = attacks.find((a) => a.position === position && !a.grace)
    const owed = [...Map.groupBy(wrong, (w) => w.key)].map(([key, played]) => {
      const note = model.notes.get(key)
      return `${hand(note.staff)} ${noteName(note.midi)}→${played.map((w) => noteName(w.pitch)).join(' ')}`
    })
    const took = attack?.faulted ? ` (${seconds(attack.ms)})` : ''
    return `#${attackNumber(model, attacks[0].sourceBar, position)}${took} ${owed.join(', ')}`
  })
}

// Where in the bar a session's time went: excess over the pace by `#n`, the
// share the bar lines took, the joins that were holes.
function summary(runs, model) {
  const attacks = runs.flatMap((r) => r.attacks)
  const judged = attacks.filter((a) => a.ratio != null && !a.grace)
  if (judged.length === 0) return
  const lost = totalExcess(judged)
  const faulted = attacks.filter((a) => a.faulted)
  console.log(
    `\n${judged.filter((a) => a.hole).length} holes; ${seconds(lost)} over the pace in all, ` +
      `median interval ${Math.round(median(judged.map((a) => a.ms)))} ms; ` +
      `${faulted.length} intervals with a wrong note took ${seconds(faulted.reduce((total, a) => total + a.ms, 0))}`,
  )
  const byAttack = new Map()
  for (const a of judged) {
    const at = attackNumber(model, a.sourceBar, a.position)
    byAttack.set(at, (byAttack.get(at) ?? 0) + excess(a))
  }
  const ranked = [...byAttack].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(
    'over the pace by position in the bar: ' +
      ranked.map(([at, ms]) => `${positionLabel(at)} ${seconds(ms)} (${Math.round((100 * ms) / lost)}%)`).join('  '),
  )
  const holedJoins = judged.filter((a) => a.entry && a.hole)
  if (holedJoins.length) {
    console.log(
      `joins that were holes: ${holedJoins.map((a) => `→${a.sourceBar + 1} ${seconds(a.ms)} ×${a.ratio.toFixed(1)}`).join(', ')}`,
    )
  }
}

const ONE_HAND = { right: 'right hand  ', left: 'left hand  ' }

async function showSession(player, id) {
  const [[row], segments] = await Promise.all([sessionsOf(player, { id }), segmentsOf(player, { id })])
  if (!row) die(`no session ${id} for ${player.email}`)
  const session = row.data
  console.log(`${session.scoreTitle} — ${sessionHeading(session)}`)
  if (segments.length === 0) {
    console.log('no note log for this session (it predates it, or never reached the server)')
    return
  }
  const model = modelOf(session.scoreId)
  const runs = traversals(eventsOf(segments), model)
  for (const run of runs) {
    const start = run.attacks[0].at
    const bars = new Set(run.attacks.map((a) => a.bar)).size
    // Played in block chords, a beat at a time (musicxml.js): its attacks'
    // `#n` are those of the notes its beats start on. With one hand, as a
    // drill takes a passage on its way up (ladder.js), it says which.
    const heading = `${clock(start)}  ${ONE_HAND[run.hands] ?? ''}${run.blockChords ? 'block chords  ' : ''}`
    // The tempo it held from its first attack to its last, which a drill
    // weighs a repetition by where it asks for one.
    const tempo = run.meanPace ? `crotchet ${crotchetsPerMinute(run.meanPace)}` : ''
    if (bars === 1) {
      console.log(`${barLines(run, model, heading)[0]}${tempo && `  ${tempo}`}`)
      continue
    }
    console.log(
      `\n${heading}${bars} bars in ${minutes(run.attacks.at(-1).at - start)}, ${seconds(totalExcess(run.attacks))} over the pace${tempo && `, ${tempo}`}`,
    )
    for (const line of barLines(run, model, '  ')) console.log(line)
  }
  summary(runs, model)
}

// The last `count` of these sessions to hold a run played in full.
const lastFullRuns = (sessions, count) => sessions.filter(playedInFull).slice(-count)

// A run's column heading: when it began.
const runDate = (session) => when(Date.parse(session.startedAt)).slice(5, 16)

// The score's last `count` runs played in full, bar by bar: the run's time as
// the score's history shows it, then the last attempt at each bar in the run —
// its time, wrong notes (w), holes (h), and its join (J, J! when it was a
// hole, ×ratio).
function showTrend(rows, count) {
  const runs = lastFullRuns(rows.map((r) => r.data), count)
  if (runs.length === 0) die('no run played in full in that range')
  const cell = (a) => {
    if (!a) return '-'
    let text = seconds(a.durationMs)
    if (a.wrongNotes) text += ` w${a.wrongNotes}`
    if (a.hesitations) text += ` h${a.hesitations}`
    if (a.joined) text += ` J${a.entryHole ? '!' : ''}${a.entryRatio ?? ''}`
    return text
  }
  const width = 16
  const lastPerBar = runs.map((session) => {
    const run = sessionAttempts(session, Date.parse(session.playthroughStartedAt), Date.parse(session.completedAt))
    return new Map(run.map((a) => [a.sourceMeasureIndex, a]))
  })
  const barCount = Math.max(...lastPerBar.map((bars) => Math.max(...bars.keys()) + 1))
  console.log(`${runs[0].scoreTitle}: the last ${runs.length} runs played in full`)
  console.log(`bar  ${runs.map((s) => runDate(s).padEnd(width)).join('')}`)
  console.log(`time ${runs.map((s) => minutes(playthroughOf(s).durationMs).padEnd(width)).join('')}`)
  for (let bar = 0; bar < barCount; bar++) {
    console.log(
      `${String(bar + 1).padStart(3)}  ${lastPerBar.map((bars) => cell(bars.get(bar)).padEnd(width)).join('')}`,
    )
  }
}

// A spot, a beat of a bar, as `losses` prints it: `31 t1`.
const spotLabel = ({ bar, beat }) => `${bar + 1} t${beat + 1}`

// A fragment reinforcement offers, from the first beat it plays to the last:
// both its ends fall on a beat.
function fragmentLabel({ from, until }, { bars }) {
  const beats = ({ bar, position }) => Math.round(position / bars[bar].beat)
  return `${spotLabel({ bar: from.bar, beat: beats(from) })} – ${spotLabel({ bar: until.bar, beat: beats(until) - 1 })}`
}

// The score's last `count` runs played in full that have a note log, as
// { session, run }: a run played in full is its session's longest traversal.
// With them, the model they are read by, and the traversals of any session.
function loggedRuns(rows, segments, count) {
  const sessions = rows.map((r) => r.data)
  const bySession = Map.groupBy(segments, (s) => s.sessionId)
  const logged = lastFullRuns(sessions.filter((s) => bySession.has(s.id)), count)
  if (logged.length === 0) die('no run played in full has a note log')
  const model = modelOf(logged[0].scoreId)
  const traversalsOf = (session) => judged(bySession.get(session.id) ?? [], session, model)
  const runs = logged.map((session) => ({
    session,
    run: traversalsOf(session).reduce((a, b) => (b.attacks.length > a.attacks.length ? b : a)),
  }))
  return { sessions, runs, model, traversalsOf }
}

// Logged runs (loggedRuns) by the time each spot lost them (faultsOf,
// fragments.js — what reinforcement ranks the spots it offers by): the time
// each run lost in all, then the `top` spots that lost the most over them, run
// by run and each at its own pace (`progress` weighs bars at one). Then what
// reinforcement would offer now (reinforcementOffer, fragmentSuggestions.js).
function showLosses({ sessions, runs, model, traversalsOf }, top) {
  const losses = runs.map(({ run }) => {
    const bySpot = new Map([...faultsOf(run, model).values()].map(({ spot, lost }) => [spotLabel(spot), lost]))
    return { bySpot, lost: [...bySpot.values()].reduce((total, ms) => total + ms, 0) }
  })

  const totals = new Map()
  for (const { bySpot } of losses) for (const [id, ms] of bySpot) totals.set(id, (totals.get(id) ?? 0) + ms)
  const ranked = [...totals].sort((a, b) => b[1] - a[1]).slice(0, top)
  const width = 13
  const cell = (ms) => (ms ? seconds(ms) : '-').padStart(width)
  console.log(`${runs[0].session.scoreTitle}: time lost in the last ${runs.length} runs played in full, by beat`)
  console.log(`spot    ${runs.map(({ session }) => runDate(session).padStart(width)).join('')}`)
  console.log(`all     ${losses.map((r) => cell(r.lost)).join('')}`)
  for (const [id, total] of ranked) {
    console.log(`${id.padEnd(8)}${losses.map((r) => cell(r.bySpot.get(id))).join('')}   ${seconds(total)} in all`)
  }

  const offered = reinforcementOffer(noteLogWindow(sessions).flatMap(traversalsOf), sessions, model, TWO_HANDS)
  // A passage the runs mostly stalled on at the bar line is the one the drill
  // advises block chords on, where they suit it (musicxml.js).
  // With the tempo its drill asks it for once built, in crotchets a minute:
  // the pace the runs held around it (paceToHold in fragments.js).
  const tempo = (f) => (f.pace ? ` at ${crotchetsPerMinute(f.pace)}` : '')
  const offer = (f) => `${fragmentLabel(f, model)}${tempo(f)}${f.stalledAtBarLine ? ' (stalls at the bar line)' : ''}`
  console.log(`\nreinforcement offers now, both hands: ${offered.map(offer).join(', ') || 'nothing'}`)
}

// The wrong notes made the same way in at least `min` sessions: the owed note,
// the key played instead, in how many sessions, how many times and when last.
function showRepeats(segments, min) {
  const seen = new Map()
  for (const segment of segments) {
    const model = modelOf(segment.scoreId)
    for (const event of eventsOf([segment])) {
      if (event.code !== 'w' || !model.notes.has(event.key)) continue
      const id = `${segment.scoreId}>${event.key}>${event.pitch}`
      const entry = seen.get(id) ?? { event, model, sessions: new Set(), times: 0 }
      entry.sessions.add(segment.sessionId)
      entry.times++
      entry.last = event.at
      seen.set(id, entry)
    }
  }
  const logged = new Set(segments.map((s) => s.sessionId)).size
  console.log(`wrong notes made the same way in ${min} or more of the ${logged} sessions with a note log:`)
  const repeated = [...seen.values()]
    .filter((e) => e.sessions.size >= min)
    .sort((a, b) => b.sessions.size - a.sessions.size || b.times - a.times)
  for (const { event, model, sessions, times, last } of repeated) {
    const owed = model.notes.get(event.key)
    const label = `${hand(owed.staff)}#${attackNumber(model, owed.bar, owed.position)} ${noteName(owed.midi)}→${noteName(event.pitch)}`
    console.log(
      `  bar ${String(owed.bar + 1).padStart(3)} ${label.padEnd(18)} ${sessions.size} sessions, ${times} times, last ${when(last).slice(5, 10)}`,
    )
  }
  if (repeated.length === 0) console.log('  none')
}


// The pace of the slowest of some logged runs, which they are all weighed at.
const slowestPace = (runs) => Math.max(...runs.map(({ run }) => paceOf(run)))

// Logged runs by the pace they held: how long each took, at what crotchet, the
// holes the app judged at that pace, then what its faults cost with every run
// weighed at the pace of the slowest (atPace, noteLogAnalysis.js), and last the
// faster half against the slower (splitByPace).
function showPace({ runs }) {
  const slowest = slowestPace(runs)
  const figures = runs.map(({ session, run }) => ({
    time: playthroughOf(session).durationMs,
    pace: paceOf(run),
    ownHoles: figuresOf(run).holes,
    ...figuresOf(atPace(run, slowest)),
  }))
  const line = (label, { time, pace, ownHoles, holes, lost, cleanBars, wrongAttacks, wrongKeys }) =>
    label.padEnd(13) + columns([minutes(time), crotchetsPerMinute(pace), ownHoles, holes, seconds(lost), cleanBars, wrongAttacks, wrongKeys])
  console.log(`${runs[0].session.scoreTitle}: the last ${runs.length} runs played in full, by the pace they held`)
  console.log(
    `own: holes at the run's own pace, as the app judged them. holes, lost, clean: as if every run had held the ` +
      `slowest crotchet here, ${crotchetsPerMinute(slowest)}. wrong: attacks a wrong key fell on. keys: those keys. ` +
      'clean: bars with neither a hole nor a wrong key.',
  )
  console.log(''.padEnd(13) + columns(['time', 'crotch', 'own', 'holes', 'lost', 'clean', 'wrong', 'keys']))
  runs.forEach(({ session }, i) => console.log(line(runDate(session), figures[i])))
  const split = splitByPace(figures)
  if (split) {
    console.log(line('faster half', split.faster))
    console.log(line('slower half', split.slower))
  }
}

// Consecutive bars as a range, by the number the score shows: 1–24, 26.
function barRanges(bars) {
  const ranges = []
  for (const bar of bars) {
    const last = ranges.at(-1)
    if (last && last[1] === bar - 1) last[1] = bar
    else ranges.push([bar, bar])
  }
  return ranges.map(([from, to]) => (from === to ? `${from + 1}` : `${from + 1}–${to + 1}`)).join(', ')
}

// What the same notes cost logged runs the first time a bar plays them and the
// second (halvesOf, noteLogAnalysis.js).
function showHalves({ runs, model }) {
  const repeating = [...barsRepeatingTheirHalf(model)].sort((a, b) => a - b)
  console.log(`${runs[0].session.scoreTitle}: the same notes the first time and the second, in the last ${runs.length} runs played in full`)
  if (repeating.length === 0) {
    console.log('no bar of this score plays its first half twice')
    return
  }
  console.log(
    `bars that play them twice: ${barRanges(repeating)}. #n counts from the start of each half; ` +
      '#1 the first time is the join. wrong: attacks a wrong key fell on.',
  )
  const counts = ({ holes, lost, wrongAttacks }) => columns([holes, seconds(lost), wrongAttacks])
  const heading = columns(['holes', 'lost', 'wrong'])
  console.log(`${''.padEnd(6)}${'first time'.padEnd(23)}  second time`)
  console.log(`${''.padEnd(6)}${heading}  ${heading}`)
  const halves = halvesOf(runs.map(({ run }) => run), model)
  for (const { number, first, second } of halves) {
    console.log(`${`#${number}`.padEnd(6)}${counts(first)}  ${counts(second)}`)
  }
  const all = (side) => sumFields(halves.map((row) => row[side]))
  console.log(`${'all'.padEnd(6)}${counts(all('first'))}  ${counts(all('second'))}`)
}

// Each bar in the last `count` of some logged runs against the runs before
// them (barsAcross, noteLogAnalysis.js): its median time, how that changed, by
// itself and against the whole run, then what its faults cost per run, weighed
// at the pace of the slowest run so that going faster does not read as
// stumbling more (atPace), and last the attempts at it in the drills between
// the two (sessionAttempts, which a drill with no note log has too).
function showProgress({ sessions, runs: all }, count) {
  const before = all.slice(0, -count)
  const last = all.slice(-count)
  if (before.length === 0) die(`no run played in full before the last ${count}`)
  const slowest = slowestPace(all)
  const across = (group) => barsAcross(group.map(({ run }) => atPace(run, slowest)))
  const [was, is] = [across(before), across(last)]
  const [since, until] = [before.at(-1), last.at(-1)].map(({ session }) => Date.parse(session.startedAt))
  const drills = Map.groupBy(
    sessions.filter((s) => s.mode === 'training').flatMap((s) => sessionAttempts(s, since, until)),
    (attempt) => attempt.sourceMeasureIndex,
  )
  const bars = [...is.keys()].filter((bar) => was.has(bar)).sort((a, b) => a - b)
  const whole = (byBar) => sumFields(bars.map((bar) => byBar.get(bar)))
  const change = (then, now) => Math.round((100 * (now.ms - then.ms)) / then.ms)
  const percent = (points) => `${points > 0 ? '+' : ''}${points}%`
  const line = (label, then, now, attempts) =>
    label.padEnd(5) +
    columns([
      seconds(then.ms),
      seconds(now.ms),
      percent(change(then, now)),
      percent(change(then, now) - change(whole(was), whole(is))),
      then.holes.toFixed(1),
      now.holes.toFixed(1),
      seconds(then.lost),
      seconds(now.lost),
      then.wrongAttacks.toFixed(1),
      now.wrongAttacks.toFixed(1),
      attempts,
    ])
  console.log(
    `${last[0].session.scoreTitle}: each bar in the last ${last.length} runs played in full, from ${runDate(last[0].session)}, ` +
      `against the ${before.length} before them, from ${runDate(before[0].session)}`,
  )
  console.log(
    `Each pair is those runs, then the last ones. vs all: the change against the whole run's. holes, lost and wrong ` +
      `(attacks a wrong key fell on) are per run, as if every run had held crotchet ${crotchetsPerMinute(slowest)}. ` +
      'drills: attempts at the bar in the drills between the two.',
  )
  console.log(''.padEnd(5) + columns(['time', 'now', 'change', 'vs all', 'holes', 'now', 'lost', 'now', 'wrong', 'now', 'drills']))
  for (const bar of bars) console.log(line(String(bar + 1), was.get(bar), is.get(bar), drills.get(bar)?.length ?? 0))
  console.log(line('all', whole(was), whole(is), ''))
}

// --- Command line -----------------------------------------------------------

const USAGE = `usage: node scripts/practice-report.mjs <command> [--player <email>] [--profile <id>]
  sessions [--score <text>] [--days <n>, default 30]
  session <session id>
  trend --score <text> [--runs <n>]
  losses --score <text> [--runs <n>] [--top <n>, default 15]
  repeats --score <text> [--min <n>] [--days <n>]
  pace --score <text> [--runs <n>]
  halves --score <text> [--runs <n>]
  progress --score <text> [--runs <n>] [--before <n>, default as many]`

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      player: { type: 'string' },
      profile: { type: 'string', default: 'main' },
      score: { type: 'string' },
      days: { type: 'string' },
      runs: { type: 'string', default: '8' },
      before: { type: 'string' },
      min: { type: 'string', default: '3' },
      top: { type: 'string', default: '15' },
      help: { type: 'boolean' },
    },
  })
  const [command, id] = positionals
  if (values.help || !command) {
    console.log(USAGE)
    return
  }
  const email = values.player ?? execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim()
  const player = { email, profile: values.profile }
  const score = () => values.score ?? die(`${command} needs --score\n${USAGE}`)
  const runs = Number(values.runs)
  const logged = async (count = runs) => {
    const [rows, segments] = await Promise.all([sessionsOf(player, { score: score() }), segmentsOf(player, { score: score() })])
    return loggedRuns(rows, segments, count)
  }

  if (command === 'sessions') listSessions(await sessionsOf(player, { score: values.score, days: values.days ?? '30' }))
  else if (command === 'session') await showSession(player, id ?? die(USAGE))
  else if (command === 'trend') showTrend(await sessionsOf(player, { score: score() }), runs)
  else if (command === 'losses') showLosses(await logged(), Number(values.top))
  else if (command === 'pace') showPace(await logged())
  else if (command === 'halves') showHalves(await logged())
  else if (command === 'progress') showProgress(await logged(runs + Number(values.before ?? runs)), runs)
  else if (command === 'repeats')
    showRepeats(await segmentsOf(player, { score: score(), days: values.days }), Number(values.min))
  else die(USAGE)
}

if (process.argv[1] === import.meta.filename) await main(process.argv.slice(2))
