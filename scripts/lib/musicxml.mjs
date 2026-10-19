// Reading MusicXML as text, for the scripts that walk a score's notes without
// a DOM — the fingerprint generator, the fingering import and the practice
// report — so that they read a note the same way, in either quote style: MuseScore writes double
// quotes, but the Hanon files come from scripts/split_hanon.rb through REXML,
// which writes single ones.

// A whole `<part>…</part>`; within it, a `<measure …>` opening tag or a whole
// `<note>…</note>`, in the order the part writes them. `(?=[\s>])` so
// `<part-list>` is not a part nor `<measure-style>` a measure; `<note` cannot
// collide with `<notations>` for the same reason.
export const PART = /<part(?=[\s>])[\s\S]*?<\/part>/g
export const MEASURE = /<measure(?=[\s>])[^>]*>/g
export const TOKEN = new RegExp(`${MEASURE.source}|<note(?:\\s[^>]*)?>[\\s\\S]*?<\\/note>`, 'g')

const MEASURE_NUMBER = /\bnumber=["']([^"']*)["']/
const IMPLICIT = /\bimplicit=["']yes["']/

// A `<measure …>` tag as fileNumbering() takes it (fingeringKeys.js): its
// number, NaN when it is no integer ("X1") or missing, and whether it is
// implicit.
export function measureOf(tag) {
  return { number: parseInt(MEASURE_NUMBER.exec(tag)?.[1], 10), implicit: IMPLICIT.test(tag) }
}
export const STAVES = /<staves>\s*(\d+)\s*<\/staves>/g

// Off a note. Built once: the alternative is a fresh RegExp per note, over
// every note of every score.
export const STAFF = /<staff>\s*([^<]*)<\/staff>/
export const VOICE = /<voice>\s*([^<]*)<\/voice>/
export const REST = /<rest(?:[\s/>])/
export const GRACE = /<grace(?:[\s/>])/
export const CHORD = /<chord(?:[\s/>])/
export const TIE_START = /<tie\s[^>]*type=["']start["']/
export const TIE_STOP = /<tie\s[^>]*type=["']stop["']/
// A note nobody plays: a cue note (OSMD takes both <cue/> and a cue-sized
// <type>) or one the score hides.
export const CUE_OR_HIDDEN = /<cue\s*\/>|<type\s[^>]*size=["']cue["']|^<note\s[^>]*print-object=["']no["']/

// As the file writes it, one-based; absent means the first.
export function numberOf(xml, pattern) {
  const match = pattern.exec(xml)
  return match ? parseInt(match[1], 10) : 1
}

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const PITCH = /<pitch>([\s\S]*?)<\/pitch>/
const STEP = /<step>\s*([^<]*)<\/step>/
const OCTAVE = /<octave>\s*([^<]*)<\/octave>/
const ALTER = /<alter>\s*([^<]*)<\/alter>/

// The MIDI number of a note's pitch, or null for a note without one.
export function midiOf(note) {
  const pitch = PITCH.exec(note)?.[1]
  const step = pitch && STEP.exec(pitch)?.[1].trim()
  const octave = pitch && OCTAVE.exec(pitch)?.[1]
  if (!(step in STEP_SEMITONES) || octave === undefined) return null
  return 12 * (parseInt(octave, 10) + 1) + STEP_SEMITONES[step] + (parseInt(ALTER.exec(pitch)?.[1] ?? '0', 10) || 0)
}

// Besides the notes, what times them, for a walk that places each note in its
// bar: the measures, what moves the cursor back and forth between voices, what
// scales a duration, and the tempo marked. `TOKEN` has no group of its own, so
// the backreference counts from here.
export const TIMED_TOKEN = new RegExp(
  `${TOKEN.source}|<(backup|forward)>[\\s\\S]*?<\\/\\1>|<divisions>[^<]*<\\/divisions>|<sound\\s[^>]*\\btempo=["'][^"']*["']`,
  'g',
)
export const DURATION = /<duration>\s*([\d.]+)\s*<\/duration>/
export const DIVISIONS = /<divisions>\s*([\d.]+)/
export const TEMPO = /\btempo=["']([^"']*)["']/
export const FERMATA = /<fermata[\s/>]/
