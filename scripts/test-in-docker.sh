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
# Not the old arabesque-gems: that one was populated by a container running as
# root, so the unprivileged user we now run as cannot write to it.
volume=arabesque-bundle

docker build -q -t "$image" -f "$repo/test/Dockerfile" "$repo" >/dev/null

# A named volume is born owned by root. Hand it over the once, at creation, so
# bundler can install into it as the user below.
if ! docker volume inspect "$volume" >/dev/null 2>&1; then
  docker volume create "$volume" >/dev/null
  docker run --rm -v "$volume:/gems" "$image" chown "$(id -u):$(id -g)" /gems
fi

# Only ask for a TTY when there is one, so the script also works from a hook,
# a pipeline or an agent.
tty_flag=()
[ -t 0 ] && tty_flag=(-it)

# The repo is bind-mounted, so whatever the suite writes into it — tmp/*.log,
# a screenshot — belongs to whoever the container runs as. As root that left
# root-owned files in the working tree, which the host then could not delete or
# overwrite: a later `npm install` in the same checkout died on EACCES. HOME has
# to point somewhere writable too, because this uid has no passwd entry inside.
run() {
  docker run --rm "${tty_flag[@]}" \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
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
