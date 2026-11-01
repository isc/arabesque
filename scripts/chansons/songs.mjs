// The twelve songs that close Sophie Allerme's "Méthode de piano pour les
// 4-7 ans" (pp. 58-61), then "Trompette et tambour", "Sur le chemin de
// l'école", "C'est la bagarre", "La leçon" and "Entraîne-toi" from earlier in
// the same book, all transcribed note for note: same keys, same registers, same
// hand positions, same fingerings. The twelve tunes are traditional and in the
// public domain, and their bass is the one-note kind there is only one way to
// write. The five after them look like the method's own teaching pieces, words
// included, rather than traditional tunes.
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
//   E4q   a pitch (C4 = middle C, F#4 for a sharp, Fn4 for a printed
//         natural) and a value:
//         w whole, h half, q quarter, e eighth; a trailing `.` dots it.
//         Eighths filling a beat come out beamed, two by two or by threes in
//         6/8; grouping cannot be asked for per song.
//   !     staccato, after the value and before a fingering: G3q!-1
//   -3    a fingering, appended to the note
//   F#4+A4q   a chord; F3+F#3q-43 fingers each of its notes in turn
//   r     a hidden rest of any value (rq, rh, rw); R alone: the whole measure
//   S     a printed rest of any value (Sq, Sq. for a dotted quarter)
//   @5/4  at the start of a measure: this measure's time signature
//   *f    a dynamic (f, p, mf…) printed at the event that follows
//
// rhWords and lhWords sing that staff: same `|` measures, syllables separated
// by spaces, landing on the measure's notes in order (a rest is not sung, and
// a measure may be left blank). A syllable ending in `-` is hyphenated to the
// next, across a barline too ("et Mon- | sieur"). A `_` is a space within a
// syllable, and a syllable left once the measure's notes have theirs goes under
// its printed rest: (1_2_3). Only the first verse is written; the book prints the
// others as prose under the score.
//
// `fifths` is the key signature (1 for one sharp); it defaults to none. It
// changes nothing about the pitches: a sharp is still written F#4.
//
// A first measure shorter than the meter is a pickup and is numbered 0; the last
// may then hold only what the pickup left of the meter.
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
  {
    slug: 'sur-le-chemin-de-l-ecole',
    title: "Sur le chemin de l'école",
    time: '4/4',
    showTime: true,
    fifths: 1,
    rh: 'R | R | D4h-2 G4q G4q | G4q F#4q G4h | R | R | D4h-2 G4q G4q | G4q F#4q G4h | R | R | G4q F#4q G4h | G4q F#4q G4h | R | R | D4h G4q G4q | G4q F#4q G4h | rh rq D4q-2 | E4q F#4q G4h | G4q F#4q G4h | G4q F#4q G4h',
    lh: 'G3q-5 B3q D4q D4q | D4q C4q B3h | R | R | G3q-5 B3q D4q D4q | D4q C4q B3h | R | R | A3q-4 B3q C4q C4q | B3q A3q B3q B3q | R | R | G3q B3q D4q D4q | D4q C4q B3h | R | R | G3q-5 B3q D4q rq | R | R | R',
    rhWords: "| | je chan- te | Sol Fa Sol | | | en chan- tant | Sol Fa Sol | | | Sol Fa Sol | Sol Fa Sol | | | je chan- te | Sol Fa Sol | sou- | cis s'en- volent | Sol Fa Sol | Sol Fa Sol",
    lhWords: "sur le che- min | de l'é- cole, | | | et tous mes sou- | cis s'en- volent, | | | la mu- si- que | c'est ma- gi- que, | | | sur le che- min | de l'é- cole, | | | et tous mes | | |",
  },
  {
    slug: 'c-est-la-bagarre',
    title: "C'est la bagarre",
    time: '4/4',
    showTime: true,
    rh: '*f G4q-3 G4q F#4h-2 | R | *f G4q G4e G4e F#4h | R | *f G4q-3 A4q A4q G4q | Fn4w | rq *f E4q-1 Fn4q-2 F#4q-3 | G4w-4 | rq *f G4q-4 F#4q-3 Fn4q-2 | E4w-1',
    lh: 'R | *p G3q-2 G3q F#3h-3 | R | *p G3q G3e G3e F#3h | R | rq *p G3q-4 A3q-3 B3q-2 | C4w-1 | rq *p E3q-4 Fn3q-3 F#3q-2 | G3h-1 A3q-3 B3q | C4q F3+F#3q-43 F3+F#3h',
    rhWords: "Tiens un dièse | | en- cor' un dièse | | mais voi- là l'bé- | carre | c'est bien trop | tard | c'est la ba- | garre",
  },
  {
    slug: 'la-lecon',
    title: 'La leçon',
    time: '4/4',
    showTime: true,
    rh: '*mf D4e-2 D4e | E4h. D4e D4e | E4h. B3e-2 B3e | C4h. B3e B3e | C4h. rq | rq rq rq E4e-1 F4e-2 | G4h.-3',
    lh: 'Sq | Sq C3q! C4q! Sq | Sq C3q! C4q! Sq | Sq A2q! A3q! Sq | Sq A2q! A3q! A3e-1 B3e-2 | C4q-3 B3e-3 C4e-2 D4q-1 rq | Sq G3q!-1 G2q!-5',
    rhWords: "Quand j'ap- | prends la le- | çon je fais | bien at- ten- | tion",
    repeatEnd: 6,
  },
  {
    slug: 'entraine-toi',
    title: 'Entraîne-toi',
    time: '6/8',
    showTime: true,
    rh: 'C4e-1 D4e E4e D4e-1 E4e F4e | E4e-1 F4e G4e Sq. | R | R | A4e-3 G4e F4e A4e-3 G4e F4e | G4e-3 F4e E4e Sq. | R | R | R | R | C5e-3 B4e A4e C5e-3 B4e A4e | B4e-3 A4e G4e Sq. | R | R | F4e-3 E4e D4e F4e-3 E4e D4e | E4e-3 E4e-3 D4e-2 C4q.-1',
    lh: 'R | R | C4e B3e A3e C4e B3e A3e | B3e A3e G3e Sq. | R | R | F3e E3e D3e F3e E3e D3e | E3e D3e C3e Sq. | C3e-3 D3e E3e D3e-3 E3e F3e | E3e-3 F3e G3e Sq. | R | R | A3e-1 G3e F3e A3e-1 G3e F3e | G3e-1 F3e E3e Sq. | R | R',
    rhWords: "En- traî- ne- toi et compt' | jus- qu'à 3 (1_2_3) | | | la pro- chain' fois tu n'ou- | blie- ras pas | | | | | on con- ti- nue mais tout | à l'en- vers | | | c'est la main droite qui fi- | nit la der- nière",
    lhWords: '| | 1 2 3 1 2 3 | 1 2 3 | | | 1 2 3 1 2 3 | 1 2 3',
  },
]
