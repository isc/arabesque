#!/usr/bin/env bash
# The directory a branch's preview lives in, under previews/ on gh-pages: the
# branch name with every run of characters other than letters, digits and `-`
# turned into one `-`. preview.yml publishes there and preview-cleanup.yml
# removes it, so both ask this script rather than keep a copy of the rule.
#
#   scripts/preview-slug.sh <branch>
#
# The branch comes in as an argument, never pasted into the workflow's shell:
# a branch name is chosen by whoever opens the pull request.
set -euo pipefail

slug=$(printf '%s' "${1:?usage: scripts/preview-slug.sh <branch>}" | tr -c 'a-zA-Z0-9-' '-' | tr -s '-' | sed 's/^-//; s/-$//')
# Empty for a name with nothing but other characters, and an empty slug names
# previews/ itself: the cleanup would remove every branch's preview.
[ -n "$slug" ] || { echo "no preview slug for branch '$1'" >&2; exit 1; }
printf '%s\n' "$slug"
