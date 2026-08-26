## Critical Rules

**IMPORTANT:** Always open a PR to make changes, never commit directly to main.

**IMPORTANT:** When merging PRs, always use squash merge: `gh pr merge --squash`

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

## New HTML pages

Every page carries `<meta name="app-version" content="dev" />` and calls
`checkAppVersion()` first thing in its module script. HTML and JS are cached
independently by the browser, so this is how a page notices it was paired with
another deploy's scripts and reloads itself once (`public/js/version.js`). The
deploy rewrites both sides with the commit via `scripts/stamp-version.mjs`,
which fails if a page is missing the marker; `test/js/version.test.js` catches
it earlier.

## Code Style

- Focus on writing DRY code
- `public/styles.css` is the whole stylesheet, in three layers: design tokens,
  a base layer (reset, typography, container, buttons, form controls — what
  Pico CSS used to supply), then the application's own `.pt-*` components.
  Reach for an existing token or component before adding CSS, and put anything
  generic enough to be reused in the base layer rather than in a page rule.
