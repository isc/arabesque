// Map of composer → musical period for the library filter.
// Keep keyed by the exact `composer` string used in scores.json — the lookup
// is by equality, no normalization or alias resolution.
const COMPOSER_PERIODS = {
  'J.S. Bach':          'baroque',
  'C.P.E. Bach':        'baroque',
  'Christian Petzold':  'baroque',
  'Pachelbel':          'baroque',
  'Handel-Halvorsen':   'baroque',
  'Mozart':             'classique',
  'Beethoven':          'classique',
  'Schubert':           'romantique',
  'Hanon':              'romantique',
  'Chopin':             'romantique',
  'Schumann':           'romantique',
  'Liszt':              'romantique',
  'Brahms':             'romantique',
  'Tchaikovsky':        'romantique',
  'Rimsky-Korsakov':    'romantique',
  'Debussy':            'moderne',
  'Erik Satie':         'moderne',
  'Scott Joplin':       'moderne',
  'Leontovych':         'moderne',
  'Luo Ni':             'contemporain',
  'Paul de Senneville': 'contemporain',
  'Traditional':        'traditionnel',
}

import { t } from './i18n.js'

// Stable period values (used as filter keys / in the URL). Labels are resolved
// per-language via periodLabel() so they never get hard-coded to one locale.
export const PERIODS = ['baroque', 'classique', 'romantique', 'moderne', 'contemporain', 'traditionnel']

export function periodLabel(value) {
  return t(`period.${value}`)
}

export function getPeriodForComposer(composer) {
  return COMPOSER_PERIODS[composer] || null
}
