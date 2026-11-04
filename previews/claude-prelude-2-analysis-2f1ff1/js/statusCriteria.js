// What a status asks for, in words, from the numbers the app grades by: the
// library says it under a filtered list, a score's history against the piece
// (pieceGoals.js). A module of its own so that the library, the page the app
// opens on, does not load what the history needs.
import { STATUS_THRESHOLDS } from './aggregates.js?v=d7f8ca69fcdc'
import { t, tn } from './i18n.js?v=d7f8ca69fcdc'
import { statusLabel } from './utils.js?v=d7f8ca69fcdc'

export function statusCriteria(status) {
  const { cleanAttempts, measureRatio, practiceDays, timesCompleted } = STATUS_THRESHOLDS[status]
  return {
    heading: t('criteria.heading', { status: statusLabel(status) }),
    bars: measureRatio === 1
      ? t('criteria.cleanMeasuresAll', { n: cleanAttempts })
      : t('criteria.cleanMeasures', { percent: Math.round(measureRatio * 100), n: cleanAttempts }),
    runs: tn('criteria.completed', timesCompleted),
    days: practiceDays ? t('criteria.practiceDays', { n: practiceDays }) : null,
  }
}
