#!/usr/bin/env bash
# The branch previews a player can open from the ⚙️ menu (public/js/previews.js),
# written to previews/index.json in a checkout of gh-pages as
# [{"number": 561, "title": "…", "slug": "…"}], newest pull request first, and
# committed there if that changed it. The push is the caller's.
#
#   scripts/preview-index.sh <gh-pages-checkout>
#
# Rebuilt whole every time rather than edited, from the two things that are
# true right now: the pull requests still open, and the previews the checkout's
# HEAD holds. So a title edited since, a cleanup that failed, a preview left
# behind before this index existed, or two runs let out of the queue in the
# wrong order all come right at the next write, whoever makes it.
# preview.yml runs it after publishing a preview, preview-cleanup.yml after
# removing one. A preview whose pull request is closed stays out, even if its
# directory outlived the cleanup; one not published yet stays out until it is.
#
# Reads from HEAD with ls-tree, never from the working tree, so a sparse,
# blob-less checkout is enough: preview.yml checks out nothing but the index.
# Needs gh, with GH_TOKEN and GH_REPO in the environment.
set -euo pipefail

site=${1:?usage: scripts/preview-index.sh <gh-pages-checkout>}
here=$(dirname "$0")

published=$(git -C "$site" ls-tree --name-only HEAD previews/ | sed 's|^previews/||')

mkdir -p "$site/previews"
gh pr list --state open --limit 100 --json number,title,headRefName |
  jq -c '.[]' |
  while read -r pr; do
    # The branch through an argument, as everywhere: its author chose it.
    slug=$("$here/preview-slug.sh" "$(jq -r .headRefName <<<"$pr")") || continue
    grep -qxF "$slug" <<<"$published" || continue
    jq -c --arg slug "$slug" '{number, title, slug: $slug}' <<<"$pr"
  done |
  jq -s 'sort_by(-.number)' >"$site/previews/index.json"

# Unchanged on most pushes to a pull request: then no commit, and no Pages build.
git -C "$site" add previews/index.json
git -C "$site" diff --cached --quiet ||
  git -C "$site" -c user.name='github-actions[bot]' -c user.email='github-actions[bot]@users.noreply.github.com' \
    commit -qm 'previews: update the index'
