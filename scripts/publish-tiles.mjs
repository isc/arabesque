#!/usr/bin/env node
// scripts/publish-tiles.mjs
//
// Puts compare-library.mjs's tiles where a pull request description can show
// them, and points the description's image links at them.
//
//   node scripts/publish-tiles.mjs <tiles dir> <branch> [description.md ...]
//
// The tiles go into one commit with no parent, pushed as <branch> (replaced if
// it exists), so they never touch main's history: CI and the previews run on
// pull requests and on main only, so the push starts nothing. Each markdown
// file given has its `](tiles/<name>)` links rewritten in place to that
// commit's raw.githubusercontent.com URLs, which GitHub shows inline because
// the repository is public. The branch can be deleted once the pull request
// is merged; the images in a merged description then stop showing.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, branch, ...descriptions] = process.argv.slice(2)
if (!dir || !branch) {
  console.error('usage: node scripts/publish-tiles.mjs <tiles dir> <branch> [description.md ...]')
  process.exit(2)
}
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8' }).trim()

const entries = readdirSync(dir).filter((name) => name.endsWith('.png')).sort()
  .map((name) => `100644 blob ${git(['hash-object', '-w', join(dir, name)])}\t${name}`)
const tree = git(['mktree'], `${entries.join('\n')}\n`)
const commit = git(['commit-tree', tree, '-m', `Library comparison tiles (${branch})`])
git(['push', '--quiet', '--force', 'origin', `${commit}:refs/heads/${branch}`])

const [, repo] = git(['remote', 'get-url', 'origin']).match(/github\.com[:/](.+?)(?:\.git)?$/)
const raw = `https://raw.githubusercontent.com/${repo}/${commit}/`
for (const file of descriptions) {
  const text = readFileSync(file, 'utf8')
  writeFileSync(file, text.replace(/\]\(tiles\/([^)]+)\)/g, (_, name) => `](${raw}${encodeURIComponent(name)})`))
}
console.log(`${entries.length} tiles in ${branch}: ${raw}`)
