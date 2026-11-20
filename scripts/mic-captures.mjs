#!/usr/bin/env node
// scripts/mic-captures.mjs
//
// Fetches the takes recorded on public/dev/mic-capture.html and scores mic
// mode against them. A take holds a microphone recording of a piano that was
// also sending MIDI: the MIDI says what was played, and replaying the sound
// through the detector says what mic mode would have heard.
//
//   node scripts/mic-captures.mjs list               # the latest takes in the bucket
//   node scripts/mic-captures.mjs get [name]         # download one (default: the latest), then replay it
//   node scripts/mic-captures.mjs replay <file.wav>  # score a take already on disk
//
// Takes land in tmp/mic-captures/. The bucket is private (supabase/mic-captures.sql):
// downloading uses the project's service key, fetched through the Management
// API with the token in ~/.supabase/access-token and never written anywhere.
//
// The replay runs the very frame reading and note tracker the page runs
// (readFrame, createNoteTracker), so a change to either can be judged here,
// against real takes, before anyone plays a note.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readFrame, readPitch, createNoteTracker, FFT_SIZE, FRAME_MS } from '../public/js/pitchDetection.js'
import { isNoteOn, noteName } from '../public/js/midi.js'
import { SUPABASE_URL } from '../public/js/supabaseConfig.js'
import { decodeCaptureWav } from '../public/dev/captureWav.js'
import { api, die, query, quote } from './lib/supabase.mjs'

const BUCKET = 'mic-captures'
const OUT_DIR = join(import.meta.dirname, '..', 'tmp', 'mic-captures')
// A detection counts for a MIDI note if it starts within this window of it.
const MATCH_FROM_MS = -50
const MATCH_TO_MS = 500

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const db = (rms) => `${(20 * Math.log10(rms || 1e-9)).toFixed(0)} dB`

async function list() {
  const rows = await query(
    `select name, created_at, (metadata->>'size')::bigint as size from storage.objects
     where bucket_id = ${quote(BUCKET)} order by created_at desc limit 20`,
  )
  if (!rows.length) return console.log('No takes yet.')
  for (const row of rows) console.log(`${row.created_at.slice(0, 16)}  ${(row.size / 1e6).toFixed(1)} MB  ${row.name}`)
}

async function get(name) {
  if (!name) {
    const [latest] = await query(
      `select name from storage.objects where bucket_id = ${quote(BUCKET)} order by created_at desc limit 1`,
    )
    if (!latest) die('No takes yet.')
    name = latest.name
  }
  const keys = await api('/api-keys?reveal=true')
  const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key
  if (!serviceKey) die('No service_role key returned by the Management API.')
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  })
  if (!res.ok) die(`Storage ${res.status}: ${await res.text()}`)
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, basename(name))
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  console.log(`Saved ${path}\n`)
  replay(path)
}

function replay(path) {
  const file = readFileSync(path)
  const { sampleRate, samples, capture } = decodeCaptureWav(file.buffer.slice(file.byteOffset, file.byteOffset + file.length))
  if (!capture) die(`${path} carries no capture chunk: not a take from the capture page.`)
  const hop = Math.round((sampleRate * FRAME_MS) / 1000)
  const msOfFrame = (end) => (end / sampleRate) * 1000

  // Audio time to page time: a block arrives after its last sample was
  // captured, never before, so the earliest-looking block is the best clock.
  const offset = Math.min(...capture.arrivals.map(([ms, frames]) => ms - msOfFrame(frames)))

  // The replay, frame by frame, as the page reads it.
  const frames = []
  const heard = []
  const tracker = createNoteTracker({ onNoteOn: (note) => heard.push({ t: frames.at(-1).t, note }), onNoteOff: () => {} })
  for (let end = FFT_SIZE; end <= samples.length; end += hop) {
    const window = samples.subarray(end - FFT_SIZE, end)
    const { rms, midi } = readFrame(window, sampleRate)
    frames.push({ t: msOfFrame(end) + offset, rms, window })
    tracker.push({ midi, rms })
  }
  // MPM's raw reading, unthresholded, for the few frames a miss is explained by.
  const rawPitch = ({ window }) => readPitch(window, sampleRate)

  const played = capture.midi.filter((e) => isNoteOn(e.data)).map((e) => ({ t: e.t, note: e.data[1] }))
  const live = capture.heard.filter((e) => isNoteOn(e.data)).map((e) => ({ t: e.t, note: e.data[1] }))

  console.log(`${capture.recordedAt}  ${(samples.length / sampleRate).toFixed(0)} s at ${sampleRate} Hz`)
  console.log(`Microphone: ${capture.settings.label} ${JSON.stringify(capture.settings)}`)
  console.log(`${capture.userAgent}\n`)
  report('Replay', played, heard, frames, rawPitch)
  report('Live (what the page heard while recording)', played, live, null)
}

// Each MIDI note against the detections: found (and how late), found as
// another note, or missed; and detections that match nothing played.
function report(title, played, detected, frames, rawPitch) {
  const used = new Set()
  const rows = played.map(({ t, note }) => {
    const near = detected.filter((d) => d.t - t >= MATCH_FROM_MS && d.t - t <= MATCH_TO_MS && !used.has(d))
    const hit = near.find((d) => d.note === note)
    if (hit) {
      used.add(hit)
      return { t, note, verdict: 'hit', latency: hit.t - t }
    }
    const other = near[0]
    if (other) used.add(other)
    return { t, note, verdict: other ? `heard ${noteName(other.note)}` : 'missed' }
  })
  const extra = detected.filter((d) => !used.has(d))
  const hits = rows.filter((r) => r.verdict === 'hit')

  console.log(`== ${title}`)
  console.log(
    `${hits.length}/${played.length} found, ${rows.length - hits.length} not` +
      (hits.length ? `, median latency ${median(hits.map((h) => h.latency)).toFixed(0)} ms` : '') +
      `, ${extra.length} heard that nobody played`,
  )
  if (!frames) return console.log()
  for (const row of rows) {
    const line = `${(row.t / 1000).toFixed(2).padStart(7)} s  ${noteName(row.note).padEnd(4)} ${row.verdict === 'hit' ? `hit +${row.latency.toFixed(0)} ms` : row.verdict}`
    console.log(row.verdict === 'hit' ? line : `${line.padEnd(36)} ${why(row, frames, rawPitch)}`)
  }
  for (const d of extra) console.log(`${(d.t / 1000).toFixed(2).padStart(7)} s  ${noteName(d.note).padEnd(4)} heard, not played`)
  console.log()
}

// What the frames said where a note was missed: how loud it came in against
// the room just before, and the strongest pitch reading in its first 300 ms.
function why({ t }, frames, rawPitch) {
  const room = frames.filter((f) => f.t > t - 1000 && f.t < t - 50)
  const during = frames.filter((f) => f.t >= t && f.t <= t + 300)
  if (!during.length) return '(outside the recording)'
  const loudest = during.reduce((a, b) => (b.rms > a.rms ? b : a))
  const [frequency, clarity] = during.map(rawPitch).reduce((a, b) => (b[1] > a[1] ? b : a))
  const roomRms = room.length ? Math.min(...room.map((f) => f.rms)) : NaN
  return `peak ${db(loudest.rms)} over room ${db(roomRms)}; clearest ${frequency.toFixed(1)} Hz at ${clarity.toFixed(2)}`
}

const [command, argument] = process.argv.slice(2)
if (command === 'list') await list()
else if (command === 'get') await get(argument)
else if (command === 'replay' && argument) replay(argument)
else die('Usage: node scripts/mic-captures.mjs list | get [name] | replay <file.wav>')
