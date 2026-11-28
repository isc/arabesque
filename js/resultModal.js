// The result modal: one dialog for every end — a piece played through, a
// training passage or a reinforcement done, a strict run, a tempo trainer's
// loop — its body switching on `resultMode`. A mixin the score page's
// component spreads (app.js), as it does headerMenu(). It reads nothing of the
// component's: each end hands over what the modal reports, through the show…
// method made for it.
import { t } from './i18n.js?v=59f20a4e5a0c'
import { TWO_HANDS } from './hands.js?v=59f20a4e5a0c'
import { withHands, passageText } from './utils.js?v=59f20a4e5a0c'
import { CLEAN_RATE } from './tempoTrainer.js?v=59f20a4e5a0c'
import { crotchetsPerMinute } from './noteLogAnalysis.js?v=59f20a4e5a0c'
import {
  strictAccuracy,
  strictRunLabel,
  rankingOf,
  rankingHeading,
  otherTempi,
  runFigure,
  runFaults,
  runRecords,
  faultChips,
  resultCharts,
} from './playthroughHistory.js?v=59f20a4e5a0c'

// `onOpen` runs as the modal opens.
export function resultModal({ onOpen }) {
  return {
    showResultModal: false,
    resultMode: null,
    // A piece played through, freely or to the click: what records it set,
    // where it went wrong, the ranking of its comparable runs and their chart,
    // made once as the modal opens — the chart used to be generated twice per
    // render, once to ask whether there was one — and the hands they were all
    // played with, named in the title when they aren't both. A strict run
    // started partway into the score has its verdict and where it went wrong
    // alone: it is no run of the piece.
    previousPlaythroughs: [],
    resultCharts: [],
    // A strict ranking's tempo, said over it, and how the runs at the other
    // tempi stand.
    resultRankingTitle: '',
    resultOtherTempi: [],
    resultRecords: [],
    // The run's headline figure when its verdict is not one (a free run's
    // time), and what it lost, with where (faultChips).
    resultFigure: null,
    // What that figure is, with the tempo a free run held where it kept one,
    // in the BPM strict mode counts in.
    resultFigureCaption: '',
    resultFaults: [],
    // What the run did for the piece's goals (goalNews in pieceGoals.js).
    resultGoalNews: null,
    resultHands: TWO_HANDS,
    // A strict run's verdict — the run's headline figure, in a run to the
    // click — a tempo trainer's summary, a training passage's line, a
    // reinforcement's first tries (musicxml.js).
    strictResult: null,
    trainerSummary: null,
    resultTrainingText: '',
    reinforcementFirstTries: null,

    // `allPlaythroughs` comes most recent first (getAllPlaythroughs). A run to
    // the click comes with its verdict and the faults its engine noted, which
    // say where it went wrong better than its wrong measures do.
    showScoreComplete(allPlaythroughs, goalNews = { earned: [], next: '' }, { verdict = null, faults = null } = {}) {
      const [latest] = allPlaythroughs
      this.previousPlaythroughs = rankingOf(allPlaythroughs)
      this.resultCharts = resultCharts(this.previousPlaythroughs)
      this.resultRankingTitle = rankingHeading(allPlaythroughs)
      this.resultOtherTempi = otherTempi(allPlaythroughs)
      this.resultRecords = runRecords(allPlaythroughs)
      this.resultFigure = !verdict && latest ? runFigure(latest) : null
      this.resultFigureCaption = latest?.pace
        ? t('score.runTimeAtBpm', { bpm: crotchetsPerMinute(latest.pace) })
        : t('score.runTime')
      this.resultFaults = faultChips({
        run: latest,
        verdict,
        faults: faults ?? (latest?.wrongMeasures ?? []).map((bar) => ({ kind: 'wrong', bar })),
      })
      this.resultGoalNews = goalNews
      this.strictResult = verdict
      this.resultHands = latest?.hands ?? TWO_HANDS
      this.openResultModal('run')
    },

    // A strict run started partway into the score.
    showStrictResult(verdict, faults) {
      this.showScoreComplete([], undefined, { verdict, faults })
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

    showReinforcementDone(firstTries) {
      this.reinforcementFirstTries = firstTries
      this.openResultModal('reinforcement')
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
        case 'trainer':        return t('score.resultTitleTrainer')
        case 'training':       return t('score.resultTitleTraining')
        case 'reinforcement':  return t('score.resultTitleReinforcement')
        default:               return withHands(t(this.strictResult ? 'score.resultTitleStrict' : 'score.resultTitleScore'), this.resultHands)
      }
    },

    // A run in the ranking: its time or its hit rate, and what it got wrong.
    runFigure,
    runFaults,

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

    trainerTempoLine() {
      const { fromBpm, toBpm, earnedBpm } = this.trainerSummary
      const line = fromBpm === toBpm ? t('score.trainerTempoSame', { from: fromBpm }) : t('score.trainerTempo', { from: fromBpm, to: toBpm })
      return earnedBpm ? `${line} · ${t('score.trainerEarned', { bpm: earnedBpm })}` : line
    },

    trainerRunLine(run) {
      return strictRunLabel(run.verdict)
    },
  }
}
