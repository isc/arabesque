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

**Unattended.** When a release appears, charras runs this skill on its own
clone (home-infra `charras/maj-osmd`), on the branch `bump-osmd-<version>`.
It has already done steps 1 and 2 and written `tmp/maj-osmd/context.md`
(versions, every release's notes, the stopgaps and whether the target carries
their PR). You end with the commit and `tmp/pr-body.md`; it publishes the
tiles, pushes and opens the pull request.

## 1. The release

- Current version: `ls public/vendor/opensheetmusicdisplay.*.min.js`.
- Target: the latest release, `gh release view --repo opensheetmusicdisplay/opensheetmusicdisplay`.
- Read the notes of **every** release after the current one, not only the
  target's: a breaking change can sit in an intermediate one.
- Both packages, for their type definitions:
  `npm pack opensheetmusicdisplay@<version>` in `tmp/osmd/<version>/`, then
  untar. `package/build/opensheetmusicdisplay.min.js` is the vendored file,
  `package/build/dist/src/**/*.d.ts` the API.

## 2. Vendor file and references

```bash
git mv public/vendor/opensheetmusicdisplay.<old>.min.js public/vendor/opensheetmusicdisplay.<new>.min.js
cp tmp/osmd/<new>/package/build/opensheetmusicdisplay.min.js public/vendor/opensheetmusicdisplay.<new>.min.js
git grep -l 'opensheetmusicdisplay\.<old>\.min\.js'   # then replace in each
```

At 3.0.0 the references were `public/score.html`, `test/js/swFetch.test.js`
and `test/js/swShell.test.js`.

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
stopgap or a test waiting for upstream:

```bash
grep -rnE 'opensheetmusicdisplay(/pull/|#)[0-9]+' --exclude-dir=vendor --exclude-dir=node_modules public test scripts
```

For each, is the pull request in the target release (merged, and its merge
commit in the tag: `git tag --contains <sha>` in an OSMD clone, or the release
notes)? If so, remove the stopgap, and keep the test that covers the
behaviour, rewording its comment (at 3.0.0, `reserveRepetitionWords` went and
`test/engraving_test.rb` stayed). An open isc/arabesque issue tracking it is
closed by the pull request (`Closes isc/arabesque#N`). Never write a closing
keyword next to an OSMD reference: "Fixes opensheetmusicdisplay#N" closed the
upstream PR once.

## 5. Tests

```bash
npx vitest run > tmp/vitest.txt 2>&1; tail -20 tmp/vitest.txt
scripts/test-in-docker.sh > tmp/test-output.txt 2>&1; tail -40 tmp/test-output.txt
```

(`bundle exec rake test:parallel` instead of Docker where Ruby and Chrome are
installed.) A failure is fixed, not reported: the pull request opens green.

## 6. The library

```bash
node scripts/compare-library.mjs > tmp/compare.txt 2>&1; cat tmp/compare.txt
```

It renders all of `public/scores` with `origin/main` and with the working
tree, and writes `tmp/compare-library/report.md` and, for each score that
differs, `tiles/<score>.png`: the first differing tile, before on the left.
Look at every tile (Read shows the image), and sort the differences by cause,
tying each to a line of the release notes where one fits. A difference no
release note explains, or one that looks worse, is a finding: say so first
in the pull request. Page errors only on the working tree are a regression.

## 7. Changelog

If players will see a difference, a fragment `changelog.d/<date>-<slug>.md`
(format in `scripts/changelog.mjs`, wording rule in CLAUDE.md), then
`npx vitest run test/js/changelog.test.js`. At 3.0.0: "Les partitions sont
mieux gravées…".

## 8. Commit and pull request

Branch `bump-osmd-<version>` (dots become dashes), one commit titled
`Bump OSMD to <version>`, its body saying what the release changes for the
app, as #550's does.

The pull request description, in English, in this order:

1. One sentence: the release and whether any breaking change reaches the app.
2. **Breaking changes**: each, and why it does or doesn't reach the app.
3. **Stopgaps removed**: each, with the upstream PR and the test that still
   covers it. Or none.
4. **Library check**: `N of M pixel-identical`, then the differences grouped
   by cause, each group naming its scores and showing one or two tiles as
   images (`![<score>](tiles/<score>.png)`). Every page error.
5. **Tests**: vitest and the browser suite, with their counts.

Write the description to `tmp/pr-body.md`, then publish the tiles, which
rewrites those image links, and open the pull request:

```bash
node scripts/publish-tiles.mjs tmp/compare-library/tiles osmd-compare-<version> tmp/pr-body.md
git push -u origin bump-osmd-<version>
gh pr create --title "Bump OSMD to <version>" --body-file tmp/pr-body.md
```

Unattended, maj-osmd runs these three from your answer.
