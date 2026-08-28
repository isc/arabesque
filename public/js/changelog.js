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
    date: '2026-08-28',
    items: {
      fr: [
        "Reprendre à une mesure ne saute plus la reprise. Dans un morceau à reprise — les exercices de Hanon, par exemple —, cliquer sur une mesure repartait en réalité de la deuxième passe : arrivé au bout, l'app annonçait la partition terminée alors que la reprise n'avait pas été jouée. Le clic repart maintenant de la première passe, et tout ce qui suit se joue, reprise comprise.",
      ],
      en: [
        'Restarting at a bar no longer skips the repeat. In a piece with a repeat — a Hanon exercise, say — clicking a bar actually restarted on the second pass: at the end, the app announced the score finished though the repeat had never been played. A click now restarts on the first pass, and everything after it is played, repeat included.',
      ],
    },
  },
  {
    date: '2026-08-27',
    items: {
      fr: [
        "Jouer d'une seule main ne compte plus comme le morceau joué en entier. Un passage main droite seule reste enregistré, chronométré et affiché, mais à part : sa propre ligne dans l'historique et dans le journal, sa propre courbe de progression, et le classement de fin de passage ne le compare qu'aux passages joués des mêmes mains.",
        "L'app fonctionne sans réseau. Tout ce qu'il faut pour ouvrir la bibliothèque et jouer est gardé sur l'appareil, et chaque partition que vous ouvrez y reste — un iPad sur un pupitre sans wifi ouvre l'app et travaille normalement. La synchronisation, elle, attend le retour du réseau. Au passage, l'app démarre nettement plus vite.",
      ],
      en: [
        'Playing with one hand no longer counts as the piece played in full. A right-hand-only run is still recorded, timed and shown, but apart: its own line in the history and in the journal, its own progress chart, and the end-of-run ranking only compares it with runs played with the same hands.',
        'The app works without a network. Everything needed to open the library and play is kept on the device, and every score you open stays there — an iPad on a music stand with no wifi opens the app and works as usual. Syncing waits for the network to come back. It also makes the app start noticeably faster.',
      ],
    },
  },
  {
    date: '2026-08-26',
    items: {
      fr: [
        "Travailler une main seule ne bute plus sur les mesures que l'autre main tient toute seule : le curseur les traverse. Dans le prélude n° 2 de Bach, la mesure 25 est un silence à la main droite — il fallait jusqu'ici recocher la main gauche pour continuer. Ces mesures comptent aussi comme faites, donc une lecture d'une seule main va bien jusqu'au bout.",
      ],
      en: [
        'Working one hand alone no longer stops at the bars the other hand holds by itself: the cursor crosses them. In Bach\'s Prelude No. 2, bar 25 rests in the right hand — until now you had to tick the left hand back on to get past it. Those bars count as done too, so a one-hand playthrough runs all the way to the end.',
      ],
    },
  },
  {
    date: '2026-08-24',
    items: {
      fr: [
        'Une page « Assiduité » montre l’année entière, une case par jour : plus vous avez joué longtemps ce jour-là, plus la case est foncée. On y lit d’un coup d’œil les semaines tenues et les trous, avec les jours joués, le temps total, les lectures complètes, la série en cours et la meilleure série. Cliquer une case rappelle ce qui a été travaillé ce jour-là.',
        'La page Données permet de supprimer son compte : le compte et toutes les données synchronisées sont effacés de nos serveurs, en deux temps pour éviter le clic malheureux. Les données de cet appareil, elles, restent en place — la sauvegarde dans un fichier, juste au-dessus, sert à les emporter.',
      ],
      en: [
        'A "Consistency" page shows the whole year, one square per day: the longer you played that day, the darker the square. The weeks you kept up and the gaps you left read at a glance, along with days played, total time, full playthroughs, current streak and longest streak. Clicking a square recalls what you worked on that day.',
        'The Data page can now delete your account: the account and everything synced under it are erased from our servers, in two steps so no stray tap can do it. This device keeps its own data — the file backup just above is there to take it with you.',
      ],
    },
  },
  {
    date: '2026-08-23',
    items: {
      fr: [
        "Le renforcement n'attend plus une lecture complète du morceau : dès qu'une mesure vous a fait trébucher, le bouton « Renforcer » apparaît. Sur les longues pièces, on travaille le début bien avant d'avoir déchiffré la fin.",
        "Les mesures à renforcer sont choisies sur vos dernières séances et non plus sur la seule dernière lecture : celles qui stagnent — un taux d'erreur qui ne baisse plus d'une séance à l'autre — passent en tête, et une mesure quitte la liste après trois passages propres d'affilée.",
        "Sur la fenêtre de fin de partition, les boutons « Renforcer », « Historique » et « Fermer » restent visibles même avec un long palmarès : c'est désormais la liste des temps qui défile, dans sa colonne, positionnée d'emblée sur le passage que vous venez de jouer.",
      ],
      en: [
        'Reinforcement no longer waits for a full playthrough: the "Reinforce" button shows up as soon as a measure has tripped you up. On long pieces, you work on the opening long before you have sight-read the end.',
        'The measures it suggests come from your recent sessions rather than from the last playthrough alone: the ones that stagnate — an error rate that stops falling from one session to the next — come first, and a measure leaves the list after three clean passes in a row.',
        'On the score-finished window, the "Reinforce", "History" and "Close" buttons stay in view however long your ranking gets: the list of times now scrolls inside its own column, and opens on the run you just played.',
      ],
    },
  },
  {
    date: '2026-08-22',
    items: {
      fr: [
        "L'ouverture d'une partition ne clignote plus. La page affichait tour à tour la carte « Charger un fichier », la barre de modes et le titre « Partition » avant de les remplacer par la vraie partition ; elle montre maintenant un indicateur de chargement, puis le morceau.",
        "Elle s'affiche aussi plus vite : le téléchargement de la partition démarre dès la première ligne de la page au lieu d'attendre que tout le reste soit chargé, les sons du piano ne sont plus téléchargés que si vous cliquez sur « Écouter », et le clavier MIDI se connecte pendant le rendu au lieu de le précéder.",
      ],
      en: [
        'Opening a score no longer flickers. The page used to flash the "Load a file" card, the mode bar and a "Score" placeholder title before swapping in the real score; it now shows a loading indicator, then the piece.',
        'It also appears sooner: the score starts downloading on the page\'s very first line instead of waiting for everything else to load, the piano sounds are only fetched if you press "Listen", and the MIDI keyboard connects while the score renders rather than before it.',
      ],
    },
  },
  {
    date: '2026-08-14',
    items: {
      fr: [
        "Plus de case « Synchronisation automatique » : être connecté suffit. Vos données se synchronisent, et se déconnecter est ce qui arrête tout. La case datait d'une époque où la synchro ne partait qu'à l'ouverture de la page Données ; elle ne servait plus qu'à laisser croire qu'un compte était actif alors qu'il ne faisait rien.",
        "Les grandes partitions s'affichent nettement plus vite — la Ballade op. 23 se redessine en trois fois moins de temps. C'est aussi sensible à chaque redimensionnement de la fenêtre, qui relance le rendu.",
      ],
      en: [
        'No more "Automatic sync" checkbox: being signed in is enough. Your data syncs, and signing out is what stops it. The checkbox dated from when sync only fired on opening the Data page; all it did was let an account look active while doing nothing.',
        'Large scores display noticeably faster — the Ballade Op. 23 redraws in a third of the time. You feel it on every window resize too, which triggers a fresh render.',
      ],
    },
  },
  {
    date: '2026-08-13',
    items: {
      fr: [
        "Connexion par code : l'e-mail contient désormais un code à 8 chiffres en plus du lien. Le lien connecte le navigateur qui l'ouvre, ce qui ne marche pas dans l'app iPad ni quand vous lisez vos mails sur un autre appareil ; le code, lui, fonctionne partout. La demande reste ouverte si vous quittez l'app pour aller chercher le code.",
      ],
      en: [
        'Sign in with a code: the email now carries an 8-digit code alongside the link. A link signs in whichever browser opens it, which fails in the iPad app and when you read your mail on another device; the code works everywhere. The request stays open if you leave the app to fetch the code.',
      ],
    },
  },
  {
    date: '2026-08-12',
    items: {
      fr: [
        "La synchronisation automatique mérite enfin son nom : une fois activée (Données → Compte), vos données partent et arrivent à la fin de chaque morceau joué, au retour sur l'app et à l'ouverture de la bibliothèque — plus besoin de passer par « Synchroniser maintenant ».",
      ],
      en: [
        'Automatic sync finally deserves its name: once turned on (Data → Account), your data goes up and comes down at the end of each piece you play, when you come back to the app and when the library opens — no more going through "Sync now".',
      ],
    },
  },
  {
    date: '2026-08-04',
    items: {
      fr: [
        "Piano Trainer s'appelle désormais Arabesque. Seul le nom change : vos partitions, vos doigtés et tout votre historique de pratique sont intacts, et l'adresse du site reste la même.",
      ],
      en: [
        'Piano Trainer is now called Arabesque. Only the name changes: your scores, your fingerings and your whole practice history are untouched, and the site address stays the same.',
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
