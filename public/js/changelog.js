// In-app changelog ("Nouveautés"), shown in a modal from the library page.
//
// Antechronological order (most recent first), grouped by publication date.
// The bar is high: an entry must be worth the reader's time. Put **real
// user-facing changes** here — a new feature, a notable behaviour change, a
// fix to something the player would have noticed. Do NOT list per-score
// notation fixes, refactors, CI, lint, or purely technical changes. When in
// doubt, leave it out. Keep each item short and concrete.
//
// Each entry's `items` is bilingual: `{ fr: [...], en: [...] }`. Both languages
// are required for new entries — write the French items, then a natural,
// idiomatic English translation of each, in the same order and same count.
// `headerMenu.js` (`changelogItems`) picks the array for the active language.
//
// See CLAUDE.md ("Changelog in-app") for the update rule.

export const CHANGELOG = [
  {
    date: '2026-07-06',
    items: {
      fr: [
        "Mode micro (bêta) : pas de clavier MIDI ? Sur la page partition, le bouton 🎤 fait écouter votre piano par le microphone et valide les notes jouées. Une note à la fois pour l'instant — idéal pour les mélodies et le travail mains séparées ; les accords ne sont pas encore reconnus.",
      ],
      en: [
        "Mic mode (beta): no MIDI keyboard? On the score page, the 🎤 button lets the app listen to your piano through the microphone and validate the notes you play. One note at a time for now — great for melodies and hands-separate practice; chords aren't recognised yet.",
      ],
    },
  },
  {
    date: '2026-06-24',
    items: {
      fr: [
        "Un menu ⚙️ regroupe désormais le changement de langue, les nouveautés, la gestion des données et l'envoi d'un avis, pour une interface plus épurée.",
        "Vous pouvez envoyer directement un bug, une idée ou une demande de partition via « Avis » (dans le menu ⚙️). Aucun compte requis ; laissez votre e-mail si vous souhaitez une réponse.",
      ],
      en: [
        'A ⚙️ menu now groups the language switch, what’s new, data management and feedback, for a tidier interface.',
        'You can send a bug, an idea or a score request directly via "Feedback" (in the ⚙️ menu). No account needed; leave your email if you\'d like a reply.',
      ],
    },
  },
  {
    date: '2026-06-21',
    items: {
      fr: [
        "En mode écoute, cliquer sur une mesure y déplace directement la lecture — plus besoin de tout réécouter depuis le début.",
      ],
      en: [
        'While listening, clicking a measure jumps playback straight there — no more listening from the top.',
      ],
    },
  },
  {
    date: '2026-06-20',
    items: {
      fr: [
        "Les grupettos différés tombent désormais au bon moment : la note principale est tenue sur le temps, puis l'ornement s'exécute en fin de valeur. Vous pouvez ainsi intercaler les notes de l'autre main entre la note et son grupetto, comme l'exige la partition (par ex. le 2ᵉ mouvement de la Pathétique de Beethoven).",
      ],
      en: [
        "Delayed turns now land at the right moment: the principal note is held on the beat, then the ornament plays at the end of its value. This lets you interleave the other hand's notes between the note and its turn, as the score intends (e.g. the 2nd movement of Beethoven's Pathétique).",
      ],
    },
  },
  {
    date: '2026-06-15',
    items: {
      fr: [
        "Piano Trainer est désormais disponible en anglais. Un sélecteur FR/EN en haut de page bascule toute l'interface ; la langue est détectée automatiquement selon votre navigateur et votre choix est mémorisé. Vos données de pratique ne sont pas affectées.",
      ],
      en: [
        'Piano Trainer is now available in English. An FR/EN switch at the top of the page flips the whole interface; the language is auto-detected from your browser and your choice is remembered. Your practice data is unaffected.',
      ],
    },
  },
  {
    date: '2026-06-12',
    items: {
      fr: [
        "Les 20 premiers exercices du Pianiste virtuose de Hanon rejoignent la bibliothèque, regroupés en une seule entrée. Sur la partition, un sélecteur permet de passer d'un exercice à l'autre ; chaque exercice garde son propre historique de pratique, et jouer les premières notes d'un exercice depuis la bibliothèque l'ouvre directement.",
      ],
      en: [
        "The first 20 exercises from Hanon's The Virtuoso Pianist join the library, grouped under a single entry. On the score, a selector lets you move from one exercise to the next; each exercise keeps its own practice history, and playing an exercise's opening notes from the library opens it directly.",
      ],
    },
  },
  {
    date: '2026-06-10',
    items: {
      fr: [
        "Les durées de parcours ne comptent plus les temps morts : quand vous mettez en pause ou êtes interrompu en plein milieu, ce temps est retranché. La comparaison entre vos passages reflète mieux votre progression réelle.",
        "Les fenêtres (résultats, historique, aide…) se ferment désormais avec la touche Échap.",
      ],
      en: [
        "Run durations no longer count idle time: when you pause or get interrupted partway through, that time is subtracted. Comparing your runs now reflects your real progress more accurately.",
        "Dialogs (results, history, help…) can now be closed with the Esc key.",
      ],
    },
  },
  {
    date: '2026-06-07',
    items: {
      fr: [
        "Retour à la bibliothèque depuis le clavier : appuyez sur la touche la plus aiguë du piano pour revenir à la liste des partitions, en conservant les filtres en cours.",
      ],
      en: [
        "Back to the library from the keyboard: press the highest key on the piano to return to the score list, keeping your current filters.",
      ],
    },
  },
  {
    date: '2026-06-05',
    items: {
      fr: [
        "Chargement par glisser-déposer : déposez un fichier MusicXML — y compris les .mxl compressés — directement sur la page pour l'ouvrir, sans passer par le bouton.",
      ],
      en: [
        "Drag-and-drop loading: drop a MusicXML file — including compressed .mxl files — straight onto the page to open it, no button required.",
      ],
    },
  },
  {
    date: '2026-05-28',
    items: {
      fr: [
        "Raccourci « / » : appuyez sur la touche slash pour placer aussitôt le curseur dans la recherche de la bibliothèque.",
      ],
      en: [
        "“/” shortcut: press the slash key to jump the cursor straight into the library search.",
      ],
    },
  },
  {
    date: '2026-05-22',
    items: {
      fr: [
        "Nouveau filtre par période musicale (baroque, classique, romantique, moderne…) dans la bibliothèque.",
      ],
      en: [
        "New filter by musical period (Baroque, Classical, Romantic, Modern…) in the library.",
      ],
    },
  },
  {
    date: '2026-05-21',
    items: {
      fr: [
        "Le statut « répertoire » est plus exigeant : une partition n'y accède qu'après une maîtrise plus solidement démontrée, pour que le répertoire reste un vrai repère.",
      ],
      en: [
        "The “repertoire” status is now more demanding: a score reaches it only after more solidly demonstrated mastery, so that your repertoire stays a meaningful benchmark.",
      ],
    },
  },
  {
    date: '2026-05-20',
    items: {
      fr: [
        "Mode strict plus pratique : les contrôles restent visibles pendant le jeu, un clic sur une mesure définit le point de départ, et le tempo choisi est mémorisé d'une séance à l'autre.",
      ],
      en: [
        "More convenient strict mode: the controls stay visible while you play, clicking a bar sets the starting point, and your chosen tempo is remembered from one session to the next.",
      ],
    },
  },
  {
    date: '2026-05-11',
    items: {
      fr: [
        "Refonte de l'interface : nouveau système de design, pages repensées et modes de jeu unifiés pour une navigation plus claire.",
      ],
      en: [
        "Interface overhaul: a new design system, redesigned pages, and unified play modes for clearer navigation.",
      ],
    },
  },
  {
    date: '2026-05-10',
    items: {
      fr: [
        "Nouveau mode « parcours strict » : jouez la partition du début à la fin au tempo imposé par un métronome, pour mesurer votre régularité plutôt que votre seule justesse.",
      ],
      en: [
        "New “strict run” mode: play the score from start to finish at a tempo set by a metronome, to measure your steadiness rather than just your accuracy.",
      ],
    },
  },
  {
    date: '2026-05-04',
    items: {
      fr: [
        "Graphique d'évolution dans l'historique d'une partition : visualisez la durée de vos parcours au fil des séances pour voir si vous gagnez en aisance.",
      ],
      en: [
        "Progress chart in a score's history: see how your run durations evolve session after session to tell whether you're getting more fluent.",
      ],
    },
  },
  {
    date: '2026-04-10',
    items: {
      fr: [
        "Ouvrez une partition en la jouant : depuis la bibliothèque, jouez les premières notes d'un morceau sur le piano et l'appli l'ouvre automatiquement.",
        "Pédale de sustain prise en compte pendant l'écoute de la partition.",
      ],
      en: [
        "Open a score by playing it: from the library, play a piece's opening notes on the piano and the app opens it automatically.",
        "Sustain pedal taken into account while listening to the score.",
      ],
    },
  },
  {
    date: '2026-03-24',
    items: {
      fr: [
        "Retour à l'accueil en appuyant sur la touche la plus grave du piano (le La0 tout à gauche).",
      ],
      en: [
        "Back to the home page by pressing the lowest key on the piano (the A0 at the far left).",
      ],
    },
  },
  {
    date: '2026-03-19',
    items: {
      fr: [
        "Parcourez la bibliothèque par niveau de travail — déchiffrage, perfectionnement, répertoire — grâce aux pages de statut.",
      ],
      en: [
        "Browse the library by working level — sight-reading, polishing, repertoire — through the status pages.",
      ],
    },
  },
  {
    date: '2026-03-15',
    items: {
      fr: [
        "Curseur et défilement automatique pendant l'écoute : le curseur suit la musique et la page défile toute seule.",
        "Pages compositeur pour parcourir les partitions regroupées par compositeur.",
      ],
      en: [
        "Cursor and auto-scrolling while listening: the cursor follows the music and the page scrolls on its own.",
        "Composer pages to browse scores grouped by composer.",
      ],
    },
  },
  {
    date: '2026-02-21',
    items: {
      fr: [
        "Écoute avec un vrai son de piano : la partition peut désormais être jouée avec un rendu audio réaliste, en plus de l'envoi vers un piano MIDI connecté.",
      ],
      en: [
        "Listen with a real piano sound: the score can now be played with realistic audio, in addition to being sent to a connected MIDI piano.",
      ],
    },
  },
  {
    date: '2026-02-18',
    items: {
      fr: [
        "Reconnaissance des ornements : trilles, mordants, grupettos et appoggiatures sont validés avec une tolérance adaptée lorsque vous les jouez.",
      ],
      en: [
        "Ornament recognition: trills, mordents, turns, and appoggiaturas are validated with a suitable tolerance when you play them.",
      ],
    },
  },
  {
    date: '2026-02-09',
    items: {
      fr: [
        "Aide à la connexion : si aucun clavier n'est détecté, une fenêtre explique comment connecter votre piano selon votre système (macOS, Windows, Linux).",
      ],
      en: [
        "Connection help: if no keyboard is detected, a dialog explains how to connect your piano depending on your system (macOS, Windows, Linux).",
      ],
    },
  },
  {
    date: '2026-02-06',
    items: {
      fr: [
        "Doigtés à plusieurs chiffres pris en charge (par exemple pour les changements de doigt sur une même note).",
      ],
      en: [
        "Multi-digit fingerings supported (for example, finger changes on the same note).",
      ],
    },
  },
  {
    date: '2026-01-30',
    items: {
      fr: [
        "Mode renforcement ciblé : à la fin d'un parcours complet, l'appli vous propose de retravailler précisément les mesures où vous avez fait des erreurs.",
      ],
      en: [
        "Targeted reinforcement mode: at the end of a full run, the app offers to rework precisely the bars where you made mistakes.",
      ],
    },
  },
  {
    date: '2026-01-18',
    items: {
      fr: [
        "Annotation des doigtés : ajoutez vos propres doigtés directement sur la partition. Ils sont sauvegardés et réaffichés à chaque ouverture.",
      ],
      en: [
        "Fingering annotation: add your own fingerings directly on the score. They are saved and shown again every time you open it.",
      ],
    },
  },
  {
    date: '2026-01-15',
    items: {
      fr: [
        "Historique de pratique et journal quotidien : suivez, partition par partition et jour par jour, le temps passé et les mesures travaillées.",
      ],
      en: [
        "Practice history and daily log: track, score by score and day by day, the time spent and the bars worked on.",
      ],
    },
  },
  {
    date: '2026-01-13',
    items: {
      fr: [
        "Sauvegarde de vos données : exportez puis réimportez un fichier contenant vos doigtés, votre historique et votre progression — utile pour changer d'appareil.",
      ],
      en: [
        "Back up your data: export and later re-import a file containing your fingerings, history, and progress — handy when switching devices.",
      ],
    },
  },
  {
    date: '2026-01-10',
    items: {
      fr: [
        "Recherche multi-mots dans la bibliothèque : tapez plusieurs mots (titre et compositeur) pour affiner les résultats.",
      ],
      en: [
        "Multi-word search in the library: type several words (title and composer) to narrow down the results.",
      ],
    },
  },
  {
    date: '2026-01-04',
    items: {
      fr: [
        "Choix de la main à travailler — main droite, main gauche ou les deux — et bouton plein écran pour la partition.",
      ],
      en: [
        "Choose which hand to practice — right hand, left hand, or both — plus a full-screen button for the score.",
      ],
    },
  },
  {
    date: '2026-01-02',
    items: {
      fr: [
        "Bibliothèque de partitions classiques du domaine public, et connexion du clavier via la Web MIDI API (USB ou Bluetooth).",
      ],
      en: [
        "A library of public-domain classical scores, and keyboard connection through the Web MIDI API (USB or Bluetooth).",
      ],
    },
  },
]
