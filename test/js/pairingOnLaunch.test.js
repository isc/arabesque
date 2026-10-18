import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installLocalStorage, installSessionStorage, installDocument, installMIDIAccess, fakePort } from './support/browserGlobals.js'

// Feedback 95951128: the iPad app opened without its keyboard paired, and the
// player found out from the first notes going unheard. The wrapper's Bluetooth
// sheet now comes up by itself then — on a device that has had a keyboard.
describe('the pairing sheet offered when the keyboard is missing', () => {
  const SEEN_KEY = 'arabesque:midi-keyboard-seen'
  const SEEN = { [SEEN_KEY]: '1' }
  let pairBluetooth, access, setVisibility, wake

  // A page of the app: a fresh copy of midi.js, as a navigation gives, and the
  // connection it makes at load.
  async function openPage(inputs = []) {
    vi.resetModules()
    access = installMIDIAccess(inputs)
    const midi = await import('../../public/js/midi.js')
    await midi.initMidi().connectAtLoad()
    return midi
  }

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ setVisibility, wake } = installDocument())
    installSessionStorage()
    pairBluetooth = vi.fn()
    vi.stubGlobal('__pianoTrainerMIDI', { pairBluetooth })
  })

  it('comes up when the app opens without the keyboard it had, after a grace', async () => {
    installLocalStorage(SEEN)
    const { PAIRING_GRACE_MS } = await openPage()

    vi.advanceTimersByTime(PAIRING_GRACE_MS - 1)
    expect(pairBluetooth).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(pairBluetooth).toHaveBeenCalledOnce()
  })

  it('is never offered on a device that has had no keyboard', async () => {
    installLocalStorage()
    await openPage()
    vi.runAllTimers()
    expect(pairBluetooth).not.toHaveBeenCalled()
  })

  it('stays away when the keyboard reconnects by itself within the grace', async () => {
    installLocalStorage(SEEN)
    await openPage()
    access.onstatechange({ port: fakePort('FP-30X') })
    vi.runAllTimers()
    expect(pairBluetooth).not.toHaveBeenCalled()
  })

  it('stays away when the keyboard is there', async () => {
    installLocalStorage(SEEN)
    await openPage([fakePort('FP-30X')])
    vi.runAllTimers()
    expect(pairBluetooth).not.toHaveBeenCalled()
  })

  it('comes up once per launch, not again on the next page', async () => {
    installLocalStorage(SEEN)
    await openPage()
    vi.runAllTimers()
    await openPage()
    vi.runAllTimers()
    expect(pairBluetooth).toHaveBeenCalledOnce()
  })

  it('still comes up when the first page is left within the grace', async () => {
    installLocalStorage(SEEN)
    const { PAIRING_GRACE_MS } = await openPage()
    vi.advanceTimersByTime(PAIRING_GRACE_MS / 2)
    vi.clearAllTimers()
    await openPage()
    vi.runAllTimers()
    expect(pairBluetooth).toHaveBeenCalledOnce()
  })

  it('comes up again when the app comes back without it, once however it is told', async () => {
    installLocalStorage(SEEN)
    await openPage()
    vi.runAllTimers()

    setVisibility('hidden')
    setVisibility('visible')
    wake()
    vi.runAllTimers()
    expect(pairBluetooth).toHaveBeenCalledTimes(2)
  })

  it('remembers that the device has a keyboard once one connects', async () => {
    const storage = installLocalStorage()
    await openPage([fakePort('FP-30X')])
    expect(storage.getItem(SEEN_KEY)).toBe('1')
  })
})
