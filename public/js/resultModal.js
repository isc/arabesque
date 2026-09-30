// The result modal: one dialog for every end — a piece played through, a
// training passage or a reinforcement done, a strict run, a tempo trainer's
// loop — its body switching on `resultMode`. A mixin the score page's
// component spreads (app.js), as it does headerMenu(). The component sets
// what a strict run or a loop reports (strictResult, trainerSummary) before
// opening the modal, and provides trainingPassage.
import { t, tn } from './i18n.js'
import { TWO_HANDS } from './hands.js'
import { withHands } from './utils.js'
import { CLEAN_RATE } from './tempoTrainer.js'
import {
  strictAccuracy,
  wrongNotesText,
  strictRunLabel,
  rankingOf,
  wrongMeasuresText,
  playthroughChartSvg,
} from './playthroughHistory.js'

// `onOpen` runs as the modal opens; `repetitions()` is how many clean runs a
// training passage takes, which its line quotes.
export function resultModal({ onOpen, repetitions }) {
  return {
    showResultModal: false,
    resultMode: null,
    // A piece played through: the ranking of its comparable runs, its chart
    // and where the run went wrong, made once as the modal opens — the chart
    // used to be generated twice per render, once to ask whether there was
    // one — and the hands they were all played with, named in the title when
    // they aren't both.
    previousPlaythroughs: [],
    resultChart: '',
    resultWrongMeasures: '',
    resultHands: TWO_HANDS,
    // A strict run's verdict, and a tempo trainer's summary.
    strictResult: null,
    trainerSummary: null,

    // `allPlaythroughs` comes most recent first (getAllPlaythroughs).
    showScoreComplete(allPlaythroughs) {
      this.previousPlaythroughs = rankingOf(allPlaythroughs)
      this.resultChart = playthroughChartSvg(this.previousPlaythroughs)
      this.resultWrongMeasures = wrongMeasuresText(allPlaythroughs[0]?.wrongMeasures ?? [])
      this.resultHands = this.previousPlaythroughs[0]?.hands ?? TWO_HANDS
      this.openResultModal('free')
    },

    openResultModal(mode) {
      this.resultMode = mode
      this.showResultModal = true
      onOpen()
      // The ranking is fastest-first and scrolls in its own column, so the run
      // that just ended can sit well below the fold. Bring it into view.
      this.$nextTick(() => {
        document.querySelector('.pt-playthrough-table tr.is-current')?.scrollIntoView({ block: 'center' })
      })
    },

    closeResultModal() {
      this.showResultModal = false
      this.resultMode = null
    },

    resultTitle() {
      switch (this.resultMode) {
        case 'strict':         return t('score.resultTitleStrict')
        case 'trainer':        return t('score.resultTitleTrainer')
        case 'training':       return t('score.resultTitleTraining')
        case 'reinforcement':  return t('score.resultTitleReinforcement')
        default:               return withHands(t('score.resultTitleScore'), this.resultHands)
      }
    },

    // Beside a run's time in the ranking.
    wrongNotesText,

    // When training ends: which passage came out clean, or that the score
    // itself is done.
    trainingDoneText() {
      const { start, end } = this.trainingPassage
      if (end == null) return t('score.trainingDone')
      return tn('score.trainingPassageDone', end - start + 1, { from: start + 1, to: end + 1, times: repetitions() })
    },

    strictAccuracyPercent() {
      return this.strictResult ? strictAccuracy(this.strictResult) : 0
    },

    // How the accuracy is coloured: a good run reads as one — from the share
    // of notes in tempo that makes a run clean for the tempo trainer, on the
    // rate itself rather than the rounded figure. It used to be the mode's red
    // whatever the figure, which made 94 % look like a fail.
    strictAccuracyClass() {
      const { hit = 0, total = 0 } = this.strictResult ?? {}
      const rate = total ? hit / total : 0
      return rate >= CLEAN_RATE ? 'is-good' : rate >= 0.7 ? 'is-fair' : ''
    },

    strictOffTempoTotal() {
      const r = this.strictResult
      if (!r) return 0
      return (r.offTempoEarly ?? 0) + (r.offTempoLate ?? 0)
    },

    trainerTempoLine() {
      const { fromBpm, toBpm } = this.trainerSummary
      return fromBpm === toBpm ? t('score.trainerTempoSame', { from: fromBpm }) : t('score.trainerTempo', { from: fromBpm, to: toBpm })
    },

    trainerRunLine(run) {
      return strictRunLabel(run.verdict)
    },
  }
}
