#!/usr/bin/env node
// scripts/publish-tiles.mjs
//
// Puts compare-library.mjs's tiles where a pull request description can show
// them, and points the description's image links at them.
//
//   node scripts/publish-tiles.mjs <tiles dir> <description.md>
//
// The tiles go into one commit on the branch `comparison-tiles`, which holds
// nothing else: each publication is a commit whose tree is that run's tiles
// alone, on top of the previous one, so the branch never touches main's
// history and the images of an older description stay reachable. CI and the
// previews run on pull requests and main only, so the push starts nothing.
// The description's `](tiles/<name>)` links are rewritten in place to that
// commit's raw.githubusercontent.com URLs, which GitHub shows inline because
// the repository is public.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BRANCH = 'comparison-tiles'
const [dir, description] = process.argv.slice(2)
if (!dir || !description) {
  console.error('usage: node scripts/publish-tiles.mjs <tiles dir> <description.md>')
  process.exit(2)
}
// stderr kept from the terminal: the first publication's fetch fails by design, and the push echoes GitHub's
// "Create a pull request" hint for a branch nobody opens one from.
const git = (args, input) => execFileSync('git', args, { input, encoding: 'utf8', stdio: 'pipe' }).trim()

const names = readdirSync(dir).filter((name) => name.endsWith('.png')).sort()
const blobs = git(['hash-object', '-w', '--stdin-paths'], names.map((name) => join(dir, name)).join('\n')).split('\n')
const tree = git(['mktree'], `${names.map((name, i) => `100644 blob ${blobs[i]}\t${name}`).join('\n')}\n`)
let parent = []
try {
  git(['fetch', '--quiet', 'origin', `refs/heads/${BRANCH}`])
  parent = ['-p', 'FETCH_HEAD']
} catch {} // the first publication starts the branch
const commit = git(['commit-tree', tree, ...parent, '-m', `Library comparison tiles for ${git(['branch', '--show-current'])}`])
git(['push', '--quiet', 'origin', `${commit}:refs/heads/${BRANCH}`])

const [, repo] = git(['remote', 'get-url', 'origin']).match(/github\.com[:/](.+?)(?:\.git)?$/)
const raw = `https://raw.githubusercontent.com/${repo}/${commit}/`
writeFileSync(description, readFileSync(description, 'utf8')
  .replace(/\]\(tiles\/([^)]+)\)/g, (_, name) => `](${raw}${encodeURIComponent(name)})`))
console.log(`${names.length} tiles at ${raw}`)
