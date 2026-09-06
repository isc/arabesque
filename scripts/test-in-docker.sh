#!/usr/bin/env bash
# Run the browser suite in a container — no Ruby or Chrome needed on the host.
#
#   scripts/test-in-docker.sh                       # rake test:parallel
#   scripts/test-in-docker.sh rake test             # anything else
#   scripts/test-in-docker.sh ruby -Itest test/library_test.rb
#   scripts/test-in-docker.sh --stop                # drop every test container
#
# CPUS=4 mimics a GitHub runner, which is what you want when reproducing a CI
# failure; leave it unset to use the whole machine.
#
# Commands go into a container that stays up between runs. Creating one per
# command was most of the wall clock — about 2s of setup around a test whose
# body takes 0.9s — where `docker exec` costs 0.10s.
#
# What is left is 0.3s of Ruby and bundler and ~1.4s of `require "test_helper"`,
# and it is worth knowing where that second and a half actually goes, because an
# earlier version of this comment guessed wrong and sent someone down a blind
# alley: only ~0.25s of it is loading gems. The rest, 0.7–1.0s, is the
# `warm_up_browser` at the end of test_helper.rb — a Chrome launch and an OSMD
# render, paid by every worker and every CI shard, including tests that never
# open a score. bootsnap was measured against the gem-loading part and rejected:
# 0.135s per process, ~0% of a full suite run, for a native dependency and a
# stale-bytecode hazard on same-size edits within one second.
#
# None of that is Docker's doing, so a Ruby on the host would not avoid it.
#
# `docker compose` does all of this properly — config hashing, project naming,
# up/exec/down. It is not used because it would add a file and move `--cpus`
# into `deploy.resources` for a script whose whole job is one `exec`; if this
# grows a third verb, switch rather than keep reimplementing a supervisor.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image=arabesque-test
volume=arabesque-bundle

# macOS has shasum, Linux has sha256sum, and this script is the documented way
# to run the suite on a machine without Ruby — including a Mac.
digest() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi
}

# One container per checkout: the mount set is what it cannot change after
# creation, and two checkouts must not share one. The basename is there so
# `docker ps` says which; the digest disambiguates worktrees of the same name.
container="$image-$(basename "$repo")-$(printf '%s' "$repo" | digest | cut -c1-8)"

# Every container this script starts wears arabesque.test, so cleanup is a sweep
# rather than a lookup. It has to be: agent worktrees under .claude/ come and go,
# and once one is deleted its container's name is no longer derivable from
# anything on disk — nothing could ever name it again.
if [ "${1:-}" = "--stop" ]; then
  ids="$(docker ps -aq --filter label=arabesque.test)"
  if [ -n "$ids" ]; then
    docker rm -f $ids >/dev/null
    echo "stopped $(printf '%s\n' "$ids" | wc -l | tr -d ' ') container(s)"
  else
    echo "no test container running"
  fi
  exit 0
fi

# Always build and let the cache decide, rather than guessing from the
# Dockerfile's contents whether a build is needed: at 0.5s warm it is cheaper
# than being wrong about it. --provenance=false because BuildKit otherwise
# attaches a fresh attestation to every build, which moves the image id and
# would make the comparison below recreate the container on every single run.
docker build -q --provenance=false -t "$image" -f "$repo/test/Dockerfile" "$repo" >/dev/null

# What the container cannot be talked out of once it exists: the image it came
# from, the CPU budget, and the gems the lock file asks for. Anything else
# belongs on the exec below, not here.
spec="$(docker image inspect -f '{{.Id}}' "$image")|${CPUS:-all}|$(digest < "$repo/Gemfile.lock" | cut -c1-12)"
current="$(docker inspect -f '{{.State.Running}} {{index .Config.Labels "arabesque.spec"}}' "$container" 2>/dev/null || true)"

if [ "$current" != "true $spec" ]; then
  # A named volume is born owned by root. Hand it over the once, at creation, so
  # bundler can install into it as the user below.
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create "$volume" >/dev/null
    docker run --rm -v "$volume:/gems" "$image" chown "$(id -u):$(id -g)" /gems
  fi

  # The repo is bind-mounted, so whatever the suite writes into it — tmp/*.log, a
  # screenshot — belongs to whoever the container runs as. As root that left
  # root-owned files in the working tree, which the host then could not delete or
  # overwrite: a later `npm install` in the same checkout died on EACCES. HOME has
  # to point somewhere writable too, because this uid has no passwd entry inside.
  #
  # It sleeps for a day rather than forever so a forgotten one lets go on its own;
  # the running check above simply starts a fresh one the next morning.
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run -d --name "$container" \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --label arabesque.test=1 --label "arabesque.spec=$spec" \
    ${CPUS:+--cpus="$CPUS"} \
    -v "$repo:/app" -v "$volume:/gems" \
    "$image" sleep 1d >/dev/null

  # Only reachable when the container is new or the lock moved, which is exactly
  # when the answer can have changed — so the warm path never pays for it, and a
  # first run still gets a real error instead of a confusing crash.
  docker exec "$container" bundle check >/dev/null 2>&1 ||
    docker exec "$container" bundle install
fi

# Only ask for a TTY when there is one, so the script also works from a hook, a
# pipeline or an agent.
tty_flag=()
[ -t 0 ] && tty_flag=(-it)

# TEST_WORKERS is documented in CLAUDE.md and never used to reach the container
# at all. Env goes here rather than into the spec above: passing it at exec time
# is what keeps it from forking a second container per value.
run() {
  docker exec "${tty_flag[@]}" ${TEST_WORKERS:+-e TEST_WORKERS="$TEST_WORKERS"} "$container" "$@"
}

if [ $# -eq 0 ]; then
  run bundle exec rake test:parallel
else
  run bundle exec "$@"
fi
