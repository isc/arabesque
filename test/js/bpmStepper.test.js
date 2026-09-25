import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  stepBpm,
  holdToRepeat,
  BPM_MIN,
  BPM_MAX,
  BPM_DEFAULT,
  HOLD_DELAY,
  HOLD_INTERVAL,
} from '../../public/js/bpmStepper.js'
import { BPM_STEP } from '../../public/js/tempoTrainer.js'

describe('stepBpm', () => {
  it('moves the tempo a notch either way', () => {
    expect(stepBpm(120, 1)).toBe(120 + BPM_STEP)
    expect(stepBpm(120, -1)).toBe(120 - BPM_STEP)
  })

  it('stops at the tempi the field itself accepts', () => {
    expect(stepBpm(BPM_MAX, 1)).toBe(BPM_MAX)
    expect(stepBpm(BPM_MIN, -1)).toBe(BPM_MIN)
    // The last notch is short rather than skipped: a thumb on + reaches the
    // top instead of stalling one step below it.
    expect(stepBpm(BPM_MAX - 1, 1)).toBe(BPM_MAX)
    expect(stepBpm(BPM_MIN + 1, -1)).toBe(BPM_MIN)
  })

  it('lands on a whole tempo from a fractional one', () => {
    // A tempo written in the score is rounded on its way into the field, but a
    // tempo remembered from an older version of it need not be.
    expect(stepBpm(121.4, 1)).toBe(121 + BPM_STEP)
  })

  it('starts from the default when the field holds no tempo', () => {
    // x-model.number leaves an emptied field as '' rather than a number.
    expect(stepBpm('', 1)).toBe(BPM_DEFAULT + BPM_STEP)
    expect(stepBpm(null, -1)).toBe(BPM_DEFAULT - BPM_STEP)
    expect(stepBpm(NaN, 1)).toBe(BPM_DEFAULT + BPM_STEP)
  })
})

describe('holdToRepeat', () => {
  afterEach(() => vi.useRealTimers())

  it('leaves a press alone until it is plainly a hold', () => {
    vi.useFakeTimers()
    const step = vi.fn()
    const stop = holdToRepeat(step)

    vi.advanceTimersByTime(HOLD_DELAY - 1)
    expect(step).not.toHaveBeenCalled()
    // A tap is the click that follows it, nothing more.
    expect(stop()).toBe(false)
    vi.advanceTimersByTime(HOLD_DELAY * 4)
    expect(step).not.toHaveBeenCalled()
  })

  it('keeps stepping while the button is held, and stops when it is let go', () => {
    vi.useFakeTimers()
    const step = vi.fn()
    const stop = holdToRepeat(step)

    vi.advanceTimersByTime(HOLD_DELAY + HOLD_INTERVAL * 3)
    expect(step).toHaveBeenCalledTimes(4)

    // True: the click that ends such a press is the release of the hold, not a
    // notch of its own.
    expect(stop()).toBe(true)
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    expect(step).toHaveBeenCalledTimes(4)
  })
})
