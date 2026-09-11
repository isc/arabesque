// In-app changelog ("Nouveautés"), shown in a modal from the library page.
//
// Antechronological order (most recent first), grouped by publication date.
// Each entry's `items` is bilingual: `{ fr: [...], en: [...] }`, same count in
// the same order; `headerMenu.js` (`changelogItems`) picks the array for the
// active language.
//
// DO NOT ADD AN ENTRY HERE BY HAND. A new entry is one file in `changelog.d/`
// at the root of the repo: a file per change is a file that merges cleanly,
// where a line added to the top of this array conflicts with every other pull
// request opened the same day. `scripts/changelog.mjs` has the format, and
// CLAUDE.md ("Changelog in-app") the rule and the bar an entry must clear.

// Written at deploy time from `changelog.d/` — see scripts/changelog.mjs.
// Left empty in the repo: entries already published live in HISTORY below, and
// a snapshot of the pending ones committed here would be exactly the conflict
// the fragments exist to avoid.
const PENDING = [{"date":"2026-09-10","items":{"fr":["La recherche de la bibliothèque ignore les accents. Taper « burgmuller » trouve Burgmüller, et un tréma en trop ne cache plus rien.","Les notes marquées par un playthrough strict s'effacent quand on choisit un autre passage. Le verdict portait sur le passage joué : il ne reste plus en rouge sur des mesures dont la boucle est sortie."],"en":["The library search ignores accents. Typing \"burgmuller\" finds Burgmüller, and an umlaut too many no longer hides anything.","The notes a strict playthrough marks are cleared when another passage is picked. The verdict was a verdict on the passage played, and no longer stays red over bars the loop has left behind."]}},{"date":"2026-09-09","items":{"fr":["La Ballade de Burgmüller rejoint la bibliothèque. L'étude op. 100 no 15, en ut mineur, doigtée aux deux mains et avec ses reprises.","La Consolation de Burgmüller rejoint la bibliothèque. L'étude op. 100 no 13, doigtée, quarante-deux mesures où la main droite dessine son motif au-dessus d'accords tenus.","L'Harmonie des anges de Burgmüller rejoint la bibliothèque. L'étude op. 100 no 21, doigtée aux deux mains, où l'arpège passe d'une main à l'autre sans qu'on l'entende.","Sur iPad, connecter un clavier ouvre la fenêtre du système. Le bouton « Connecter clavier MIDI » affichait des instructions pour macOS ; il ouvre maintenant l'appairage Bluetooth de l'iPad, et le menu ⚙️ le propose aussi.","Le filtre « À renforcer » oublie les vieilles fautes. Il lisait des compteurs cumulés depuis le premier jour, et un morceau massacré il y a six mois y restait à vie. Il pose maintenant la même question que le mode renforcement : reste-t-il des mesures à retravailler sur les dix dernières séances ?","« Pas joué depuis 7 j » ne rappelle plus les morceaux jamais commencés. Une partition ouverte trente secondes n'a pas de badge, mais revenait quand même dans la liste. Il lui faut désormais une minute de travail, comme pour le badge. Et la carte sous la liste dit ce que le filtre sélectionne."],"en":["Burgmüller's Ballade joins the library. The op. 100 no. 15 study in C minor, fingered for both hands, repeats and all.","Burgmüller's Consolation joins the library. The op. 100 no. 13 study, fingered, forty-two bars of a right-hand figure over held chords.","Burgmüller's Harmony of the Angels joins the library. The op. 100 no. 21 study, fingered for both hands, its arpeggio passing from one to the other unheard.","On iPad, connecting a keyboard opens the system sheet. The \"Connect MIDI keyboard\" button used to show macOS instructions; it now opens the iPad's own Bluetooth pairing, and the ⚙️ menu offers it too.","The \"To reinforce\" filter forgets old mistakes. It read counters adding up from the very first day, so a piece massacred six months ago stayed on the list for ever. It now asks the same question reinforcement mode does: are there bars still worth working on over the last ten sessions?","\"Not played in 7d\" no longer reminds you of pieces you never started. A score opened for thirty seconds carries no badge, yet still came back on the list. It now needs a minute of practice, the same floor as the badge. And the card under the list says what the filter selects."]}},{"date":"2026-09-08","items":{"fr":["Les ornements sont attendus en mode strict. Une note ornée n'était jamais validée, et la jouer comptait pour une fausse note. Le mode demande maintenant la réalisation écrite — mordant, grupetto, trille — dans l'ordre, un trille alternant à volonté. L'ornement omis compte pour une note manquée."],"en":["Ornaments are expected in strict mode. An ornamented note was never validated, and playing it even counted as a wrong note. The mode now asks for the written realization — mordent, turn, trill — in its order, a trill alternating as long as you like. Leaving the ornament out counts as a missed note."]}},{"date":"2026-09-07","items":{"fr":["Le tempo se règle au doigt. Un − et un + encadrent le champ, en mode strict comme à l'écoute : une pression pour un cran de 5 BPM, un appui maintenu pour défiler. Taper la valeur au clavier marche toujours.","Le badge Déchiffrage se mérite. Une partition ouverte et essayée quelques secondes s'affichait déjà comme déchiffrée ; il faut désormais une minute de jeu sur le morceau, le temps affiché juste à côté du badge.","Les filtres de la bibliothèque ne se contredisent plus. « Déchiffrage » puis « Proches du répertoire » répondait par une liste vide : le filtre sur lequel on clique s'applique désormais toujours, en relâchant celui qui l'en empêchait, et chaque compteur annonce ce que le clic va afficher.","La modale de doigté dit sur quelle note elle porte. Son titre affiche le nom de la note cliquée et sa main — « sol♯5 · main droite » — de quoi vérifier d'un coup d'œil, sur une partition dense, que le clic a bien atteint la tête visée.","Chaque profil se synchronise avec le compte. Seul le premier suivait le compte, les autres restaient sur leur appareil. Un profil créé sur l'iPad apparaît maintenant sur le téléphone connecté au même compte, avec son journal, ses statuts et ses doigtés ; supprimé quelque part, il l'est partout.","Le repère de la mesure de départ s'efface pendant un passage strict. Il restait posé sur la mesure choisie longtemps après qu'on l'avait dépassée ; il ne marque plus que le départ du prochain essai, et revient si on arrête le passage."],"en":["The tempo can be set with a thumb. A − and a + now flank the field, in strict mode and while listening: one press moves it by 5 BPM, a held press keeps it moving. Typing the value in still works.","The Sight-reading badge is earned. A score opened and tried for a few seconds already showed up as being sight-read; it now takes a minute of playing on the piece, the time shown right next to the badge.","The library filters no longer contradict each other. \"Sight-reading\" then \"Close to the repertoire\" answered with an empty list: the filter you click now always applies, releasing whichever one stood in its way, and every count says what the click will show.","The fingering pad says which note it is about. Its title now shows the name of the note you clicked and its hand — \"G♯5 · right hand\" — so on a dense score you can see at a glance that the click landed on the head you meant.","Every profile syncs with the account. Only the first one followed it, the others stayed on their device. A profile created on the iPad now shows up on the phone signed in to the same account, with its journal, statuses and fingerings; removed anywhere, it is removed everywhere.","The start-measure marker clears while a strict run plays. It used to sit on the chosen measure long after the player had passed it; it now marks only where the next run begins, and comes back if a run is stopped."]}},{"date":"2026-09-06","items":{"fr":["Les critères du statut suivant, sous la liste. Filtrer la bibliothèque sur Déchiffrage, Perfectionnement ou « Proches du répertoire » affiche maintenant, sous les partitions, ce qu'il faut atteindre pour passer au statut au-dessus.","Un avis part avec l'image de l'écran qu'on avait sous les yeux. Un problème se décrivait mal en mots : la mesure fautive n'a pas de nom, et l'état de la page ne se raconte pas. La fenêtre d'avis joint maintenant une capture, montrée avant l'envoi et retirable d'une case.","Le clavier se connecte tout seul une fois appairé. Sur iPad, l'appairage Bluetooth se fait hors de l'app : au retour, les notes passaient déjà, mais l'en-tête proposait toujours « Connecter clavier MIDI ». L'app écoute maintenant l'arrivée du clavier, et signale aussi bien un débranchement.","▶ Écouter a son propre bandeau. Le morceau écouté se pilotait d'un seul bouton : ▶ depuis le début, ⏹ pour tout arrêter. Un bandeau offre maintenant ⏸ / ▶ pour reprendre à la mesure laissée, le tempo d'écoute modifiable en cours de route, et un clic sur une mesure pour écouter à partir de là.","Travaillez un passage entier en mode entraînement. La sélection ne portait que sur une mesure ; le bouton 🔁 de la barre d'entraînement permet maintenant de cliquer la première puis la dernière mesure d'un passage, qui doit sortir trois fois de suite sans faute — enchaînements et liaisons compris."],"en":["The criteria for the next status, under the list. Filtering the library on Sight-reading, Refining or \"Near repertoire\" now shows, under the scores, what it takes to reach the status above.","Feedback goes out with a picture of the screen you were looking at. A problem was hard to put into words: the offending bar has no name, and the state of the page does not tell itself. The feedback window now attaches a capture, shown before you send and taken back off with a checkbox.","The keyboard connects on its own once paired. On an iPad the Bluetooth pairing happens outside the app: on the way back the notes were already coming through, but the header still offered \"Connect MIDI keyboard\". The app now listens for the keyboard arriving, and reports an unplug just as promptly.","▶ Écouter has a band of its own. The piece being listened to was driven by a single button: ▶ from the top, ⏹ to end it. A band now offers ⏸ / ▶ to pick the piece up at the bar it was left at, the listening tempo changed while it plays, and a click on any bar to hear it from there.","Work a whole passage in training mode. Only one bar could be selected; the 🔁 button in the training band now lets you click a passage's first bar and then its last, and the whole thing has to come out three times in a row without a mistake — the joins and slurs between bars included."]}}]

// Everything already folded out of `changelog.d/`, newest first. Written by
// `node scripts/changelog.mjs fold`, not by hand.
const HISTORY = [
  {
    date: '2026-09-06',
    items: {
      fr: [
        "Douze chansons pour débutants. Une collection « Chansons » reprend note pour note les douze chansons qui closent la méthode de piano pour les 4-7 ans de Sophie Allerme : mêmes tonalités, mêmes doigtés, mains autour du do central.",
      ],
      en: [
        "Twelve songs for beginners. A \"Chansons\" collection carries, note for note, the twelve songs that close Sophie Allerme's piano method for 4-7 year olds: same keys, same fingerings, hands around middle C.",
      ],
    },
  },
  {
    date: '2026-09-06',
    items: {
      fr: [
        "Plusieurs profils sur le même appareil. Chacun a son journal, ses statuts et ses doigtés : ce que l'un joue n'entre pas dans l'historique de l'autre. On les crée dans ⚙️ → Données, et on en change d'un tap sur le prénom en haut de la bibliothèque.",
      ],
      en: [
        "Several profiles on the same device. Each has its own journal, statuses and fingerings: what one plays never lands in the other's history. Create them in ⚙️ → Data, and switch with a tap on the name at the top of the library.",
      ],
    },
  },
  {
    date: '2026-09-05',
    items: {
      fr: [
        "Noter un doigté ne fait plus tomber le mode entraînement. Valider un doigté redessinait la partition, et le mode s'en allait avec elle, répétitions déjà acquises comprises. Entraînement comme renforcement, le travail en cours traverse maintenant l'annotation.",
        "Le mode strict travaille un passage en boucle. Le bouton 🔁 Boucle rejoue le passage délimité par deux clics sur la partition, avec une pause entre deux passages, et fait évoluer le tempo : +5 BPM après trois passages propres, ou 70, 85, 100 et 110 % du tempo dans le désordre. ⏸ arrête et résume les passages joués.",
        "Un passage strict compte comme joué en entier, notes manquées ou pas. Il fallait jusqu'ici n'en manquer aucune — au métronome, autant dire jamais. Un passage joué du début à la fin est maintenant consigné avec son verdict : « 1× en entier (94 % à 55 BPM) · mode strict ».",
        "La modale de fin de passage strict n'écrit plus le score en rouge. 94 % en rouge vif se lisait comme un échec. Le pourcentage est neutre sous 70 %, bleu jusqu'à 90 %, vert au-delà.",
        "Les passages en mode strict ont leur place dans l'historique. Ils étaient consignés comme des passages libres, leur durée — celle du métronome — faussant le classement des temps. Le journal les distingue maintenant, avec leur tempo et leur précision, et leur donne leur propre courbe.",
        "Le décompte du mode strict se voit. Une mesure entière s'écoule entre l'appui sur ▶ et la première note, et rien ne bougeait à l'écran : qui n'entendait pas les clics croyait que rien n'avait démarré. Le bandeau affiche maintenant les temps de la mesure de départ, celui en cours en évidence.",
        "Les doigtés s'annotent au doigt. Sur tablette, il fallait toucher une tête de note large de trois millimètres, et un toucher à côté déplaçait le curseur au lieu d'ouvrir le pavé. Un toucher va maintenant à la tête de note la plus proche ; à la souris, la visée reste au pixel près.",
      ],
      en: [
        "Writing a fingering no longer takes training mode down with it. Validating a fingering redrew the score, and the mode went with it, repetitions already banked included. Training and reinforcement alike, the work under way now survives the annotation.",
        "Strict mode can loop a passage. The 🔁 Loop button replays the passage between two clicked bars, with a pause between runs, and moves the tempo along: +5 BPM after three clean runs, or 70, 85, 100 and 110% of the tempo in random order. ⏸ ends the loop and sums up the runs.",
        "A strict run counts as played in full, missed notes or not. Until now not one note could be missed — to the metronome, that is never. A run played from the top to the end is now filed with its verdict: \"1× in full (94% at 55 BPM) · strict mode\".",
        "The end-of-run modal no longer writes the strict score in red. 94% in bright red read as a fail. The percentage is neutral below 70%, blue up to 90%, green beyond.",
        "Strict-mode runs have their place in the history. They were filed as free runs, their time — the metronome's — skewing the play-time ranking. The journal now tells them apart, with their tempo and their accuracy, and gives them a chart of their own.",
        "The strict-mode count-in can be seen. A whole bar goes by between pressing ▶ and the first note, and nothing moved on screen: anyone who could not hear the clicks thought nothing had started. The band now shows the beats of the count-in bar, the one sounding picked out.",
        'Fingerings can be annotated with a finger. On a tablet you had to hit a notehead three millimetres across, and a tap beside it moved the cursor instead of opening the pad. A tap now goes to the nearest notehead; with a mouse, aiming stays pixel-exact.',
      ],
    },
  },
  {
    date: '2026-09-03',
    items: {
      fr: [
        "▶ Écouter ne fait plus sursauter. L'app appuyait les touches à une nuance forte, bien au-dessus de ce qu'on joue soi-même : le morceau sortait de l'instrument plus fort que sa propre main. Elle joue maintenant un cran en dessous d'un toucher normal, sans jamais toucher au volume de l'instrument.",
        "Les partitions ne sont plus criblées de chiffres. Une cinquantaine de nombres isolés flottaient au-dessus des portées de l'Arabesque, et cinq autres partitions en portaient : des changements de tempo écrits pour la lecture automatique du logiciel de saisie. Les indications réelles restent en place.",
        "Le mode strict compte comme du travail. Un morceau joué en entier au métronome ne laissait aucune trace : ni temps de pratique, ni mesures travaillées. Chaque passage est maintenant enregistré mesure par mesure.",
      ],
      en: [
        "▶ Écouter no longer makes you jump. The app pressed the keys at a forte, well above what you play yourself: the piece came out of the instrument louder than your own hand. It now plays a step below a normal touch, without ever touching the instrument's own volume.",
        'Scores are no longer littered with numbers. Some fifty lone numbers floated above the staves of the Arabesque, and five other scores carried them: tempo changes written for the playback of the software they were typeset in. The real markings stay where they are.',
        'Strict mode now counts as practice. A piece played end to end with the metronome left no trace at all: no practice time, no bars worked. Every run is now recorded bar by bar.',
      ],
    },
  },
  {
    date: '2026-09-02',
    items: {
      fr: [
        "Une fausse note se voit. En mode entraînement, un point ne se remplit que si la mesure est jouée sans faute, mais rien ne signalait la faute : les trois points restaient bloqués sans qu'on comprenne pourquoi. La note attendue s'allume maintenant en rouge, et le point de la répétition en cours aussi.",
      ],
      en: [
        "A wrong note now shows. In training mode a dot only fills when the bar is played without a mistake, but nothing marked the mistake: all three dots stalled with no explanation. The note you owed now lights up red, and so does the dot for the repetition under way.",
      ],
    },
  },
  {
    date: '2026-08-31',
    items: {
      fr: [
        "Sur téléphone, la bibliothèque se lit en deux onglets : Journal et Partitions. Les filtres sont maintenant avec la liste qu'ils filtrent, et le journal s'ouvre en premier sans qu'il faille passer deux semaines de cartes pour atteindre les partitions. Sur grand écran, rien ne change.",
      ],
      en: [
        "On a phone the library reads as two tabs: Journal and Scores. The filters now sit with the list they filter, and the journal opens first without two weeks of cards standing between you and the scores. Nothing changes on a wide screen.",
      ],
    },
  },
  {
    date: '2026-08-30',
    items: {
      fr: [
        "La bibliothèque et le journal de pratique tiennent enfin sur un téléphone. Le tableau des partitions débordait de l'écran et les titres se cassaient sur trois lignes. Chaque partition est maintenant une ligne à elle seule, les filtres se replient derrière un bouton, et un menu déroulant assure le tri.",
        "Le bouton ⚙️ n'est plus hors écran sur un téléphone. La barre du haut d'une partition passe à la ligne au lieu de dépasser.",
        "Le titre gravé au-dessus de la partition s'adapte à la largeur de l'écran. Il était dessiné à taille fixe, donc il occupait le tiers d'un écran de téléphone et repoussait la musique vers le bas.",
      ],
      en: [
        'The library and the practice journal finally fit on a phone. The score table ran off the screen and titles broke over three lines. Each score is now a row of its own, the filters fold behind a button, and a dropdown handles the sorting.',
        'The ⚙️ button is no longer off-screen on a phone. The top bar of a score page wraps instead of overflowing.',
        'The title engraved above the score now scales with the screen. It was drawn at a fixed size, so it took a third of a phone screen and pushed the music down.',
      ],
    },
  },
  {
    date: '2026-08-28',
    items: {
      fr: [
        "Reprendre à une mesure ne saute plus la reprise. Dans un morceau à reprise — les exercices de Hanon —, cliquer sur une mesure repartait en réalité de la deuxième passe, et l'app annonçait la partition terminée sans que la reprise ait été jouée. Le clic repart maintenant de la première passe.",
        "Reprendre le morceau depuis sa première mesure repart vraiment de zéro. Les mesures déjà jouées restaient acquises alors que le chronomètre repartait : deux mesures suffisaient à déclarer la partition terminée, avec un temps absurde en tête du classement. Un saut en arrière garde le crédit du reste.",
      ],
      en: [
        'Restarting at a bar no longer skips the repeat. In a piece with a repeat — a Hanon exercise — clicking a bar actually restarted on the second pass, and the app announced the score finished though the repeat was never played. A click now restarts on the first pass.',
        'Picking the piece up again from its first bar really does start over. The bars already played stayed to the run\'s credit while its clock restarted, so a couple of bars could declare the score finished, with an absurd time topping the ranking. Jumping back mid-piece still keeps the rest.',
      ],
    },
  },
  {
    date: '2026-08-27',
    items: {
      fr: [
        "Jouer d'une seule main ne compte plus comme le morceau joué en entier. Un passage main droite seule reste enregistré et chronométré, mais à part : sa propre ligne dans le journal, sa propre courbe, et un classement qui ne compare que des passages joués des mêmes mains.",
        "L'app fonctionne sans réseau. Tout ce qu'il faut pour ouvrir la bibliothèque et jouer est gardé sur l'appareil, et chaque partition ouverte y reste : un iPad sans wifi travaille normalement. Au passage, l'app démarre nettement plus vite.",
      ],
      en: [
        'Playing with one hand no longer counts as the piece played in full. A right-hand-only run is still recorded and timed, but apart: its own line in the journal, its own chart, and a ranking that only compares runs played with the same hands.',
        'The app works without a network. Everything needed to open the library and play is kept on the device, and every score you open stays there: an iPad with no wifi works as usual. It also makes the app start noticeably faster.',
      ],
    },
  },
  {
    date: '2026-08-26',
    items: {
      fr: [
        "Travailler une main seule ne bute plus sur les mesures que l'autre main tient toute seule : le curseur les traverse. Dans le prélude n° 2 de Bach, la mesure 25 est un silence à la main droite ; elle compte maintenant comme faite, donc une lecture d'une seule main va jusqu'au bout.",
      ],
      en: [
        'Working one hand alone no longer stops at the bars the other hand holds by itself: the cursor crosses them. In Bach\'s Prelude No. 2, bar 25 rests in the right hand; it now counts as done, so a one-hand playthrough runs all the way to the end.',
      ],
    },
  },
  {
    date: '2026-08-24',
    items: {
      fr: [
        'Une page « Assiduité » montre l’année entière, une case par jour : plus vous avez joué ce jour-là, plus la case est foncée. On y lit d’un coup d’œil les semaines tenues et les trous, la série en cours et la meilleure série ; cliquer une case rappelle ce qui a été travaillé.',
        'La page Données permet de supprimer son compte : le compte et toutes les données synchronisées sont effacés de nos serveurs, en deux temps pour éviter le clic malheureux. Les données de cet appareil, elles, restent en place — la sauvegarde dans un fichier, juste au-dessus, sert à les emporter.',
      ],
      en: [
        'A "Consistency" page shows the whole year, one square per day: the longer you played that day, the darker the square. The weeks you kept up and the gaps read at a glance, along with your current and longest streak; clicking a square recalls what you worked on.',
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
        "Plus de case « Synchronisation automatique » : être connecté suffit. Vos données se synchronisent, et se déconnecter est ce qui arrête tout. La case ne servait plus qu'à laisser croire qu'un compte était actif alors qu'il ne faisait rien.",
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
        "Connexion par code : l'e-mail contient désormais un code à 8 chiffres en plus du lien. Le lien connecte le navigateur qui l'ouvre, ce qui ne marche ni dans l'app iPad ni depuis un autre appareil ; le code, lui, fonctionne partout.",
      ],
      en: [
        'Sign in with a code: the email now carries an 8-digit code alongside the link. A link signs in whichever browser opens it, which works neither in the iPad app nor from another device; the code works everywhere.',
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
        "Les 20 premiers exercices du Pianiste virtuose de Hanon rejoignent la bibliothèque, en une seule entrée. Un sélecteur passe d'un exercice à l'autre, et chaque exercice garde son propre historique de pratique.",
      ],
      en: [
        "The first 20 exercises from Hanon's The Virtuoso Pianist join the library, under a single entry. A selector moves from one exercise to the next, and each keeps its own practice history.",
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

// One group per date, newest first, pending items ahead of published ones on a
// date they share. Grouping here rather than in the generator lets `fold`
// prepend a group without a same-date special case, and keeps the modal to one
// heading per day either way.
export function mergeChangelog(pending, history) {
  const byDate = new Map()
  for (const entry of [...pending, ...history]) {
    const group = byDate.get(entry.date) ?? { date: entry.date, items: { fr: [], en: [] } }
    group.items.fr.push(...entry.items.fr)
    group.items.en.push(...entry.items.en)
    byDate.set(entry.date, group)
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export const CHANGELOG = mergeChangelog(PENDING, HISTORY)
