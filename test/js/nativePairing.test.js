import { describe, it, expect, afterEach, vi } from 'vitest'

import { nativePairingAvailable, openNativePairing } from '../../public/js/midi.js'

// The wrapper's shim installs this global at document start, and its presence
// is the only way a page can tell it is running there — the user agent says
// Macintosh, which is how "connect a keyboard" used to answer with the macOS
// instructions on an iPad (feedback 65f15aa6).
describe('native Bluetooth MIDI pairing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is unavailable outside the wrapper, and asking for it there does nothing', () => {
    expect(nativePairingAvailable()).toBe(false)
    expect(() => openNativePairing()).not.toThrow()
  })

  it('opens the system sheet when the shim is there', () => {
    const pairBluetooth = vi.fn()
    vi.stubGlobal('__pianoTrainerMIDI', { pairBluetooth })

    expect(nativePairingAvailable()).toBe(true)
    openNativePairing()
    expect(pairBluetooth).toHaveBeenCalledOnce()
  })
})
