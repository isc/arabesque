#!/usr/bin/env ruby
# scripts/vendor_playback_deps.rb
#
# Downloads the playback libraries into public/vendor/, so opening a score
# fetches nothing from a third-party CDN. Re-run to upgrade a version:
#   ruby scripts/vendor_playback_deps.rb
#
# Saved as .js, not .mjs: the dev server serves an unknown extension as
# application/octet-stream, which browsers refuse to run as a module.
#
# esm.sh serves each package as a small shim re-exporting a real bundle, and
# those bundles import their own dependencies by absolute path (/node/events.mjs
# and friends). Left as they are, those paths would resolve against our origin
# and 404 — so the graph is walked, every module saved, and every absolute
# import rewritten to the file next to it.
#
# `tone` stays a bare specifier on purpose: score.html's import map resolves it,
# so @tonejs/piano and our own code share one Tone instance (two would mean two
# audio contexts and two transports).
#
# Not vendored: the piano samples themselves, which @tonejs/piano fetches from
# tambien.github.io when playback first starts. They are tens of megabytes and
# nothing loads them until the player presses ▶ Écouter, so they cost no page
# load and no test — which is what this script is about.
require 'net/http'
require 'uri'
require 'fileutils'

VENDOR = File.expand_path('../public/vendor', __dir__)

# Entry points, and the filename each module is saved as. Paths come from the
# shim esm.sh serves for `tone` and `@tonejs/piano?external=tone`; re-read them
# after a version bump (curl https://esm.sh/tone@<version>).
FILENAMES = {
  '/tone@14.8.49/es2022/tone.bundle.mjs' => 'tone.14.8.49.min.js',
  '/@tonejs/piano@0.2.1/X-ZXRvbmU/es2022/piano.bundle.mjs' => 'tonejs-piano.0.2.1.min.js',
  '/webmidi@2.5.3/es2022/webmidi.mjs' => 'webmidi.2.5.3.min.js',
  '/node/events.mjs' => 'node-events.min.js',
  '/node/async_hooks.mjs' => 'node-async-hooks.min.js',
}

# Paths that are only re-export shims: never downloaded, just rewritten to the
# file they point at. (@tonejs/piano imports webmidi through a 141-byte shim.)
ALIASES = {
  '/webmidi@^2.5.1?target=es2022' => '/webmidi@2.5.3/es2022/webmidi.mjs',
}

def fetch(path)
  # `^` in a version range is not a legal URI character for Ruby's parser.
  uri = URI("https://esm.sh#{path.gsub('^', '%5E')}")
  res = Net::HTTP.get_response(uri)
  raise "GET #{uri} → #{res.code}" unless res.code == '200'
  res.body
end

# Absolute esm.sh imports, e.g. from"/node/events.mjs" or import"/webmidi@^2.5.1?target=es2022"
IMPORT_RE = %r{(?:from|import)\s*"(/[^"]+)"}

sources = {}
queue = ['/tone@14.8.49/es2022/tone.bundle.mjs', '/@tonejs/piano@0.2.1/X-ZXRvbmU/es2022/piano.bundle.mjs']
until queue.empty?
  path = queue.shift
  next if sources.key?(path)
  puts "fetching #{path}"
  sources[path] = fetch(path)
  sources[path].scan(IMPORT_RE) { |dep,| queue << (ALIASES[dep] || dep) }
end

unknown = sources.keys.reject { |p| FILENAMES.key?(p) }
abort "Unmapped modules (add them to FILENAMES): #{unknown.join(', ')}" if unknown.any?

FileUtils.mkdir_p(VENDOR)
sources.each do |path, src|
  rewritten = src.gsub(IMPORT_RE) do |match|
    dep = ALIASES[Regexp.last_match(1)] || Regexp.last_match(1)
    match.sub(/"[^"]+"/, "\"./#{FILENAMES.fetch(dep)}\"")
  end
  out = File.join(VENDOR, FILENAMES.fetch(path))
  File.write(out, rewritten)
  puts "wrote #{FILENAMES.fetch(path)} (#{rewritten.bytesize} B)"
end

# Nothing may point at a CDN any more.
# No *import* may still point off-origin. (The samples URL baked into
# @tonejs/piano is a runtime fetch, not an import, and stays as it is.)
leftovers = FILENAMES.values.uniq.flat_map do |name|
  File.read(File.join(VENDOR, name)).scan(IMPORT_RE).flatten.reject { |dep| dep.start_with?('./') }
end.uniq
abort "Imports still pointing off-origin: #{leftovers.join(', ')}" if leftovers.any?
puts "\nOK — no absolute or cross-origin imports left."
