# Paysage concurrentiel

Passe faite le **2026-08-04**. À relire avec ses limites : elle repose sur
l'**API de recherche de l'App Store** (store français) et sur la **lecture des
descriptions publiées**. Aucune de ces apps n'a été installée ni essayée. Les
chiffres d'avis et les dates de mise à jour viennent de l'API ; les
fonctionnalités décrites sont celles que revendiquent leurs éditeurs, pas des
constats. Tout ce qui suit est donc une carte, pas un audit.

## Ce qui a déclenché cette passe

Pendant la recherche d'un nom (voir `NAMING.md`), plusieurs apps sont apparues
qui semblaient occuper notre créneau, et je les ai qualifiées de « clones ».
**C'était faux.** Elles étaient remontées parce que leur *nom* correspondait aux
termes musicaux testés, pas parce qu'elles font la même chose. Vérification
faite sur les descriptions :

| App | Ce qu'elle fait réellement | Recouvrement |
|---|---|---|
| **Ivory - Piano Sheet Music, MIDI** | Transcription : convertit un enregistrement audio/vidéo en partition et en MIDI par apprentissage automatique. Part du son, produit la notation. | **Aucun** — nous faisons l'inverse (partir de la partition, valider le jeu). |
| **Sostenuto: Pratique Musicale** | Journal de travail avec répétition espacée (SRS), coach IA, suivi du BPM, enregistrement audio/vidéo, streaks. Multi-instruments. | **Partiel** — sur la couche de suivi seulement. Ne lit pas le MIDI, n'affiche pas de partition, ne valide pas les notes. |
| **Andante Music Practice Journal** | Journal de travail : minuteur, métronome, accordeur, enregistreur, humeur/concentration, graphiques, streaks, sync iCloud. Écrit par un violoniste. | **Partiel** — même couche. Aucune notion de partition ni de MIDI. |
| **Ostinato Institute** | Plateforme de cours en ligne : vidéos, PDF, masterclasses, forum. Le numéro de version (`2.114732.739`) suggère un générateur no-code. | **Aucun.** |

## Le vrai paysage

**Poids lourds grand public** — cours guidés, catalogue pop, abonnement. Ils ne
sont pas sur notre terrain (répertoire classique, partition réelle, gratuité)
mais ils définissent les attentes du public.

| App | Avis | Dernière MàJ |
|---|---|---|
| Simply Piano | 85 327 | 2026-08-04 |
| flowkey | 10 885 | 2026-07-29 |
| Skoove | 2 844 | 2026-08-04 |

**Concurrents fonctionnels directs** — clavier MIDI + partition + évaluation.
C'est là que se situe la comparaison utile.

| App | Avis | MàJ | Ce qu'elle revendique |
|---|---|---|---|
| **Piano Marvel** | 105 | 2026-07-02 | 30 000 morceaux, 18 niveaux, 1 200 leçons guidées, tests de lecture à vue, import de ses propres morceaux. Vendu aux écoles et aux professeurs. Déjà cité dans la roadmap pour son test SASR. |
| **Tokatab** (FR) | 19 | 2026-07-06 | « Professeur virtuel » : parcours sur 200+ compétences pianistiques, 1 000 exercices, 100 morceaux, import de partitions, recommandations personnalisées, avec ou sans solfège. |
| **Piano Tabs: MIDI Trainer** | 7 | 2026-07-06 | 800 pièces classiques + import de MIDI, affichage type piano-roll (pas de portée), boucle sur une section avec *speed trainer* (accélération progressive). |
| **Notevision** | 161 | 2026-07-16 | Lecture à vue. |

**Adjacents** — même public, autre métier : bibliothèques et lecteurs de
partitions (MuseScore, 9 866 avis ; Newzik, 1 868 ; Flat, 447), journaux de
travail (Andante, Sostenuto), transcription (Ivory).

**Cités dans la roadmap, non vérifiables ici** — `ROADMAP.md` s'inspire de
Modacity et Tonara (archivage comparatif des enregistrements), Pianote (séances
guidées) et ROLI Piano / Airwave (clavier lumineux, suivi des mains). Leurs
fiches App Store françaises sont trompeuses : « Tonara » y remonte un moniteur
de justesse vocale sans rapport, « PiaNote » une app abandonnée en 2023 à 1
avis, Modacity affiche 0 avis. Ces produits vivent ailleurs (web, autres
plateformes) ; les évaluer suppose de sortir de l'App Store.

## Où nous nous situons

Ce qui n'apparaît chez **aucun** des concurrents directs lus ici : l'**annotation
des doigtés note à note, conservée par partition**, et l'**ouverture d'un morceau
en jouant ses premières notes** (empreintes MIDI). À vérifier en installant
Piano Marvel et Tokatab avant d'en faire un argument.

Ce qui est en revanche **banalisé**, et où il ne sert à rien de courir :

- les **cours guidés** et les parcours de compétences (Simply Piano, flowkey,
  Skoove, Tokatab) — un travail de contenu, pas de logiciel ;
- les **bibliothèques de partitions** (MuseScore et ses 9 866 avis) ;
- les **journaux de travail génériques** — Andante a six ans, 72 avis et un
  périmètre complet ; Sostenuto sort cinq versions en quatre mois.

Notre avantage sur cette dernière catégorie n'est pas le journal lui-même mais
sa **source** : Andante et Sostenuto enregistrent ce que l'utilisateur *déclare*
avoir travaillé, nous enregistrons ce qu'il a *réellement joué*, note par note.
Toute fonctionnalité reprise de ces apps doit exploiter cet écart, sinon elle
nous met en concurrence frontale sur leur terrain.

## Ce qu'on pourrait leur reprendre

Passe sur les fonctionnalités d'Andante et Sostenuto, en écartant ce qui est
déjà prévu dans `ROADMAP.md` (objectifs hebdomadaires + heatmap, entretien du
répertoire, séance guidée, écoute comparative des enregistrements).

**À creuser en priorité**

- **Humeur et concentration par session, plus une note libre** (Andante). On
  mesure tout objectivement et on n'enregistre rien de subjectif. Andante en
  tire des corrélations — humeur selon l'heure de la journée, concentration
  selon la durée de session. C'est peu coûteux, et l'app horodate déjà tout ce
  qu'il faut pour le croisement.
- **BPM actuel vs BPM objectif par morceau** (Sostenuto). ✅ **Retenu** et
  rédigé dans `ROADMAP.md` : l'objectif se matérialise en ligne horizontale sur
  le graphique des jeux complets, dont la durée est déjà un tempo moyen
  déguisé. S'articule avec le mode strict et le *tempo trainer* déjà prévus, et
  donne une métrique de progression lisible que le taux d'erreur ne fournit pas.
- **Éléments de travail hors partition** (Sostenuto : « morceaux, gammes ou
  phrases »). Aujourd'hui tout est accroché à un fichier de la bibliothèque :
  impossible de suivre une gamme, un exercice ou un passage isolé. C'est un
  vrai trou du modèle de données.

**À arbitrer**

- **Saisie manuelle d'une session** (Andante). Couvrirait le travail hors
  clavier MIDI — piano acoustique, cours avec la prof. Mais on vient
  justement de cesser de créditer les interruptions comme du temps de pratique
  (#221) : la saisie déclarative va à l'encontre de cette rigueur. À trancher
  comme une question de doctrine, pas de fonctionnalité.
- **Répétition espacée formalisée** (Sostenuto). L'idée « entretien du
  répertoire » de la roadmap est un SRS qui ne dit pas son nom. Adopter une
  vraie courbe d'oubli la rendrait rigoureuse — avec un avantage que Sostenuto
  n'a pas : planifier sur la performance **mesurée** plutôt que sur un
  auto-jugement.
- **Widgets, Siri, synchronisation calendrier** (Andante). Sans objet tant
  qu'il n'y a pas d'app iOS native ; à garder en tête comme argument pour le
  wrapper (`ios/README.md`).

**À ne pas reprendre**

Le coach IA de Sostenuto (nos données brutes sont plus riches qu'un résumé
génératif), le partage social avec réactions et les *gem achievements*
(Andante et Sostenuto), l'accordeur (sans objet au piano), le suivi
multi-instruments.

## À faire pour que cette page vaille vraiment

- [ ] Installer et essayer **Piano Marvel**, **Tokatab** et **Piano Tabs: MIDI
      Trainer** — les trois seuls vrais concurrents fonctionnels. Vérifier en
      particulier s'ils gèrent les doigtés.
- [ ] Regarder **Modacity** et **Tonara** hors App Store.
- [ ] Relever les modèles économiques (abonnement, prix, gratuité) : aucun n'a
      été noté ici.
