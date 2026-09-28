#!/usr/bin/env bash
# Builds public/ for publishing, the same way for the site and for a branch
# preview — deploy-pages.yml and preview.yml both run it, and an assembly step
# added to one of them used to have to be added to the other (#329).
#
#   scripts/build-site.sh <commit-sha>
#
# In the checkout, never committed back:
# - the pending entries of changelog.d/ become the changelog the app imports
#   (scripts/changelog.mjs), so a pull request adding one shows it on its own
#   preview;
# - every page and its JavaScript are stamped with the build they belong to
#   (scripts/stamp-version.mjs, public/js/version.js).
set -euo pipefail

sha=${1:?usage: scripts/build-site.sh <commit-sha>}
cd "$(dirname "$0")/.."
node scripts/changelog.mjs build
node scripts/stamp-version.mjs "${sha::12}"
