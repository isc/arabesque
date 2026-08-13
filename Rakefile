require 'rake/testtask'
require 'etc'

# Resolved eagerly: a lazy FileList cannot be frozen, and both the serial task
# and the shards need the same list.
TEST_FILES = FileList['test/**/*_test.rb'].to_a.freeze

Rake::TestTask.new(:test) do |t|
  t.libs << 'test'
  t.test_files = TEST_FILES
end

# Every test drives a real Chrome, so the suite is dominated by page loads and
# OSMD renders rather than by Ruby. Splitting it is the one lever that scales,
# and it changes no assertion: each worker gets its own Capybara server, its
# own browser and its own profile.
#
# Splitting is per test method, not per file: one file (arabesque_test.rb)
# holds a third of the suite, so file-level splitting would leave it as the
# critical path.
#
# Two ways to use it, because the work is CPU-bound (OSMD rendering), not
# I/O-bound — extra workers only pay off on genuinely free cores:
#   rake test:parallel  — several processes on one machine (dev boxes)
#   rake test:shard     — one slice per machine (CI matrix)
module TestSharding
  module_function

  # "Class#method" for every test, in file order.
  def ids
    TEST_FILES.flat_map do |file|
      source = File.read(file)
      klass = source[/^class\s+([\w:]+)/, 1]
      source.scan(/^\s*def\s+(test_\w+)/).flatten.map { |name| "#{klass}##{name}" }
    end
  end

  # Dealt round-robin over the flat list: files are grouped by class, so
  # dealing this way spreads each class's tests — and its cost — evenly.
  def slice(ids, index, count)
    ids.select.with_index { |_, i| i % count == index }
  end

  # Minitest's -n filter, anchored on "Class#method" so it can never catch a
  # same-named test in another class.
  def filter(shard)
    "/^(?:#{shard.map { |id| Regexp.escape(id) }.join('|')})$/"
  end

  # Two constraints on how the filter reaches Minitest: it is glued to -n
  # because rake's test loader requires any argument not starting with a dash
  # (it would take a detached regex for a filename), and no "--" separator is
  # used because the loader forwards it to Minitest, whose OptionParser treats
  # it as end-of-options and would silently ignore the filter — leaving every
  # shard running the whole suite.
  def command(shard)
    loader = Gem.find_files('rake/rake_test_loader.rb').first
    [RbConfig.ruby, '-Itest', loader, *TEST_FILES, "-n#{filter(shard)}", *ENV['TESTOPTS'].to_s.split]
  end

  COUNTERS = %i[runs assertions failures errors skips].freeze

  # Minitest's own tally, so a split run still reports the counts a single run
  # would have — the number that says nothing was silently dropped.
  def tally(output)
    match = output.match(/^(\d+) runs, (\d+) assertions, (\d+) failures, (\d+) errors, (\d+) skips/)
    return nil unless match

    COUNTERS.zip(match.captures.map(&:to_i)).to_h
  end

  def summarise(totals, elapsed, workers)
    format(
      "\n%<runs>d runs, %<assertions>d assertions, %<failures>d failures, " \
      '%<errors>d errors, %<skips>d skips in %<elapsed>.2fs across %<workers>d workers',
      **totals, elapsed: elapsed, workers: workers
    )
  end
end

namespace :test do
  desc 'Run the suite across several processes (TEST_WORKERS=n, default: cores)'
  task :parallel do
    ids = TestSharding.ids
    abort 'No tests found' if ids.empty?

    workers = (ENV['TEST_WORKERS'] || Etc.nprocessors).to_i.clamp(1, ids.size)
    FileUtils.mkdir_p('tmp')
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    running = Array.new(workers) do |index|
      shard = TestSharding.slice(ids, index, workers)
      log = "tmp/test-shard-#{index}.log"
      # Array form: no shell, so the regex needs no quoting.
      pid = Process.spawn(*TestSharding.command(shard), out: log, err: %i[child out])
      [pid, index, log, shard.size]
    end

    results = running.map do |pid, index, log, size|
      _, status = Process.waitpid2(pid)
      [index, log, size, status]
    end

    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    totals = TestSharding::COUNTERS.to_h { |key| [key, 0] }
    failed = false

    results.each do |index, log, size, status|
      output = File.read(log)
      counts = TestSharding.tally(output)
      counts&.each { |key, value| totals[key] += value }

      # A shard with no tally at all crashed before Minitest reported: surface
      # its whole output rather than quietly counting zero.
      next if status.success? && counts

      failed = true
      puts "\n=== shard #{index} (#{size} tests) failed ===\n#{output}"
    end

    puts TestSharding.summarise(totals, elapsed, workers)

    abort 'Suite failed' if failed || (totals[:failures] + totals[:errors]).positive?
  end

  desc 'Run one slice of the suite (SHARD_INDEX=i SHARD_COUNT=n) — one machine per slice'
  task :shard do
    count = Integer(ENV.fetch('SHARD_COUNT', '1'))
    index = Integer(ENV.fetch('SHARD_INDEX', '0'))
    abort "SHARD_INDEX must be between 0 and #{count - 1}" unless (0...count).cover?(index)

    shard = TestSharding.slice(TestSharding.ids, index, count)
    abort "Shard #{index} is empty" if shard.empty?

    puts "Shard #{index + 1}/#{count}: #{shard.size} tests"
    exit(system(*TestSharding.command(shard)) ? 0 : 1)
  end
end

task default: :test
