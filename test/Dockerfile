# Runs the browser suite without installing Ruby or Chrome on the host, with
# the same Ruby as CI. See scripts/test-in-docker.sh for the wrapper.
FROM ruby:3.3-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Ferrum/Cuprite probes PATH for `chrome`. This wrapper adds the two flags a
# container needs, so test_helper.rb stays free of container-specific setup.
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"\n' \
      > /usr/local/bin/chrome && chmod +x /usr/local/bin/chrome

# Gems live in a named volume so they survive between runs.
ENV BUNDLE_PATH=/gems
WORKDIR /app
