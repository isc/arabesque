#!/usr/bin/env node
// scripts/vendor-osmd.mjs
//
// The mechanical part of an OSMD bump (.claude/skills/bump-osmd): swaps the
// vendored bundle for another release and renames every reference to it.
//
//   node scripts/vendor-osmd.mjs <version>
//
// Both npm packages, the shipped one and <version>, are unpacked under
// tmp/osmd/<version>/package (build/opensheetmusicdisplay.min.js is the
// bundle, build/dist/src/**/*.d.ts the API, to diff for removed members). The
// bundle is renamed with git mv and replaced, and every tracked file outside
// public/vendor that names the old file gets the new name (at 3.0.0:
// public/score.html and the two service-worker tests). Everything is staged.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/vendor-osmd.mjs <version>')
  process.exit(2)
}
const run = (cmd, args, options) => execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim()
const bundle = (version) => `opensheetmusicdisplay.${version}.min.js`

const shipped = readdirSync('public/vendor')
  .map((name) => name.match(/^opensheetmusicdisplay\.(.+)\.min\.js$/)?.[1]).find(Boolean)
if (shipped === target) {
  console.log(`public/vendor already ships OSMD ${target}.`)
  process.exit(0)
}

for (const version of [shipped, target]) {
  const folder = join('tmp/osmd', version)
  mkdirSync(folder, { recursive: true })
  const tarball = run('npm', ['pack', '--silent', `opensheetmusicdisplay@${version}`], { cwd: folder })
  run('tar', ['xzf', tarball], { cwd: folder })
}

run('git', ['mv', `public/vendor/${bundle(shipped)}`, `public/vendor/${bundle(target)}`])
copyFileSync(join('tmp/osmd', target, 'package/build/opensheetmusicdisplay.min.js'), `public/vendor/${bundle(target)}`)
let referencing = []
try {
  referencing = run('git', ['grep', '-l', '-F', bundle(shipped), '--', '.', ':!public/vendor']).split('\n')
} catch {} // git grep exits 1 when nothing matches
for (const file of referencing) {
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(bundle(shipped), bundle(target)))
}
run('git', ['add', '-A', 'public/vendor', ...referencing])

console.log(`OSMD ${shipped} → ${target}: public/vendor/${bundle(target)}, renamed in `
  + `${referencing.join(', ') || 'no other file'}; staged. Packages in tmp/osmd/${shipped} and tmp/osmd/${target}.`)
