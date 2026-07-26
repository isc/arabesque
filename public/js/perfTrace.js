// TEMPORARY diagnostic — hunts the freeze where notes keep being validated (MIDI
// events flow, classes land on the noteheads) but nothing repaints, until the UI
// unblocks and every green appears at once alongside the end-of-score modal.
//
// The first version of this probe looked for ONE multi-second task and stayed
// silent: a freeze made of back-to-back 60-140ms tasks saturates the main thread
// without ever producing a single long task above 150ms. So the thresholds are
// now well below that band, and two probes were added:
//
//   🧊 frame gap    — requestAnimationFrame stopped firing: this is the freeze
//                     the player actually sees, measured directly.
//   🔥 occupation   — share of the last second spent inside long tasks. It shares
//                     a tick with the heap sample so the two are read at the same
//                     instant, and together they say where to look:
//                       gap + occupation ~100%  → main-thread JS (the slow op is
//                                                 named by the 🐌 lines)
//                       gap + occupation low    → raster/compositing, i.e. the
//                                                 whole-score SVG repainting on
//                                                 every notehead class change
//
// OPT-IN, and deliberately so: the frame probe needs a permanent rAF loop, which
// perturbs what it measures (it was enough to make the training-mode autoscroll
// test fail intermittently). Turn it on for a practice session with
//
//   localStorage.setItem('pt:perfTrace', '1')   // then reload
//   localStorage.removeItem('pt:perfTrace')     // to stop
//
// Everything is also pushed (with a timestamp) to `window.__ptFreezeLog`, so after
// a freeze you can open the console and type `__ptFreezeLog` to see the history —
// even if the console messages have scrolled away.
//
// Remove this file + its imports (musicxml.js, app.js, storage.js) once the
// freeze is captured.

// Anything slower than a frame is worth naming while we hunt this.
const SLOW_MS = 25
// A gap this long between frames is a visible stutter, not a slow frame.
const FRAME_GAP_MS = 250
// Sampling window shared by the occupation ratio and the heap sample.
const WINDOW_MS = 1000
// Report main-thread saturation only when it's severe enough to stop painting.
const BUSY_RATIO = 0.5
// A heap drop this large between samples means V8 ran a major GC.
const HEAP_DROP_MB = 25
// The log feeds the heap detector below, so it must not grow without bound.
const LOG_MAX = 500

export const ENABLED = (() => {
  try {
    return localStorage.getItem('pt:perfTrace') === '1'
  } catch {
    return false // no localStorage (non-browser env, private mode, sandboxed iframe)
  }
})()

// Only reachable when ENABLED, which implies a browser with localStorage.
const freezeLog = ENABLED ? (window.__ptFreezeLog ||= []) : null
const TIME_FMT = ENABLED ? new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }) : null

const heapMb = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)

function record(msg) {
  const line = `${TIME_FMT.format(new Date())} ${msg}`
  freezeLog.push(line)
  if (freezeLog.length > LOG_MAX) freezeLog.shift()
  console.warn(line)
}

function report(label, start) {
  const dt = performance.now() - start
  if (dt > SLOW_MS) record(`🐌 ${label}: ${Math.round(dt)}ms (heap ${heapMb() ?? '?'}MB)`)
}

// Times `fn`, whether it is synchronous or returns a promise. Timing only the
// synchronous head of an async function is how the whole end-of-measure
// IndexedDB path stayed invisible, and picking the wrong wrapper fails
// silently — no error, just a missing measurement. So there is one entry point
// and it decides for the caller.
//
// `fn` is always invoked synchronously: deferring it by even a microtask would
// let the next measure's startMeasureAttempt() run before this one's
// endMeasureAttempt().
export function traced(label, fn) {
  if (!ENABLED) return fn()
  const start = performance.now()
  let result
  try {
    result = fn()
  } catch (error) {
    report(label, start)
    throw error
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(() => report(label, start))
  }
  report(label, start)
  return result
}

if (ENABLED && typeof PerformanceObserver !== 'undefined') {
  try {
    // Every long task, plus the share of each second they eat. The spec only
    // emits entries from 50ms up, and that 50-150ms band is precisely where this
    // freeze appears to live, so nothing is filtered out here.
    let busyMs = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        busyMs += e.duration
        record(`⏱ long task: ${Math.round(e.duration)}ms (heap ${heapMb() ?? '?'}MB)`)
      }
    }).observe({ entryTypes: ['longtask'] })

    // One tick for both readings: a freeze that coincides with a GC pause IS
    // that pause, and correlating them needs samples taken at the same instant.
    let prevHeap = null
    setInterval(() => {
      const heap = heapMb()
      if (busyMs > BUSY_RATIO * WINDOW_MS) {
        record(`🔥 occupation main-thread ${Math.round((busyMs / WINDOW_MS) * 100)}% (heap ${heap ?? '?'}MB)`)
      }
      busyMs = 0
      if (prevHeap && heap && prevHeap - heap > HEAP_DROP_MB) {
        record(`🗑️ chute heap ${prevHeap}→${heap}MB (GC probable)`)
      }
      prevHeap = heap
    }, WINDOW_MS)

    // The freeze as the player experiences it: frames stop being produced. Runs
    // allocation-free so it can't skew the heap readings above. Hidden tabs are
    // skipped — rAF is throttled there and every gap would be a false positive.
    let lastFrame = performance.now()
    const onFrame = (now) => {
      const gap = now - lastFrame
      lastFrame = now
      if (gap > FRAME_GAP_MS && document.visibilityState === 'visible') {
        record(`🧊 frame gap ${Math.round(gap)}ms — UI figée (heap ${heapMb() ?? '?'}MB)`)
      }
      requestAnimationFrame(onFrame)
    }
    requestAnimationFrame(onFrame)

    console.info("🐌 perfTrace actif — window.__ptFreezeLog pour l'historique, localStorage.removeItem('pt:perfTrace') pour couper")
  } catch {
    /* longtask not supported */
  }
}
