# Nom de l'application — décision

**Décision : l'app s'appellera _Arabesque_.** (2026-08-04)

« Piano Trainer » est un nom de travail : générique, déjà porté par plusieurs
apps sur l'App Store, donc probablement non réservable. Le nom devait être
tranché **avant** la première soumission TestFlight, parce que deux choses
deviennent alors quasi définitives : le **bundle ID** (non modifiable une fois
l'app créée sur App Store Connect) et le **nom App Store**, unique sur toute la
boutique.

## Pourquoi Arabesque

- Debussy en a écrit deux, parmi les pièces pour piano les plus jouées : le mot
  est immédiatement chaleureux pour le public visé, sans explication.
- Graphie **identique en français et en anglais** — l'app est bilingue FR/EN.
  Une seule orthographe possible, donc pas de bouche-à-oreille qui se perd.
- Désigne étymologiquement un motif ornemental qui court et s'enroule : la ligne
  mélodique, et accessoirement ce que l'app affiche note à note.
- Libre sur l'App Store, et `arabesque.app` comme `arabesque.io` étaient libres
  au moment de la décision.

Faiblesse assumée : le mot appartient aussi à la danse et à l'ornement
architectural, il ne sera jamais exclusivement musical. Mais aucune app ne le
porte, l'espace applicatif est vide.

## Les critères qui ont servi à filtrer

Dégagés en éliminant les candidats un par un, dans l'ordre où ils se sont
révélés discriminants :

1. **Une seule graphie en FR et EN.** C'est ce qui tue le vocabulaire traduit :
   *mordent* (EN) s'écrit *mordant* en français, *fioritura* (IT) devient
   *fioriture*, *barcarolle* perd un L en anglais. Le mot se cherche mal et se
   dicte mal.
2. **Pas de voisin réel à une lettre près.** Un mot — inventé ou non — trop
   proche d'un mot existant se fait « corriger » par le lecteur : *toccato* est
   lu *toccata*, *crotchet* est entendu *crochet*.
3. **Pas de concurrent sur le créneau.** Le nom exact peut être libre alors que
   le voisinage est occupé par une app du même domaine, ce qui suffit à brûler
   la piste.
4. **Pas de connotation qui dessert.** *Solfetto* colle l'étiquette du solfège
   de conservatoire à une app qui fait justement jouer de vraies pièces tout de
   suite ; *caprice* évoque le caprice d'enfant en français.
5. **Test de la dictée.** Prononcé à voix haute, le nom doit s'écrire sans
   hésitation — d'où la méfiance envers les consonnes doubles.

## Candidats écartés

| Candidat | Raison |
|---|---|
| Gruppetto | Pris sur l'App Store par trois apps de **cyclisme** (le *gruppetto* est le groupe des attardés du peloton). Trois graphies concurrentes en circulation. |
| Ostinato | Pris, dont **Ostinato Institute**, plateforme d'éducation musicale — créneau identique. |
| Rubato | Pris, dont **Rubato: Piano & Instruments**. |
| Sostenuto | Pris par **Sostenuto: Music Practice**, app de travail instrumental avec répétition espacée. Collision frontale. |
| Ivory | Pris par **Ivory - Piano Sheet Music, MIDI**. |
| Toccata, Lento, Vivace, Cantabile, Tenuto, Clavis, Tactus, Encore, Reprise, Rote | Nom exact déjà pris. |
| Andante | Nom exact libre, mais **Andante Music Practice Journal** occupe le créneau. |
| Mordent, Fioritura | Graphie différente en français (*mordant*, *fioriture*). *Mordent* est en plus une forme du verbe *mordre*. |
| Barcarolle | Deux graphies (*barcarole* en anglais). |
| Woodshed, Escapement, Quaver | Libres sur l'App Store mais `.app` déposé. *Woodshed* (argot jazz : travailler son instrument enfermé) est conceptuellement le plus juste, mais opaque pour un public français et classique. *Quaver* est par ailleurs à vérifier côté marque (QuaverEd, éditeur en éducation musicale). |
| Moderato, Maestoso, Portato, Nocturne, Caprice, Bagatelle, Impromptu | Nom libre, `.app` déposé. |

Une piste de **mots inventés** a été explorée (libres par construction) :
*Tasteggio* et *Diteggio*, bâtis sur les racines *tasto* (la touche) et
*diteggiatura* (le doigté) avec le suffixe d'*arpeggio* et *solfeggio*. Écartée
au profit d'un mot que le public reconnaît déjà. Elle reste le repli si
Arabesque devait tomber — sous réserve d'une relecture par un italophone : la
famille des diminutifs italiens est piégeuse (*pedalino* est une chaussette
basse, *tastello* frôle *tassello*, la cheville à visser).

## Reste à faire

- [ ] **Recherche de marque déposée** (INPI / EUIPO) — non faite à ce jour.
- [ ] **Réserver le nom sur App Store Connect.** Seule vérification qui fasse
      foi ; les contrôles ci-dessus reposent sur l'API de recherche de l'App
      Store, qui est un moteur classé par pertinence, pas un registre de noms.
      Suppose le compte Apple Developer payant (99 €/an), qui est par ailleurs
      le seul blocage dur restant pour TestFlight (voir `ios/README.md`).
- [ ] **Déposer `arabesque.app`.**
- [ ] **Renommer.** Une vingtaine de fichiers portent la chaîne, hors artefacts
      de build : `public/*.html`, `public/js/{locales/fr,locales/en,changelog,data,feedback}.js`,
      `public/favicon.svg`, `public/styles.css`, `ios/project.yml`
      (`CFBundleDisplayName` + `bundleIdPrefix`), `ios/PianoTrainer/ViewController.swift`,
      les deux `README.md`, et quatre fichiers de `test/`.

      ⚠️ **Ne pas renommer `DB_NAME = 'piano-trainer'` dans
      `public/js/storage.js`.** C'est le nom de la base IndexedDB qui contient
      les doigtés, les sessions et les agrégats de pratique : le changer
      orpheline les données de tous les utilisateurs actuels. Même prudence
      pour les clés `localStorage` (`pt-returning`, `pt:midiLog`,
      `pt:perfTrace`), même si l'enjeu y est mineur.
