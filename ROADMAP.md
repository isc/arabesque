# Roadmap

Idées et demandes de fonctionnalités à venir. Une fois livrées, elles descendent
dans le `CHANGELOG`.

## Idées

- **Renommage en _Arabesque_** — le nom est tranché, le renommage reste à faire.
  Décision, critères et candidats écartés dans `NAMING.md`, qui liste aussi les
  fichiers concernés et le piège à éviter (le nom de la base IndexedDB).

- **Validation des pédales** — valider l'usage de la pédale de sustain (CC 64),
  pas seulement les notes. Très pertinent sur des pièces comme la *Sonate au clair
  de lune*. Nécessite les marques `<pedal>` dans le MusicXML et l'écoute des
  Control Change côté MIDI.

- **Marqueur de passages** — outil pour surligner / marquer les passages
  difficiles d'un morceau, afin d'attirer l'attention dessus et d'y revenir.

- **Renforcement avant un jeu complet** — les suggestions de mesures à renforcer
  ne se déclenchent qu'après une lecture complète du morceau. Sur les longs
  morceaux, on travaille la première partie et on veut renforcer des mesures
  avant d'avoir tout déchiffré. Proposer le renforcement sur les mesures déjà
  jouées, sans exiger une session complète. Et baser la détection sur
  l'historique agrégé plutôt que sur la seule dernière session : repérer les
  mesures qui **stagnent** (taux d'erreur qui ne baisse plus au fil des
  sessions malgré le renforcement), pas seulement celles ratées la dernière
  fois.

- **Tempo trainer (suite du mode strict)** — l'évolution envisagée dès les
  premières PRs du mode strict (#161, #165) : construire un entraîneur de tempo
  par-dessus le moteur existant, avec **sélection d'une plage de mesures**,
  **boucle** sur cette plage et **auto-progression** du BPM (accélération
  graduelle quand la passe est propre). À coupler avec l'intégration du mode
  strict dans le suivi de pratique (stats séparées des lectures libres). Les
  mesures à renforcer pourraient déclencher automatiquement une boucle à tempo
  réduit sur le passage concerné.

- **Validation des silences / durées** — aujourd'hui rien ne signale qu'on
  maintient une note trop longtemps (ou qu'on ne respecte pas un silence), ni
  à l'inverse qu'on ne la tient pas assez longtemps. Valider la durée et le
  relâchement (Note Off), pas seulement l'attaque (Note On). Questions ouvertes :
  bloquant ou seulement pris en compte dans le score d'un jeu ? Et interaction
  avec la pédale (inutile de maintenir le doigt sur la touche si la pédale de
  sustain est enfoncée — cf. validation des pédales).

- **Validation des nuances (vélocité)** — on valide la hauteur des notes mais
  jamais la dynamique. Comparer la vélocité MIDI aux indications de nuance de la
  partition (`p`, `f`, `cresc.`, etc.).

- **Scoring des jeux complets en mode libre** — attribuer une note à une lecture
  libre complète selon le respect du tempo, les fausses notes, les durées, etc.
  Donne un repère global de progression sans imposer le cadre du mode strict.

- **Sélection multi-mesures en mode entraînement** — étendre le mode
  entraînement actuel pour sélectionner une plage de mesures (et non une seule),
  afin de travailler un passage en boucle.

- **Wishlist / statut « à venir »** — les statuts actuels (déchiffrage,
  perfectionnement, répertoire) sont tous calculés à partir de la pratique. Il
  manque un statut *manuel* pour les morceaux qu'on prévoit d'apprendre — par
  exemple les prochains morceaux discutés avec la prof. Flag posé à la main
  depuis la bibliothèque, avec sa page de statut dédiée ; le morceau bascule en
  déchiffrage dès qu'on commence à le jouer.

- **Objectifs de pratique hebdomadaires** — se fixer des objectifs par semaine
  (nombre de sessions et/ou temps de pratique) et voir en cours de semaine où
  on en est de leur atteinte. Voire un calendrier complet qui visualise
  l'atteinte des objectifs dans le temps (semaines réussies / manquées, façon
  heatmap).

- **Statut répertoire plus exigeant** — le passage en statut répertoire pourrait
  demander plus que les seuils actuels (passes propres par mesure, jours de
  pratique, lectures complètes) : exiger aussi peu de fausses notes (taux
  d'erreur global bas) et de la régularité du tempo pendant le jeu (tempo
  stable sur toute la lecture, sans ralentir dans les passages difficiles).

- **Entretien du répertoire** — le statut répertoire est aujourd'hui acquis
  pour toujours, alors qu'un morceau non rejoué se perd. Quand un morceau du
  répertoire n'a pas été joué depuis un certain temps, pousser à le rejouer
  pour le confirmer ; sans lecture de confirmation à temps (ou si elle se passe
  mal), le morceau redescend en perfectionnement.

- **Mode micro : polyphonie** — le prototype monophonique est livré (bouton 🎤
  sur la page partition : détection de pitch dans le navigateur via
  [pitchy](https://github.com/ianprime0509/pitchy) (McLeod Pitch Method), une
  note à la fois — mélodies et travail mains séparées). La grande inconnue
  reste entière pour la polyphonie (accords, deux mains), qui demande une
  autre approche que le DSP classique — l'état de l'art navigateur est un
  modèle de transcription type Onsets and Frames (Magenta.js) ou Basic Pitch
  (Spotify), pensés pour l'offline plus que le temps réel — et à évaluer en
  conditions réelles (micro de laptop, acoustique de la pièce).

- **Clavier à l'écran** — afficher une bande clavier sous la partition, avec
  les notes attendues allumées et les notes jouées en vert/rouge (l'équivalent
  logiciel des touches lumineuses type ROLI Piano). Aide les débutants qui
  n'ont pas encore le réflexe portée → touche, en complément du feedback sur
  la portée.

- **Validation des doigtés par caméra** — le MIDI dit quelle note est jouée,
  jamais avec quel doigt. Les doigtés sont pourtant déjà annotés par morceau
  dans l'app : une webcam + hand tracking (MediaPipe tourne dans le
  navigateur) pourrait vérifier que le doigt utilisé est celui annoté, voire
  donner un retour sur la posture (inspiration ROLI Airwave). Comme le mode
  micro : gros potentiel, grosse inconnue de faisabilité, à prototyper.

- **Séance guidée** — répondre à la question « je fais quoi, là, maintenant ? »
  quand on s'assoit au piano : une « séance du jour » composée automatiquement
  à partir des données de pratique. Par exemple : échauffement (Hanon), mesures
  à renforcer des morceaux en perfectionnement, lecture de confirmation d'un
  morceau du répertoire pas joué récemment, déchiffrage d'un morceau de la
  wishlist. C'est la couche qui fédère renforcement, entretien du répertoire,
  objectifs et wishlist (inspiration : les guided practice sessions de
  Pianote).

- **Entraîneur de déchiffrage à vue** — travailler le déchiffrage comme une
  compétence à part, façon SASR de Piano Marvel : de courts extraits gradués
  par difficulté, un temps de préparation, un seul essai, difficulté qui
  s'adapte au taux de réussite, et un score chiffré qui suit la progression de
  lecture à vue dans le temps. Les extraits pourraient être tirés de passages
  de la bibliothèque (domaine public). Prérequis : une gradation de difficulté
  des partitions/extraits.

- **Écoute comparative des enregistrements** — on enregistre et rejoue déjà
  les performances MIDI, mais rien n'est archivé dans la durée. Conserver des
  enregistrements liés à l'historique de pratique et permettre de réécouter
  côte à côte une version d'il y a trois mois et une d'aujourd'hui du même
  morceau, pour *entendre* sa progression (inspiration Modacity / Tonara).

- **Accès prof** — permettre à un professeur de suivre la pratique d'un élève :
  consulter sa progression, ses mesures faibles, ses jeux récents, voire lui
  assigner des morceaux ou passages à travailler.
