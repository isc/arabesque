// Tempo Trainer: strict runs of a passage in a loop, the tempo moving between
// runs. Two ways of moving it, both weighed in the practice-efficacy
// literature (Allingham & Wöllner 2022, Donald 1997):
//
// - graduated: the tempo the player asked for, raised a step after STREAK
//   clean runs in a row and lowered a step after as many failed ones, never
//   below where it started. What musicians reach for first — and the less
//   effective of the two, since slow practice alone transfers poorly to the
//   target tempo.
// - random: a handful of tempi around the target — 70, 85, 100 and 110 % —
//   in random order, never twice the same. Contextual interference: worse
//   during the session, better retained, and the target tempo is met from
//   the first runs instead of at the end of a long climb.
//
// Pure: no DOM, no engine. createTempoTrainer() drives the loop with whatever
// plays one run, so the score page only has to say how a run is played.
export const GRADUATED = 'graduated'
export const RANDOM = 'random'

export const BPM_STEP = 5
export const STREAK = 3
// A run is clean with nothing missed or wrong and this share of its notes in
// tempo: a note or two off-tempo is a wobble, not a failed run.
export const CLEAN_RATE = 0.9
export const RANDOM_RATIOS = [0.7, 0.85, 1, 1.1]

export function isCleanRun({ hit, total, missed, wrongNotes }) {
  return missed === 0 && wrongNotes === 0 && total > 0 && hit / total >= CLEAN_RATE
}

// Which tempo the next run is played at, given the runs so far. `bpm` is the
// tempo the player asked for: the starting point of a graduated climb, the
// target the random tempi are set around.
export function createTempoPlan({ mode, bpm, random = Math.random }) {
  const startBpm = bpm
  const tempi = RANDOM_RATIOS.map((ratio) => Math.round(bpm * ratio))
  const runs = []
  let current = bpm
  let cleanStreak = 0
  let failStreak = 0
  // How far the last run moved the tempo of a graduated climb, in BPM: up a
  // step on a streak, down one after as many runs spoiled, and nothing in
  // random mode, whose tempi are drawn rather than earned.
  let moved = 0

  function nextBpm() {
    if (mode !== RANDOM) return current
    const last = runs.length ? runs[runs.length - 1].bpm : null
    const choices = tempi.filter((tempo) => tempo !== last)
    return choices[Math.floor(random() * choices.length)]
  }

  // Files a run and moves the tempo; says whether the run was clean.
  function record(verdict) {
    const clean = isCleanRun(verdict)
    const before = current
    runs.push({ bpm: verdict.bpm, clean, verdict })
    if (mode === GRADUATED) {
      if (clean) {
        cleanStreak++
        failStreak = 0
      } else {
        failStreak++
        cleanStreak = 0
      }
      if (cleanStreak === STREAK) {
        current += BPM_STEP
        cleanStreak = 0
      } else if (failStreak === STREAK) {
        current = Math.max(startBpm, current - BPM_STEP)
        failStreak = 0
      }
    }
    moved = current - before
    return clean
  }

  return {
    nextBpm,
    record,
    get runs() {
      return runs
    },
    get bpm() {
      return current
    },
    get cleanStreak() {
      return cleanStreak
    },
    // The step a graduated climb has just earned, before any run is played at
    // it. A loop stopped there shows only runs at the old tempo, which reads as
    // a streak that earned nothing (feedback 9337d522). Null in random mode.
    get moved() {
      return moved
    },
    get earnedBpm() {
      const last = runs[runs.length - 1]
      return mode === GRADUATED && last && current > last.bpm ? current : null
    },
  }
}

// What a session of runs amounts to, for the summary shown when it ends.
export function summarizeRuns(runs) {
  let bestStreak = 0
  let streak = 0
  for (const run of runs) {
    streak = run.clean ? streak + 1 : 0
    bestStreak = Math.max(bestStreak, streak)
  }
  return {
    count: runs.length,
    cleanCount: runs.filter((run) => run.clean).length,
    fromBpm: runs[0]?.bpm ?? null,
    toBpm: runs.length ? runs[runs.length - 1].bpm : null,
    bestStreak,
  }
}

// The loop: one run after another at the tempo the plan hands out, a gap
// between them for the hands to come back to the start, until stop() — or
// until a run is aborted from elsewhere. `runOnce(bpm)` plays one run and
// resolves with the engine's result, which `abortRun()` cuts short;
// `onRun(result, clean)` hears that a run has just been judged.
//
// pause() holds the loop where it is, the plan with it: the run under way is
// aborted and goes unjudged, and resume() starts the next one at the tempo and
// streak the plan had reached. A pause is a breath between two goes, not the
// end of the work (feedback 7f523e16): stopping used to be the only way to
// take one, and it threw the climb away.
export function createTempoTrainer({ plan, runOnce, abortRun, onRun, gapMs = 1000 }) {
  let stopped = false
  let gap = null
  let held = null

  async function start() {
    while (!stopped) {
      if (held) await held.promise
      if (stopped) break
      const result = await runOnce(plan.nextBpm())
      if (stopped) break
      if (result.aborted) {
        if (held) continue
        break
      }
      const clean = plan.record(result.verdict)
      onRun?.(result, clean)
      await new Promise((resolve) => {
        gap = { id: setTimeout(resolve, gapMs), resolve }
      })
      gap = null
    }
    return { ...summarizeRuns(plan.runs), earnedBpm: plan.earnedBpm }
  }

  // Held before the run is cut short, so that its aborted result reads as a
  // pause rather than as the end.
  function pause() {
    held ??= Promise.withResolvers()
    abortRun?.()
  }

  function resume() {
    held?.resolve()
    held = null
  }

  function stop() {
    stopped = true
    if (gap) {
      clearTimeout(gap.id)
      gap.resolve()
    }
    resume()
    abortRun?.()
  }

  return { start, pause, resume, stop }
}
