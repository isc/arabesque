"""The fr-FR App Store listing copy.

Edit here, then `python3 scripts/appstore/push_listing.py` to push it. Running
this module on its own checks every field against Apple's length limits.
"""

LOCALE = "fr-FR"  # the language this file is written in

SUBTITLE = "Le piano, note après note"  # 30 max

DESCRIPTION = """\
Connectez votre clavier MIDI, ouvrez une partition et jouez. Arabesque écoute ce \
que vous jouez et colore chaque note en direct : réussie, attendue, manquée. \
Vous voyez vos erreurs sans lever les yeux de la partition.

Votre progression se note toute seule, mesure après mesure. Pas de score à \
gonfler, pas de badges : un journal de pratique honnête, qui vous dit quelles \
mesures vous font encore trébucher et lesquelles sont acquises.

RETOUR NOTE PAR NOTE
Le clavier se connecte en USB ou en Bluetooth. Chaque note jouée est comparée à \
la partition et se colore aussitôt. Une fausse note ne passe pas : le morceau \
attend la bonne.

TROIS FAÇONS DE TRAVAILLER
• Déchiffrage libre — vous avancez à votre rythme, sans contrainte de tempo.
• Mode entraînement — chaque mesure doit être jouée trois fois sans erreur \
avant de passer à la suivante.
• Mode strict — au tempo, sans fausse note, avec un score de justesse à la fin.

CE QUE VOUS DEVEZ TRAVAILLER
L'app repère les mesures qui vous résistent — celles dont le taux d'erreur ne \
baisse plus d'une séance à l'autre — et vous propose de les reprendre en \
boucle. Une mesure quitte la liste après trois passages propres d'affilée.

VOTRE PRATIQUE, EN CLAIR
Un journal jour par jour, l'année entière en cases, le temps réellement passé \
au clavier, les lectures complètes et les séries de jours tenus. De quoi voir \
les semaines assidues et les trous, sans se raconter d'histoires.

UNE BIBLIOTHÈQUE CLASSIQUE
Plus de 65 partitions du domaine public : les inventions de Bach, les \
arabesques de Debussy, les nocturnes de Chopin, le Hanon au complet. \
Recherchables en jouant leurs premières notes au clavier. Vous pouvez aussi \
ouvrir vos propres fichiers MusicXML.

DOIGTÉS
Affichez et modifiez les doigtés directement sur la partition, empilés dans \
l'ordre des notes pour les accords. Ils suivent vos appareils si vous vous \
connectez.

SANS COMPTE, SANS PUBLICITÉ
Tout fonctionne sans créer de compte : vos données restent sur l'appareil. La \
connexion par e-mail ne sert qu'à retrouver votre pratique d'un appareil à \
l'autre, et le compte se supprime depuis l'app. Aucune publicité, aucun \
traceur, rien à vendre.

MATÉRIEL REQUIS
Un clavier MIDI (USB ou Bluetooth) est nécessaire pour le retour note par note. \
Sans clavier, vous pouvez consulter la bibliothèque, ouvrir une partition et \
l'écouter.
"""

# 100 characters max, comma-separated. No spaces after commas: they count.
KEYWORDS = "partition,solfège,MIDI,clavier,déchiffrage,classique,pianiste,Bach,Chopin,Hanon,exercice"

# 170 max, and changeable without shipping a new build.
PROMOTIONAL_TEXT = (
    "Le retour en temps réel qui manque à votre piano : chaque note se colore selon "
    "que vous l'avez réussie, manquée ou anticipée."
)

SUPPORT_URL = "https://arabesque.app/support.html"
MARKETING_URL = "https://arabesque.app/"
PRIVACY_URL = "https://arabesque.app/privacy.html"

# Shown to TestFlight testers as "what to test", and required before Apple will
# take a build into external beta review. 4000 max.
BETA_WHATS_NEW = """\
Branchez un clavier MIDI (USB ou Bluetooth, via le bouton antenne en bas à \
droite), ouvrez une partition et jouez : les notes se colorent selon qu'elles \
sont réussies, manquées ou anticipées.

Ce qui mérite un retour : la connexion du clavier, la justesse du suivi note à \
note, la lisibilité de la partition sur votre appareil, et l'historique de \
pratique.
"""

REVIEW_NOTES = """\
Arabesque needs a MIDI keyboard (USB or Bluetooth) for its core feature, and \
review devices do not have one. Demonstration video:
https://arabesque.app/video/review-demo.mp4

WHAT THE VIDEO SHOWS (iPad, ~30s)
A score opens with a keyboard connected; notes turn green as they are played; a \
wrong note is struck and the piece visibly refuses to advance until the correct \
one arrives; the practice history opens on what was recorded; training mode is \
switched on.

The MIDI input in the recording is generated in software rather than played on \
a keyboard. The app handles both identically — the notes sent are the ones the \
app itself expects from the sheet, and the app decides what is accepted.

WHAT YOU CAN TEST WITHOUT HARDWARE
Everything except note validation: browsing and filtering the 65+ score \
library, opening a score, playback ("Écouter" plays the piece through the \
device speaker), the practice history and calendar, fingering annotation, and \
the Data page (sign-in, sync, account deletion).

WHY IT IS A WEB VIEW
The app is a native shell around the developer's web app, but it is not a \
wrapper for its own sake: iOS has no Web MIDI API in any browser, so the native \
side bridges CoreMIDI to the page (MIDIBridge.swift), and the antenna button in \
the bottom-right corner opens the system Bluetooth MIDI pairing sheet \
(CABTMIDICentralViewController), which is per-app on iOS. Without the native \
app there is no way to use a MIDI keyboard with this on iPhone or iPad.

ACCOUNT
No account is required; the app is fully usable without one. Sign-in is \
passwordless (a code sent by email) and only enables sync across devices. An \
account can be deleted from inside the app: Données → Supprimer mon compte.
"""

if __name__ == "__main__":
    for name, value, limit in [
        ("SUBTITLE", SUBTITLE, 30),
        ("KEYWORDS", KEYWORDS, 100),
        ("PROMOTIONAL_TEXT", PROMOTIONAL_TEXT, 170),
        ("DESCRIPTION", DESCRIPTION, 4000),
        ("BETA_WHATS_NEW", BETA_WHATS_NEW, 4000),
        ("REVIEW_NOTES", REVIEW_NOTES, 4000),
    ]:
        flag = "OK " if len(value) <= limit else "OVER"
        print(f"{flag} {name}: {len(value)}/{limit}")
