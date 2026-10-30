// Mic-mode capture: records, on one clock, the microphone's raw signal, the
// notes a MIDI keyboard says were played, and what mic mode heard live.
//
// The keyboard is the ground truth. A hybrid or digital piano sounding
// through its own speakers while sending MIDI gives, in one take, the sound
// mic mode has to work from and the answer it should have reached;
// scripts/mic-captures.mjs replays the sound through the detector and scores
// it against the MIDI. A developer's tool, linked from nowhere.

import { MIC_CONSTRAINTS, start as startListening, stop as stopListening } from '../js/micInput.js'
import { computeRms } from '../js/pitchDetection.js'
import { isNoteOn, noteName } from '../js/midi.js'
import { encodeCaptureWav } from './captureWav.js'

const $ = (id) => document.getElementById(id)
const show = (id, text) => ($(id).textContent = text)

let take = null // the capture in progress

// The keyboard is listened to from the start, so the page can say which one
// it found before anything is recorded.
async function listenToKeyboards() {
  if (!navigator.requestMIDIAccess) return show('midi', 'Web MIDI indisponible dans ce navigateur')
  const access = await navigator.requestMIDIAccess()
  const attach = () => {
    const inputs = [...access.inputs.values()]
    for (const input of inputs) input.onmidimessage = onMidi
    show('midi', inputs.length ? inputs.map((i) => i.name).join(', ') : 'aucun clavier MIDI connecté')
  }
  access.onstatechange = attach
  attach()
}

function onMidi(event) {
  if (isNoteOn(event.data)) show('lastMidi', noteName(event.data[1]))
  take?.midi.push({ t: event.timeStamp - take.t0, data: [...event.data] })
}

async function startTake() {
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
  const context = new AudioContext()
  await context.audioWorklet.addModule('captureWorklet.js')
  const recorder = new AudioWorkletNode(context, 'capture')
  // A node nothing pulls from is never run: route it to a silent output.
  const mute = context.createGain()
  mute.gain.value = 0
  context.createMediaStreamSource(stream).connect(recorder).connect(mute).connect(context.destination)
  context.resume()

  const [track] = stream.getAudioTracks()
  take = {
    t0: performance.now(),
    stream,
    context,
    blocks: [],
    frames: 0,
    arrivals: [], // [ms since t0, frames recorded once this block landed]
    midi: [],
    heard: [],
    settings: { ...track.getSettings(), label: track.label, baseLatency: context.baseLatency },
  }
  recorder.port.onmessage = ({ data }) => {
    take.blocks.push(data)
    take.frames += data.length
    take.arrivals.push([performance.now() - take.t0, take.frames])
    show('level', `${(20 * Math.log10(computeRms(data) || 1e-9)).toFixed(0)} dBFS`)
  }

  // Mic mode itself, listening alongside: what it concluded live.
  await startListening({
    onMessage: (data) => {
      take.heard.push({ t: performance.now() - take.t0, data: [...data] })
      if (isNoteOn(data)) show('lastHeard', noteName(data[1]))
    },
    onEnded: stopTake,
    isPageSounding: () => false,
  })

  show('device', `${track.label} — ${context.sampleRate} Hz`)
  $('toggle').textContent = '■ Arrêter'
  take.clock = setInterval(() => {
    const notes = (events) => events.filter((e) => isNoteOn(e.data)).length
    show('elapsed', `${Math.round((performance.now() - take.t0) / 1000)} s`)
    show('counts', `${notes(take.midi)} notes MIDI, ${notes(take.heard)} entendues par le micro`)
  }, 250)
}

async function stopTake() {
  if (!take) return
  const { context, stream, blocks, frames } = take
  clearInterval(take.clock)
  stopListening()
  stream.getTracks().forEach((track) => track.stop())
  await context.close()

  const samples = new Float32Array(frames)
  let at = 0
  for (const block of blocks) {
    samples.set(block, at)
    at += block.length
  }
  const wav = encodeCaptureWav(samples, context.sampleRate, {
    recordedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    sampleRate: context.sampleRate,
    settings: take.settings,
    arrivals: take.arrivals,
    midi: take.midi,
    heard: take.heard,
  })
  take = null
  $('toggle').textContent = '● Enregistrer'
  await deliver(new Blob([wav], { type: 'audio/wav' }))
}

// Into the private bucket when signed in (supabase/mic-captures.sql), where
// the developer fetches it; to the Downloads folder otherwise.
async function deliver(blob) {
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
  let why = 'pas connecté (page Données)'
  try {
    const { supabase } = await import('../js/supabaseClient.js')
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      show('result', 'Envoi…')
      const path = `${data.session.user.id}/${name}`
      const { error } = await supabase.storage.from('mic-captures').upload(path, blob, { contentType: 'audio/wav' })
      if (!error) return show('result', `Envoyé : ${name} (${(blob.size / 1e6).toFixed(1)} Mo)`)
      why = error.message
    }
  } catch (error) {
    why = error.message
  }
  show('result', `Pas envoyé (${why}) — fichier téléchargé à la place`)
  const href = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

$('toggle').addEventListener('click', () => (take ? stopTake() : startTake()).catch((e) => show('result', e.message)))
listenToKeyboards().catch((e) => show('midi', e.message))
