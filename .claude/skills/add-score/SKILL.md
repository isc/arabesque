---
name: add-score
description: Add a piece to Arabesque's library end to end — find candidate MusicXML transcriptions (PDMX, then musescore.com), compare them against each other and a proofread reference edition, build one clean file, wire it into the catalog, and open a pull request for review on the branch preview. Use when asked to add a score/partition/morceau to the library, when a player's feedback requests a piece, or when checking an existing score against a reference edition.
---

# Adding a score to the library

The goal is a pull request the maintainer only has to review on the branch
preview: every choice made along the way is written in its description, with
the evidence for it. Nothing is merged without that review.

Run everything from the repository root. Work files go under `tmp/<slug>/`
(ignored by git).

## 1. Candidates

**PDMX first.** It is the only source usable without a browser, and its
licences (public domain or CC0) let a file ship in the app with no question
asked.

```bash
python3 scripts/scores/pdmx.py setup                # once per machine, ~2.1 GB
python3 scripts/scores/pdmx.py search burgmuller arabesque --piano
python3 scripts/scores/pdmx.py get 5849868 5891761 --to tmp/arabesque
```

Search several phrasings — the title as uploaders write it varies ("Inventio
1", "BWV 772", "Invention No 1"); a word the title lacks, such as the
composer, silently drops a candidate. Keep up to four, preferring views and
votes, one part (a piano score), a MuseScore 3+ export. Drop arrangements for
other instruments even when their notes look right: the page tells the hands
apart by staff, and an arrangement's staves are not a pianist's.

**Then musescore.com, only if PDMX has nothing usable** — it stops in 2023
and leaves out every free score whose uploader kept "all rights reserved".
That needs the maintainer's own logged-in browser (Claude in Chrome), and the
download lands on that browser's machine: if it is not the machine this
session runs on, stop and ask the maintainer to pass the files over. Never try
to get past musescore.com's bot protection. A file under "all rights
reserved" is a transcription its uploader still owns, even of a public-domain
work — say so in the pull request rather than decide it silently.

## 2. Reference edition

A proofread encoding is what turns "the files disagree" into "this file is
wrong", and it also catches the mistake every upload copied from the same
source. Humdrum **kern editions exist for much of the core repertoire:

| Repertoire | Repository (`kern/` directory) |
|---|---|
| Bach two-part inventions | `humdrum-tools/inventions` (`inven01.krn`…) |
| Bach Well-Tempered Clavier | `humdrum-tools/bach-wtc` (`wtc1p02.krn` = book 1 prelude 2) |
| Beethoven sonatas | `craigsapp/beethoven-piano-sonatas` |
| Mozart sonatas | `craigsapp/mozart-piano-sonatas` |
| Haydn sonatas | `craigsapp/haydn-piano-sonatas` |
| Chopin preludes, mazurkas | `craigsapp/chopin-preludes`, `craigsapp/chopin-mazurkas` |
| Scarlatti sonatas | `craigsapp/scarlatti-keyboard-sonatas` |
| Joplin | `craigsapp/joplin` |
| Scriabin, Hummel preludes | `craigsapp/scriabin`, `craigsapp/hummel-preludes` |

```bash
curl -s https://api.github.com/repos/humdrum-tools/inventions/contents/kern   # list the files
curl -so tmp/inv1/inven01.krn https://raw.githubusercontent.com/humdrum-tools/inventions/main/kern/inven01.krn
```

Read the file's `!!!` header: it names the edition it follows (Bach-
Gesellschaft, Henle...). When there is none for the piece, the candidates are
judged against each other only, and the pull request says so.

## 3. Compare

```bash
python3 scripts/scores/compare.py --ref tmp/inv1/inven01.krn tmp/inv1/*.mxl
```

The header of `scripts/scores/compare.py` explains the report. In short: per
file, what it carries (fingerings, slurs, dynamics, ornaments) and the
defects that have cost a pull request before (left hand on the treble staff,
doubled notes, playback tempo numbers, a template's title, another
instrument); then every measure where a file departs from the reference, or
from the majority when there is no reference; then ornaments.

Choosing the base: **correct notes first, then the least to repair, then the
richest markings.** A file with 100 fingerings and one wrong note is a better
base than a bare correct one — the note is one edit, the fingerings are not.

Reading a dispute:
- A departure from the reference in one file only is that file's mistake.
- A departure every file shares is the one to look at hardest: either the
  uploads copy one source, or the reference follows another edition. Check
  the reference's edition, the pattern of the neighbouring bars, and the
  fingering — a fingering written for a note shows what the engraver read
  (#361). If it stays unclear, keep the base's reading and ask in the PR.
- A file that writes an ornament out as notes (32nd-note triplets where the
  reference has a sign) is realising it, not wrong — but it is not a base.
- An old reference with both hands in one spine cannot say which staff a note
  belongs on; the report then compares pitches only, and says so.

## 4. Build the file

Edit the base's MusicXML with a short Python script under `tmp/` (standard
library `zipfile` + regular expressions, as the existing edits did), asserting
each substitution matched exactly once. What is always done:

- `work-title` and the title credit as the catalog title
  (`Invention No. 1 in C Major`), composer credit and `creator` as the library
  writes it (`J.S. Bach`, `J. S. Bach` on the page) — no leftover template
  title, no uploader's "(Earlier version)", no "Public Domain" credit line.
- Keep `identification/source`: it is how a later fix finds the upload.
- Each note corrected against the reference; an ornament added or removed
  only where the reference *and* another file agree against the base.
- Fingerings from another file only if the base has few: match them note for
  note **by voice, not by staff** (#363).
- Write the archive as `META-INF/container.xml` + `score.xml`, into
  `public/scores/<Title_With_Underscores>.mxl`.

Then run `compare.py --ref` on the result: the goal is 0 measures in dispute,
or only those the PR explains.

## 5. Wire it in

- `public/data/scores.json`: one entry, next to its siblings (same composer,
  same set).
- Fingerprints: `ruby scripts/generate_fingerprints.rb`, or
  `scripts/test-in-docker.sh ruby scripts/generate_fingerprints.rb` when the
  machine has no Ruby. Check the new line's notes are the piece's opening.
- Look at it: serve `public/` (`cd public && python3 -m http.server 4599`),
  open `score.html?url=scores%2F<file>.mxl` with `playwright-cli`, take a
  full-page screenshot and read it — title, clefs, the last bar, anything the
  report flagged.
- Tests: `scripts/test-in-docker.sh` (or `bundle exec rake test:parallel`).
  `test/library_test.rb` counts search results by composer, so adding a piece
  can move a count; update it, do not work around it.
- A changelog fragment in `changelog.d/` (see CLAUDE.md), short.

## 6. Pull request

Title `Add <Composer>'s <piece> to the library`. The description is the
review: candidates considered and why each was dropped, the base and why,
every correction with bar and reference, whatever was left for the maintainer
to decide, the licence of what ships. #361 and #363 are the model. Then post
the preview link from CLAUDE.md and stop — the maintainer reviews on the
preview and merges.
