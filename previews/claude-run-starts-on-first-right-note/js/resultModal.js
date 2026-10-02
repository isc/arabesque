// The result modal: one dialog for every end — a piece played through, a
// training passage or a reinforcement done, a strict run, a tempo trainer's
// loop — its body switching on `resultMode`. A mixin the score page's
// component spreads (app.js), as it does headerMenu(). It reads nothing of the
// component's: each end hands over what the modal reports, through the show…
// method made for it (openResultModal('reinforcement') for the one with
// nothing to report).
import { t } from './i18n.js'
import { TWO_HANDS } from './hands.js'
import { withHands, passageText } from './utils.js'
import { CLEAN_RATE } from './tempoTrainer.js'
import {
  strictAccuracy,
  wrongNotesText,
  strictRunLabel,
  rankingOf,
  wrongMeasuresText,
  playthroughChartSvg,
} from './playthroughHistory.js'

// `onOpen` runs as the modal opens.
export function resultModal({ onOpen }) {
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
    // A strict run's verdict, a tempo trainer's summary, a training passage's
    // line.
    strictResult: null,
    trainerSummary: null,
    resultTrainingText: '',

    // `allPlaythroughs` comes most recent first (getAllPlaythroughs).
    showScoreComplete(allPlaythroughs) {
      this.previousPlaythroughs = rankingOf(allPlaythroughs)
      this.resultChart = playthroughChartSvg(this.previousPlaythroughs)
      this.resultWrongMeasures = wrongMeasuresText(allPlaythroughs[0]?.wrongMeasures ?? [])
      this.resultHands = this.previousPlaythroughs[0]?.hands ?? TWO_HANDS
      this.openResultModal('free')
    },

    showStrictResult(verdict) {
      this.strictResult = verdict
      this.openResultModal('strict')
    },

    showTrainerSummary(summary) {
      this.trainerSummary = summary
      this.openResultModal('trainer')
    },

    // Which passage came out clean, `times` clean runs through, or that the
    // score itself is done (a single measure walking down it: no `end`).
    showTrainingDone({ start, end }, times) {
      this.resultTrainingText = end == null
        ? t('score.trainingDone')
        : passageText('score.trainingPassageDone', { start, end }, { times })
      this.openResultModal('training')
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
