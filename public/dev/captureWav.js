// A mic-mode capture as one file: a plain 16-bit mono WAV — any player opens
// it — carrying what was played alongside in a chunk of its own ('capt',
// JSON), which players skip. The capture page writes it, and
// scripts/mic-captures.mjs reads it back.

const CAPTURE_CHUNK = 'capt'

export function encodeCaptureWav(samples, sampleRate, capture) {
  const json = new TextEncoder().encode(JSON.stringify(capture))
  const jsonPadded = json.length + (json.length % 2) // chunks are word-aligned
  const dataBytes = samples.length * 2
  const view = new DataView(new ArrayBuffer(12 + 8 + 16 + 8 + dataBytes + 8 + jsonPadded))
  let at = 0
  const ascii = (text) => { for (const c of text) view.setUint8(at++, c.charCodeAt(0)) }
  const u32 = (n) => { view.setUint32(at, n, true); at += 4 }
  const u16 = (n) => { view.setUint16(at, n, true); at += 2 }

  ascii('RIFF'); u32(view.byteLength - 8); ascii('WAVE')
  ascii('fmt '); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16)
  ascii('data'); u32(dataBytes)
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(at, Math.round(clamped * 0x7fff), true)
    at += 2
  }
  ascii(CAPTURE_CHUNK); u32(json.length)
  new Uint8Array(view.buffer, at, json.length).set(json)
  return view.buffer
}

export function decodeCaptureWav(buffer) {
  const view = new DataView(buffer)
  const ascii = (at) => String.fromCharCode(...new Uint8Array(buffer, at, 4))
  let sampleRate = null
  let samples = null
  let capture = null
  for (let at = 12; at + 8 <= view.byteLength; ) {
    const id = ascii(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') sampleRate = view.getUint32(body + 4, true)
    if (id === 'data') {
      samples = new Float32Array(size / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(body + i * 2, true) / 0x7fff
    }
    if (id === CAPTURE_CHUNK) capture = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, body, size)))
    at = body + size + (size % 2)
  }
  return { sampleRate, samples, capture }
}
