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
//     node scripts/practice-report.mjs repeats --score <text> [--min <n>]
//
// `sessions` lists the player's sessions, oldest first, with their ids.
// `session` takes one apart: every bar of a run, every repetition of a drill,
// with its holes and its wrong notes, then where in the bar the time went.
// `trend` sets the score's last runs played in full side by side, bar by bar,
// from the session records alone. `repeats` finds the wrong notes made the
// same way session after session — the same note owed, the same wrong key —
// which are learnt rather than slips, and which repetition does not cure.
//
// Every command reads the player `--player <email>` (default: git's
// user.email) and their profile `--profile` (default `main`), with the token
// scripts/lib/supabase.mjs uses. Times are Paris time. A position in a bar is
// `#n`, its nth attack: #1 is the downbeat, and the interval ending on it is
// the join from the bar before.
//
// ## How a hole is found
//
// By the app's own rule: the attacks of the log are fed to createSteadiness()
// (steadiness.js), which judges them as the score page did while they were
// played. An attack is a moment of the score — the notes of one position in
// one bar, both hands on a beat — completed by the last of its keys to come
// down, as in registerAttack() (musicxml.js); a wrong key spoils the interval
// it falls in. A traversal, a run or a repetition, starts over where the
// attacks go back in the score or skip ahead. That is read off the attacks
// alone: a bar clicked or a hand toggled, which make the app start its count
// over, leave nothing in the log to say so.
//
// The score is read from the file rather than through noteExtraction.js,
// which needs OSMD: keys by fileNumbering(), so that they name the notes the
// log names, and positions from the durations, <backup>s and <forward>s. The
// tempo a bar is judged at is the first one the bar marks, or the one it
// inherits — the app reads OSMD's, per bar too.
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
import { createSteadiness } from '../public/js/steadiness.js'
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
  TIE_STOP,
  CUE_OR_HIDDEN,
  DURATION,
  DIVISIONS,
  TEMPO,
  FERMATA,
  numberOf,
  midiOf,
} from './lib/musicxml.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

// Positions are sums of fractions: rounded before two are compared, so that
// both hands on a beat are one attack.
const exact = (wholeNotes) => Math.round(wholeNotes * 1e6) / 1e6

const durationOf = (token, divisions) => parseFloat(DURATION.exec(token)?.[1] ?? '0') / divisions / 4

// The score's notes by fingering key: { bar, staff, position, midi, grace,
// fermata, sounded }, `bar` the source index the key names and `position` in
// whole notes from the bar's start; `sounded` is false for a note no key plays
// — the tied-on half of a tie, a cue or hidden note. Next to them, per source
// bar, how long it is (as far as its notes reach, which a pickup shortens),
// the tempo it is judged at, and its attack positions in order, which number
// the `#n`.
export function scoreModel(xml) {
  const numbering = fileNumbering()
  const notes = new Map()
  const bars = []
  for (const [partXml] of xml.matchAll(PART)) {
    numbering.part([...partXml.matchAll(STAVES)].map((match) => parseInt(match[1], 10)))
    let divisions = 1
    let tempo = null
    let bar = null
    let barIndex = -1
    let tempoMarked = false
    let at = 0
    let onset = 0
    for (const [token] of partXml.matchAll(TIMED_TOKEN)) {
      if (token.startsWith('<measure')) {
        const { number, implicit } = measureOf(token)
        const { index, continues } = numbering.measure(number, implicit)
        // The second half of a split bar goes on where the first stopped.
        if (!continues) at = 0
        if (index !== barIndex) tempoMarked = false
        barIndex = index
        bar = bars[index] ??= { duration: 0, tempo, positions: new Set() }
      } else if (token.startsWith('<divisions')) {
        divisions = parseFloat(DIVISIONS.exec(token)[1])
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
        if (!chord) {
          onset = at
          if (!grace) at += durationOf(token, divisions)
        }
        bar.duration = Math.max(bar.duration, exact(at))
        if (REST.test(token)) continue
        const { key, staff } = numbering.note(numberOf(token, STAFF), numberOf(token, VOICE))
        const sounded = !TIE_STOP.test(token) && !CUE_OR_HIDDEN.test(token)
        const position = exact(start)
        notes.set(key, {
          bar: barIndex,
          staff,
          position,
          midi: midiOf(token),
          grace,
          fermata: FERMATA.test(token),
          sounded,
        })
        if (sounded && !grace) bar.positions.add(position)
      }
    }
  }
  for (const bar of bars) bar.positions = [...bar.positions].sort((a, b) => a - b)
  return { notes, bars }
}

// The `#n` of a position in a source bar, 1-based, and how it prints: the
// interval ending on #1 is the join from the bar before.
const attackNumber = (model, bar, position) => model.bars[bar].positions.indexOf(position) + 1
const positionLabel = (n) => (n === 1 ? 'join' : `#${n}`)

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
const hand = (staff) => (staff === 0 ? 'RH' : staff === 1 ? 'LH' : `staff${staff + 1}`)

// A session's note log as one list of events in time order: { at (epoch ms),
// code, pitch, key, bar }, `bar` the playback index — the columns of noteLog.js
// put back together, segment by segment.
export function eventsOf(segments) {
  const events = []
  for (const { startedMs, data } of segments) {
    for (let i = 0; i < data.e.length; i++) {
      events.push({
        at: startedMs + data.t[i],
        code: data.e[i],
        pitch: data.p[i],
        key: data.n[i] >= 0 ? data.keys[data.n[i]] : null,
        bar: data.b[i],
      })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

// Back by more than this share of a bar, the player has started over; a hand
// a note late over a bar line goes back by much less.
const RESTART = 0.25

// The log cut into traversals, each judged by the app's rule: per traversal,
// its attacks in score order — { bar (playback), sourceBar, position, at,
// hole, entry, joined, ratio, ms, faulted } — and the wrong keys played during
// it, { at, bar, key, pitch }.
export function traversals(events, model) {
  const runs = []
  let run = null
  let last = -Infinity
  let lastBar = -Infinity
  for (const event of events) {
    const note = event.key && model.notes.get(event.key)
    if (!note || event.bar < 0) continue
    if (event.code === 'w') {
      run?.wrong.push(event)
      continue
    }
    if (event.code !== 'd') continue
    const where = event.bar + note.position / (model.bars[note.bar].duration || 1)
    if (!run || where < last - RESTART || event.bar > lastBar + 1) runs.push((run = { attacks: new Map(), wrong: [] }))
    last = where
    lastBar = event.bar
    const id = `${event.bar}@${note.position}${note.grace ? 'g' : ''}`
    let attack = run.attacks.get(id)
    if (!attack) {
      attack = {
        bar: event.bar,
        sourceBar: note.bar,
        position: note.position,
        grace: note.grace,
        fermata: note.fermata,
        hole: false,
        at: 0,
      }
      run.attacks.set(id, attack)
    }
    // Completed by the last of its keys to come down — the last time, when
    // the engine took one again after a wrong note: the run went on from there.
    attack.at = Math.max(attack.at, event.at)
    attack.fermata ||= note.fermata
  }
  return runs.map((r) => judge(r, model))
}

function judge({ attacks, wrong }, model) {
  const ordered = [...attacks.values()].sort((a, b) => a.bar - b.bar || a.position - b.position || a.grace - b.grace)
  const steadiness = createSteadiness()
  const apply = (verdicts) => {
    for (const { ref, ratio, hole, entry, joined } of verdicts) {
      ref.ratio = ratio
      ref.hole ||= hole
      ref.entry ||= entry
      ref.joined ||= joined
    }
  }
  let previous = null
  for (const attack of ordered) {
    if (previous) {
      attack.ms = attack.at - previous.at
      if (wrong.some((w) => w.at > previous.at && w.at <= attack.at)) {
        steadiness.fault()
        attack.faulted = true
      }
    }
    const bar = model.bars[attack.sourceBar]
    apply(
      steadiness.attack({
        at: attack.at,
        measure: attack.bar,
        position: attack.position,
        measureDuration: bar.duration,
        tempo: bar.tempo,
        decorative: attack.grace,
        fermata: attack.fermata,
        ref: attack,
      }),
    )
    previous = attack
  }
  apply(steadiness.close())
  return { attacks: ordered, wrong }
}

// How much longer than the pace an interval took, in ms: what it would have
// lasted at the reference the verdict weighed it against, subtracted. Nothing
// for an interval never judged.
const excess = ({ ms, ratio }) => (ratio > 1 ? ms - ms / ratio : 0)
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
// session's, or every one of a score's.
async function segmentsOf(player, { score, days, id }) {
  return query(`
    select n.session_id as "sessionId", (extract(epoch from n.started_at) * 1000)::float8 as "startedMs", n.data,
      t.data->>'scoreId' as "scoreId"
    from public.session_notes n join public.training_sessions t on t.user_id = n.user_id and t.id = n.session_id
    where ${ownedBy(player, 'n')}
      ${score ? `and t.data->>'scoreId' ilike ${quote(`%${score}%`)}` : ''}
      ${days ? `and t.ended_at > now() - interval '${Number(days)} days'` : ''}
      ${id ? `and n.session_id = ${quote(id)}` : ''}
    order by n.started_at`)
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
  const byBar = Map.groupBy(run.attacks, (a) => a.bar)
  const bars = [...byBar.keys()]
  return bars.map((bar, i) => {
    const attacks = byBar.get(bar)
    const next = byBar.get(bars[i + 1])
    const end = next && bars[i + 1] === bar + 1 ? next[0].at : attacks.at(-1).at
    const holes = attacks.filter((a) => a.hole)
    const wrong = wrongLabels(run, bar, attacks, model)
    const label = `${prefix}bar ${String(attacks[0].sourceBar + 1).padStart(3)} ${seconds(end - attacks[0].at).padStart(6)}`
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
    if (bars === 1) {
      console.log(barLines(run, model, `${clock(start)}  `)[0])
      continue
    }
    console.log(
      `\n${clock(start)}  ${bars} bars in ${minutes(run.attacks.at(-1).at - start)}, ${seconds(totalExcess(run.attacks))} over the pace`,
    )
    for (const line of barLines(run, model, '  ')) console.log(line)
  }
  summary(runs, model)
}

// The score's last `count` runs played in full, bar by bar: the run's time as
// the score's history shows it, then the last attempt at each bar in the run —
// its time, wrong notes (w), holes (h), and its join (J, J! when it was a
// hole, ×ratio).
function showTrend(rows, count) {
  const runs = rows
    .map((r) => r.data)
    .filter(playedInFull)
    .slice(-count)
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
  console.log(`bar  ${runs.map((s) => when(Date.parse(s.startedAt)).slice(5, 16).padEnd(width)).join('')}`)
  console.log(`time ${runs.map((s) => minutes(playthroughOf(s).durationMs).padEnd(width)).join('')}`)
  for (let bar = 0; bar < barCount; bar++) {
    console.log(
      `${String(bar + 1).padStart(3)}  ${lastPerBar.map((bars) => cell(bars.get(bar)).padEnd(width)).join('')}`,
    )
  }
}

// The wrong notes made the same way in at least `min` sessions: the owed note,
// the key played instead, in how many sessions and how many times.
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
      seen.set(id, entry)
    }
  }
  const logged = new Set(segments.map((s) => s.sessionId)).size
  console.log(`wrong notes made the same way in ${min} or more of the ${logged} sessions with a note log:`)
  const repeated = [...seen.values()]
    .filter((e) => e.sessions.size >= min)
    .sort((a, b) => b.sessions.size - a.sessions.size || b.times - a.times)
  for (const { event, model, sessions, times } of repeated) {
    const owed = model.notes.get(event.key)
    const label = `${hand(owed.staff)}#${attackNumber(model, owed.bar, owed.position)} ${noteName(owed.midi)}→${noteName(event.pitch)}`
    console.log(
      `  bar ${String(owed.bar + 1).padStart(3)} ${label.padEnd(18)} ${sessions.size} sessions, ${times} times`,
    )
  }
  if (repeated.length === 0) console.log('  none')
}

// --- Command line -----------------------------------------------------------

const USAGE = `usage: node scripts/practice-report.mjs <command> [--player <email>] [--profile <id>]
  sessions [--score <text>] [--days <n>, default 30]
  session <session id>
  trend --score <text> [--runs <n>]
  repeats --score <text> [--min <n>] [--days <n>]`

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
      min: { type: 'string', default: '3' },
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

  if (command === 'sessions') listSessions(await sessionsOf(player, { score: values.score, days: values.days ?? '30' }))
  else if (command === 'session') await showSession(player, id ?? die(USAGE))
  else if (command === 'trend') showTrend(await sessionsOf(player, { score: score() }), Number(values.runs))
  else if (command === 'repeats')
    showRepeats(await segmentsOf(player, { score: score(), days: values.days }), Number(values.min))
  else die(USAGE)
}

if (process.argv[1] === import.meta.filename) await main(process.argv.slice(2))
