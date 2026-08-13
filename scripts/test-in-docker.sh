#!/usr/bin/env bash
# Run the browser suite in a container — no Ruby or Chrome needed on the host.
#
#   scripts/test-in-docker.sh                       # rake test:parallel
#   scripts/test-in-docker.sh rake test             # anything else
#   scripts/test-in-docker.sh ruby -Itest test/library_test.rb
#
# CPUS=4 mimics a GitHub runner, which is what you want when reproducing a CI
# failure; leave it unset to use the whole machine.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image=arabesque-test
volume=arabesque-gems

docker build -q -t "$image" -f "$repo/test/Dockerfile" "$repo" >/dev/null
docker volume create "$volume" >/dev/null

# Only ask for a TTY when there is one, so the script also works from a hook,
# a pipeline or an agent.
tty_flag=()
[ -t 0 ] && tty_flag=(-it)

run() {
  docker run --rm "${tty_flag[@]}" \
    ${CPUS:+--cpus="$CPUS"} \
    -v "$repo:/app" -v "$volume:/gems" \
    "$image" "$@"
}

# Cheap when the volume is already populated, and saves a confusing crash on a
# first run or after a Gemfile change.
run bundle check >/dev/null 2>&1 || run bundle install

if [ $# -eq 0 ]; then
  run bundle exec rake test:parallel
else
  run bundle exec "$@"
fi
