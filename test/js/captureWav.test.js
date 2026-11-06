import { describe, it, expect } from 'vitest'
import { encodeCaptureWav, decodeCaptureWav } from '../../public/dev/captureWav.js'

describe('capture WAV', () => {
  it('gives back the samples and the capture written into it', () => {
    const samples = Float32Array.from({ length: 1001 }, (_, i) => Math.sin(i / 10) * 0.5)
    const capture = { midi: [{ t: 12.5, data: [144, 60, 80] }], note: 'odd-length JSON → padded chunk' }
    const decoded = decodeCaptureWav(encodeCaptureWav(samples, 48000, capture))
    expect(decoded.sampleRate).toBe(48000)
    expect(decoded.capture).toEqual(capture)
    expect(decoded.samples).toHaveLength(samples.length)
    for (let i = 0; i < samples.length; i++) expect(decoded.samples[i]).toBeCloseTo(samples[i], 4)
  })

  it('is a WAV any player reads: RIFF size and data chunk where they belong', () => {
    const buffer = encodeCaptureWav(new Float32Array(4), 44100, {})
    const view = new DataView(buffer)
    const ascii = (at) => String.fromCharCode(...new Uint8Array(buffer, at, 4))
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8)
  })
})
