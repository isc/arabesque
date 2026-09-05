## Critical Rules

**IMPORTANT:** Always open a PR to make changes, never commit directly to main.

**IMPORTANT:** When merging PRs, always use squash merge: `gh pr merge --squash`

**IMPORTANT:** Before committing and pushing a code change, run `/simplify`
(a review on four angles: reuse, simplification, efficiency, altitude). Apply
the findings that hold, skip the false positives, then commit. Skip the whole
step for purely trivial changes — docs, this file, a version bump, an isolated
typo fix. For a very short diff that only reflects code already reviewed, a
self-review on the four angles is enough; no need to spawn the subagents again.

**IMPORTANT:** When running tests, ALWAYS save output to temp file (never pipe to tail):
```bash
bundle exec rake test:parallel > tmp/test-output.txt 2>&1; cat tmp/test-output.txt
```
`test:parallel` splits the suite across processes and prints a combined
summary; `rake test` still runs everything serially in one process, which is
what you want when debugging a single test.

It defaults to `min(cores, 8)` (`TEST_WORKERS=n` to override). Eight is where
the wall clock stops improving on both machines measured — 16-core Linux and
8-core Mac — because with ~66 tests, eight workers already leave a handful
each and the slowest single test sets the floor. Going wider buys nothing and
still loses a test to timing now and then. For the same reason CI does not run
workers inside a runner; it uses `rake test:shard` (`SHARD_INDEX`/`SHARD_COUNT`)
to give each slice a runner of its own.

No Ruby or Chrome on the machine? `scripts/test-in-docker.sh` runs any of the
above in a container built from `test/Dockerfile`, on the same Ruby as CI:
```bash
scripts/test-in-docker.sh                              # the whole suite
scripts/test-in-docker.sh ruby -Itest test/data_test.rb  # one file
CPUS=4 scripts/test-in-docker.sh rake test             # mimic a CI runner
```

PR titles and descriptions must be in English.

## Branch previews

Every pull request is deployed at
`https://arabesque.app/previews/<branch-slug>/library.html` (slug: the branch
name with anything but letters, digits and `-` turned into `-`), refreshed on
each push and removed when the PR closes; `.github/workflows/preview.yml`
posts the link as a sticky comment. Production and previews are both served
from the `gh-pages` branch — `deploy-pages.yml` publishes `public/` at its
root, previews go under `previews/`. A preview is on the same origin as
production, so it reads and writes the same IndexedDB and localStorage: runs
played on a preview land in the real practice journal.

## Library

**IMPORTANT:** After adding or removing a score (editing `public/data/scores.json`
and the file in `public/scores/`), regenerate the fingerprints so the score is
findable by playing its opening notes on the MIDI keyboard:
```bash
ruby scripts/generate_fingerprints.rb
```
`public/data/fingerprints.json` must stay in sync with the catalog: one
fingerprint per score file, including each part of a collection.

A catalog entry with `parts: [{title, file}]` instead of `file` is a
**collection** (e.g. the Hanon exercises): one library row, a part navigator on
the score page, and practice data, fingerings and fingerprints kept per part
file. The Hanon files were produced by `scripts/split_hanon.rb` from the
combined MuseScore export.

## Changelog in-app

`public/js/changelog.js` feeds the "Nouveautés" modal on the library page. The
bar is high: an entry must be worth the reader's time. Add **real user-facing
changes** here — a new feature, a notable behaviour change, a fix the player
would have noticed. Do NOT add per-score notation fixes, refactors, CI, lint, or
purely technical changes. When in doubt, leave it out.

Entries are **bilingual**: each entry's `items` is `{ fr: [...], en: [...] }`
with the same count in the same order. New entries must include both languages
(the modal shows the active UI language via `changelogItems()` in library.js).

**IMPORTANT:** After shipping a significant feature, add a French entry at the
top of `CHANGELOG` (antechronological order), grouping items under the
publication date (`YYYY-MM-DD`). Keep each item short and concrete.

## User feedback

The app's Feedback button files into `public.feedback` on Supabase. The anon key
the frontend ships can only INSERT, so reading happens out of band — through the
Management API, with the token the Supabase CLI already keeps outside the repo:

```bash
node scripts/feedback.mjs list          # what is still to deal with
node scripts/feedback.mjs treat <id>    # mark one as dealt with
```

The header of `scripts/feedback.mjs` has the rest (`show`, `untreat`, flags).
Each new feedback also emails ivan.schneider@hey.com, so there is nothing to poll.

`supabase/feedback.sql` is the canonical DDL — the project has no migration
system, so a schema change is applied by hand **and** written there.

## Playwright Browser Testing

Use the **Playwright CLI** (`@playwright/cli`, already a devDependency — binary at
`node_modules/.bin/playwright-cli`) rather than the MCP `browser_*` tools. Snapshots and
console logs are written to disk under `.playwright-cli/` instead of being streamed into
context (~4× fewer tokens), and the browser session persists between Bash commands.

Pass `-s=<session>` to keep a named, persistent session across commands:

```bash
playwright-cli -s=pt open http://localhost:4567/   # open + navigate
playwright-cli -s=pt goto http://localhost:4567/score.html
playwright-cli -s=pt snapshot                        # writes ref-annotated snapshot to disk
playwright-cli -s=pt eval "() => document.title" --raw
playwright-cli -s=pt click e15                       # interact via refs from the snapshot
playwright-cli -s=pt close
```

`--raw` prints only the result value (no status banner). Run `playwright-cli --help` for the
full command list. Interactive exploration works the same way — `snapshot` to get element
refs, then `click`/`fill`/`eval` against them.

## App Store screenshots and review video

`scripts/demo/capture.sh` regenerates the whole screenshot set from real
simulators — run it after any UI change the listing shows. `scripts/demo/record.sh`
records the walkthrough App Review needs, since a reviewer has no MIDI keyboard.
Both seed a practice history and play a piece through the mock MIDI input, and
both work on a throwaway copy of `public/` — no demo hook ever ships. See
`scripts/demo/README.md`, which also has the wording for the review notes.

`scripts/appstore/push_listing.py` writes the listing itself — description,
keywords, URLs, categories, age rating, screenshots — through the App Store
Connect API, from the copy in `scripts/appstore/listing_fr.py`. It never
submits for review, and App Privacy has no API and stays manual.

`scripts/appstore/testflight_invite.py <email>` invites a TestFlight tester,
making the external group, build attachment and beta review submission it needs
on the way; `--status` reports where the review is. Credentials for both live
outside the repo; see `scripts/appstore/README.md`.

## New HTML pages

Every page carries `<meta name="app-version" content="dev" />` and loads
`<script type="module" src="js/version.js"></script>` ahead of its entry
script — that is how a page notices it was served with another deploy's
JavaScript and reloads itself once (`public/js/version.js` explains why).
`scripts/stamp-version.mjs` fails at deploy time if a page is missing either
marker, and `test/js/version.test.js` catches it earlier.

A page of the app itself — not the landing, privacy or support pages — also
loads `<script type="module" src="js/swRegister.js"></script>`, which installs
the offline cache (`public/sw.js`), and carries the two install markers that
travel with it — a manifest without a worker is not installable:

```html
<link rel="manifest" href="manifest.webmanifest" />
<meta name="theme-color" content="#f7f7f9" />
```

`test/js/swShell.test.js` asserts that the set of pages carrying the manifest is
exactly the set registering the worker, and that the theme colour matches the
manifest's. The precache list is generated from
`public/` by the same deploy step, so a new file is covered without being
listed anywhere; add a new top-level directory to `SHELL_SKIP` in
`scripts/stamp-version.mjs` if it must stay out.

Neither mechanism runs from a checkout: both sides say `dev` there, so the
version check never fires and the worker is never registered. To exercise the
worker, stamp a version in (`node scripts/stamp-version.mjs testsha`), serve
`public/` over HTTPS or localhost, and put it back with
`node scripts/stamp-version.mjs dev` — the manifest is deliberately not
committed.

## Code Style

- Focus on writing DRY code
- `public/styles.css` is the whole stylesheet, in three layers: design tokens,
  a base layer (reset, typography, container, buttons, form controls — what
  Pico CSS used to supply), then the application's own `.pt-*` components.
  Reach for an existing token or component before adding CSS, and put anything
  generic enough to be reused in the base layer rather than in a page rule.
