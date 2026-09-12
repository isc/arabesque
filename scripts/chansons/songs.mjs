// The twelve songs that close Sophie Allerme's "Méthode de piano pour les
// 4-7 ans" (pp. 58-61), then "Trompette et tambour" from earlier in the same
// book, all transcribed note for note: same keys, same registers, same hand
// positions, same fingerings. The tunes are all traditional and in the public
// domain; the bass here is the one-note kind there is only one way to write.
//
// IMPORTANT: the order of this list is the file numbering — song 13 is
// written to Chansons_13_…, and practice aggregates and fingerings are keyed
// to that name. A new song goes at the END, whatever its page in the book.
// Inserting one renumbers every song after it and silently re-points the data
// of everyone who has played them.
//
// Most songs sit in the middle-C position (each thumb on C4), so the left
// hand often carries the tune while the right rests; a few move a hand, and
// the fingerings in the strings are the authority on where it goes. Songs the
// book writes without a time signature are cut into measures here — the app
// tracks practice by the measure — but the signature is not shown (showTime).
//
// One string per staff, measures separated by `|`, events by spaces:
//   E4q   a pitch (C4 = middle C, F#4 for a sharp) and a value:
//         w whole, h half, q quarter, e eighth; a trailing `.` dots it.
//         Two eighths filling a beat come out beamed; grouping cannot be
//         asked for per song.
//   -3    a fingering, appended to the note
//   F#4+A4q   a chord
//   r     a hidden rest of any value (rq, rh, rw); R alone: the whole measure
//   @5/4  at the start of a measure: this measure's time signature
//
// rhWords and lhWords sing that staff: same `|` measures, syllables separated
// by spaces, landing on the measure's notes in order (a rest is not sung, and
// a measure may be left blank). A syllable ending in `-` is hyphenated to the
// next, across a barline too ("et Mon- | sieur"). Only the first verse is
// written; the book prints the others as prose under the score.
//
// A first measure shorter than the meter is a pickup and is numbered 0.
// Repeats, Fin and D.C. sit on measures by number.

const T = 'Traditionnel'

export const COLLECTION = {
  title: 'Chansons',
  composer: T,
  filePrefix: 'Chansons',
}

export const SONGS = [
  {
    slug: 'promenons-nous-dans-les-bois',
    title: 'Promenons-nous dans les bois',
    time: '2/4',
    showTime: false,
    rh: 'D4q-2 D4q | C4h | D4q D4q | C4h | D4q D4q | C4q C4q | D4q D4q | C4h | R | R | C4h | D4h | R | D4h | D4h | C4h | R | R | C4h | D4h | R | D4h | D4h | @4/4 R',
    lh: 'R | R | R | R | R | R | R | R | C4q-1 C4q | C4h | R | R | C4q C4q | R | R | R | C4q C4q | C4h | R | R | C4q C4q | R | R | C4w',
  },
  {
    slug: 'sors-sors-escargot',
    title: 'Sors, sors, escargot',
    time: '2/4',
    showTime: false,
    rh: 'C4h-1 | R | C4q C4q | R | C4q C4q | R | C4q C4q | R | C4q C4q | D4q D4q | C4h | R | C4q-1 C4q | D4q D4q | C4h | R | C4q C4q | D4q D4q | C4h | R | C4q C4q | D4q D4q | C4h',
    lh: 'R | A3h-3 | R | A3h | R | A3q A3q | R | A3h | R | R | R | A3h | R | R | R | A3h | R | R | R | A3h | R | R | R',
  },
  {
    slug: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    time: '4/4',
    showTime: false,
    rh: 'C4q-1 C4q C4q D4q | E4h D4h | C4q E4q D4q D4q | C4w | C4q C4q C4q D4q | E4h D4h | C4q E4q D4q D4q | C4w | D4q-2 D4q D4q D4q | R | D4q rq rq rq | R | C4q C4q C4q D4q | E4h D4h | C4q E4q D4q D4q | C4w',
    lh: 'R | R | R | R | R | R | R | R | R | A3h-3 A3h | rq C4q B3q A3q | G3w | R | R | R | R',
  },
  {
    slug: 'dansons-la-capucine',
    title: 'Dansons la Capucine',
    time: '2/4',
    showTime: false,
    rh: 'R | R | D4q-2 D4q | R | R | R | D4q D4q | R | R | R | D4q D4q | R | R | R | D4q D4q | R',
    lh: 'G3h-4 | A3q A3q | R | B3q-2 B3q | A3h | B3q B3q | R | B3h | G3h | A3q A3q | R | B3q B3q | A3h | B3q B3q | R | B3h',
  },
  {
    slug: 'fais-dodo',
    title: 'Fais dodo',
    time: '3/4',
    showTime: true,
    rh: 'E4h-3 D4q | C4h D4q | D4q C4q D4q | E4h C4q | E4h D4q | C4h C4q | D4q E4q D4q | C4h E4q | E4q F4q G4q-5 | D4h-2 E4q | E4q F4q G4q | D4h E4q | E4q E4q G4q | D4q E4q E4q | E4q F4q G4q | D4h. | E4h-3 D4q | C4h D4q | D4q C4q D4q | E4h C4q | E4h D4q | C4h C4q | D4q E4q D4q | C4h.',
  },
  {
    slug: 'ah-vous-dirai-je-maman',
    title: 'Ah ! vous dirai-je, maman',
    time: '2/4',
    showTime: false,
    rh: 'R | D4q-2 D4q | E4q E4q | D4h | R | R | R | R | D4q-2 D4q | C4q C4q | R | R | D4q-2 D4q | C4q C4q | R | R',
    lh: 'G3q-4 G3q | R | R | R | C4q-1 C4q | B3q B3q | A3q A3q | G3h | R | R | B3q-2 B3q | B3q A3q | R | R | B3q B3q | A3h',
  },
  {
    slug: 'joyeux-anniversaire',
    title: 'Joyeux anniversaire',
    time: '4/4',
    showTime: false,
    rh: 'R | R | R | R | rh D4h-2 | R | rh G4h-5 | E4h-3 C4h | R | F4q-4 F4q E4h | C4h D4h | C4w',
    lh: 'G3q-4 G3q A3h | G3h C4h | B3w | G3q G3q A3h | G3h rh | C4w | G3q G3q rh | R | B3h-2 A3h | R | R | R',
  },
  {
    slug: 'sur-le-pont-d-avignon',
    title: "Sur le pont d'Avignon",
    time: '4/4',
    showTime: true,
    rh: 'C4q rq C4h | D4q D4q D4h | E4q F4q G4q rq | rq rq D4q rq | C4q rq C4h | D4q D4q D4h | E4q F4q G4q C4q | D4q rq rh | C4q rq C4q rq | C4h C4h | C4q rq C4q rq | C4h C4h',
    lh: 'rq C4q rh | R | rq rq rq C4q | B3q C4q rq G3q | rq C4q rh | R | R | rq B3q C4h | rq C4q rq C4q | R | rq C4q rq C4q | R',
    fine: 8,
    repeatStart: 9,
    repeatEnd: 12,
    dc: 12,
  },
  {
    slug: 'maman-les-p-tits-bateaux',
    title: "Maman les p'tits bateaux",
    time: '4/4',
    showTime: false,
    rh: 'rh F4q-4 E4q | D4q C4q rh | R | rq D4h-2 C4q | rh F4q E4q | D4q C4q rh | R | @5/4 rq rw',
    lh: 'G3q-4 G3q rh | rh G3q A3q | C4q B3q G3q A3q | B3q rh rq | G3q G3q rh | rh G3q A3q | C4q B3q G3q A3q | B3q C4w',
  },
  {
    slug: 'savez-vous-planter-les-choux',
    title: 'Savez-vous planter les choux ?',
    time: '4/4',
    showTime: true,
    rh: 'rh B4q-3 B4q | A4q B4q G4h-1 | F#4q-2 G4q A4q A4q | G4q A4q B4q G4q | rh B4q-3 B4q | A4q B4q G4h | F#4q-2 G4q A4q A4q | D4+B4q-4 E4+G4q F#4+A4q rq | G4w',
    lh: 'C4q-2 C4q rh | R | R | R | C4q C4q rh | R | R | R | R',
  },
  {
    slug: 'j-ai-du-bon-tabac',
    title: "J'ai du bon tabac",
    time: '4/4',
    showTime: true,
    rh: 'C4q D4q E4q C4q | D4h D4q E4q | G4h G4h | F4h F4h | C4q D4q E4q C4q | D4h E4q F4q | G4h A4h | C4w | G4h G4q F4q | E4h D4q E4q | F4h G4h | C4w | G4h G4q F4q | E4h D4q E4q | F4h G4h | C4w',
    lh: 'C3q D3q E3q C3q | D3h D3q E3q | G3h G3h | F3h F3h | C3q D3q E3q C3q | D3h E3q F3q | G3h A3h | C3w | G3h G3q F3q | E3h D3q E3q | F3h G3h | C3w | G3h G3q F3q | E3h D3q E3q | F3h G3h | C3w',
    fine: 8,
    repeatStart: 9,
    repeatEnd: 16,
    dc: 16,
  },
  {
    slug: 'le-roi-dagobert',
    title: 'Le roi Dagobert',
    time: '3/4',
    showTime: true,
    rh: 'E4q-3 | E4h D4q | D4h C4q | C4h. | C4h. | E4q F4q E4q | E4q C4q E4q | D4h. | rq C4q D4q | E4h-3 E4q | E4q F4q G4q | E4h D4q | D4q C4q D4q | D4h E4q | E4q E4q G4q | D4h. | rq rq E4q',
    lh: 'E3q | E3h D3q | D3h C3q | C3h. | C3h. | E3q F3q E3q | E3q C3q E3q | D3h. | R | A2+E3h. | A2+E3h. | A2+E3h. | A2+E3h. | A2+E3h. | A2+E3h. | A2+E3h. | rq rq E3q',
    repeatStart: 1,
    repeatEnd: 16,
    fine: 7,
  },
  {
    slug: 'trompette-et-tambour',
    title: 'Trompette et tambour',
    time: '4/4',
    showTime: true,
    rh: 'C4q C4e C4e C4q C4e E4e | G4q E4q C4q rq | G4q G4q G4q rq | R | C4q C4e C4e C4q C4e E4e | G4q E4q C4q rq | G4q G4q G4q rq | rq rq C5q-5 rq',
    lh: 'R | R | R | G3q-4 G3q G3q rq | R | R | rq rq rq G3q-4 | C4q-1 rq rh',
    rhWords: "Ma- dam' trom- pette et Mon- | sieur tam- bour | ta ta ta | | Ma- dam' trom- pette et Mon- | sieur tam- bour | ta ta ta | ho!",
    lhWords: '| | | boum boum boum | | | boum | boum',
  },
]
