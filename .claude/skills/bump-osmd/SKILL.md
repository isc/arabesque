---
name: bump-osmd
description: Bump the vendored OpenSheetMusicDisplay (OSMD) to a new release end to end — vendor file, references, breaking changes checked against the app, stopgaps the release makes redundant, tests, library comparison, changelog, pull request. Use when a new OSMD release is out or when asked to upgrade OSMD. charras runs it unattended when a release appears.
---

# Bumping OSMD

The goal is a pull request the maintainer can merge after one read: what the
release changes for the app, the stopgaps it retires, and what players will
see, with the evidence for each. isc/arabesque#550 (3.0.0) is the model.
Nothing is merged without the maintainer.

Run everything from the repository root. Work files go under `tmp/` (ignored
by git).

**Unattended.** charras runs this skill on its own clone when a release
appears (home-infra `charras/maj-osmd`), without access to GitHub. When
`tmp/maj-osmd/context.md` exists, it says what is done already (the branch,
`npm ci`, the vendoring) and holds what the steps below would read on GitHub:
the release notes, the stopgap table, the open issues. Use it in their place.
End with the commit and `tmp/pr-body.md`; maj-osmd publishes the tiles,
pushes and opens the pull request.

## 1. The release

Read the notes of **every** release after the shipped one, not only the
target's: a breaking change can sit in an intermediate one.

```bash
gh release list --repo opensheetmusicdisplay/opensheetmusicdisplay --limit 10
gh release view <version> --repo opensheetmusicdisplay/opensheetmusicdisplay
```

## 2. Vendor file and references

```bash
git checkout -b bump-osmd-<version with dashes>   # e.g. bump-osmd-3-0-0
node scripts/vendor-osmd.mjs <version>
```

It unpacks both npm packages under `tmp/osmd/<version>/package` (the bundle
is `build/opensheetmusicdisplay.min.js`, the API `build/dist/src/**/*.d.ts`),
swaps the vendored bundle, renames every reference to it and stages it all.

## 3. Breaking changes, against the app

For each breaking or behaviour change in the notes, decide whether the app
reaches it, and write down why:

- What the app calls: `grep -rnoE "(osmd|opensheetmusicdisplay)\.[A-Za-z_]+" public/js`,
  the `EngravingRules` it sets (`rules\.[A-Za-z_]+ =`), and `render()`,
  `load()`, `Zoom`, `cursor`, `setLogLevel`.
- What disappeared: diff the two packages' `.d.ts` for removed or renamed
  members the app uses.
- The SVG: the app and the browser tests read OSMD's SVG. 2.3.0 changed its
  shape (a notehead is one `path.vf-notehead`, measure groups are
  `osmd-m<index>-<staff>`, `measure-number` became `osmd-measure-number`,
  staff lines sit in `g.vf-stave`). A browser suite that fails right after a
  bump: look for renamed SVG classes first.

A breaking change that does reach the app is fixed in the same pull request.

## 4. Stopgaps

Every citation of an OSMD pull request outside the vendored bundles is a
stopgap or a test waiting for upstream. `node scripts/osmd-stopgaps.mjs <version>`
lists them, each with whether the release carries it.

For each one the release carries, remove the stopgap, and keep the test that
covers the behaviour, rewording its comment (at 3.0.0, `reserveRepetitionWords`
went and `test/engraving_test.rb` stayed). An open isc/arabesque issue
tracking it is closed by the pull request (`Closes isc/arabesque#N`). Never
write a closing keyword next to an OSMD reference: "Fixes
opensheetmusicdisplay#N" closed the upstream PR once.

## 5. Tests

```bash
npx vitest run
scripts/test-in-docker.sh
```

(`bundle exec rake test:parallel` instead of Docker where Ruby and Chrome are
installed.) A failure is fixed, not reported. If it can't be — or step 6 shows
a regression you can't fix — commit what you have anyway, and start the
description with a `## Blocked` section: what fails, and what you tried.
Unattended, that opens the pull request as a draft.

## 6. The library

```bash
node scripts/compare-library.mjs
```

It renders all of `public/scores` with the branch's base and with the working
tree, and writes `tmp/compare-library/report.md`: which scores differ, and
for each its tiles, before on the left. Look at every tile (Read shows the
image), and sort the differences by cause, tying each to a line of the release
notes where one fits. A difference no release note explains, or one that looks
worse, is a finding: it goes first in the description. Page errors only on the
working tree are a regression. To read a score's MusicXML, `unzip -l` lists a
`.mxl` and `unzip -p <score> <entry>` prints it.

## 7. Changelog

If players will see a difference, a fragment `changelog.d/<date>-<slug>.md`
(format in `scripts/changelog.mjs`, wording rule in CLAUDE.md), then
`npx vitest run test/js/changelog.test.js`. At 3.0.0: "Les partitions sont
mieux gravées…".

## 8. Commit and pull request

One commit titled `Bump OSMD to <version>` (maj-osmd recognises a bump made by
hand by this title), its body saying what the release changes for the app, as
#550's does. Write the message to `tmp/commit-msg.txt` and
`git commit -F tmp/commit-msg.txt`.

The description, in English, in `tmp/pr-body.md`, in this order:

1. `## Blocked`, only when step 5 says so.
2. One sentence: the release and whether any breaking change reaches the app.
3. **Breaking changes**: each, and why it does or doesn't reach the app.
4. **Stopgaps removed**: each, with the upstream PR and the test that still
   covers it. Or none.
5. **Library check**: `N of M pixel-identical`, then the differences grouped
   by cause, each group naming its scores and showing one or two tiles with
   the image lines `report.md` gives. Every page error.
6. **Tests**: vitest and the browser suite, with their counts.

Then, by hand (unattended, maj-osmd does it):

```bash
node scripts/publish-tiles.mjs tmp/compare-library/tiles tmp/pr-body.md
git push -u origin HEAD
gh pr create --title "Bump OSMD to <version>" --body-file tmp/pr-body.md
```
