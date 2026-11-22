#!/usr/bin/env node
// scripts/osmd-stopgaps.mjs
//
// Every OSMD pull request the repository cites outside the vendored bundles —
// a stopgap waiting for upstream, or a test that documents one — with its
// state and, given a release, whether that release carries it.
//
//   node scripts/osmd-stopgaps.mjs [<version>]
//
// One markdown line per pull request, for the bump-osmd skill (step 4) and for
// charras's maj-osmd, which puts them in the context of an unattended bump. A
// pull request is in a release when its merge commit is: GitHub's compare API
// says the tag is ahead of it or identical to it. Needs gh.

import { execFileSync } from 'node:child_process'

const OSMD = 'opensheetmusicdisplay/opensheetmusicdisplay'
const target = process.argv[2]
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

let grep = ''
try {
  grep = run('git', ['grep', '-nE', 'opensheetmusicdisplay(/pull/|#)[0-9]+', '--', '.', ':!public/vendor'])
} catch {} // git grep exits 1 when nothing matches

const cited = new Map()
for (const line of grep.split('\n').filter(Boolean)) {
  const [path, number] = line.split(':')
  for (const [, pr] of line.matchAll(/opensheetmusicdisplay(?:\/pull\/|#)(\d+)/g)) {
    cited.set(pr, [...(cited.get(pr) || []), `${path}:${number}`])
  }
}
if (!cited.size) {
  console.log('No OSMD pull request cited outside the vendored bundles.')
  process.exit(0)
}

for (const [pr, places] of [...cited].sort(([a], [b]) => a - b)) {
  const { title, state, mergeCommit } = JSON.parse(run('gh', ['pr', 'view', pr, '--repo', OSMD, '--json', 'title,state,mergeCommit']))
  let status = state.toLowerCase()
  if (state === 'MERGED' && target) {
    const compare = run('gh', ['api', `repos/${OSMD}/compare/${mergeCommit.oid}...${target}`, '--jq', '.status'])
    status = ['ahead', 'identical'].includes(compare) ? `merged, in ${target}` : `merged, NOT in ${target}`
  }
  console.log(`- #${pr} « ${title} »: ${status}. Cited at ${places.join(', ')}.`)
}
