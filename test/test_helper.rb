require 'time'
require 'capybara'
require 'capybara/dsl'
require 'capybara/minitest'
require 'minitest/autorun'
require 'rack'
require 'capybara/cuprite'
require 'logger'
require_relative '../app'

Capybara.app = App

# Configure download directory for tests
DOWNLOAD_DIR = Dir.mktmpdir

Capybara.register_driver(:cuprite) do |app|
  Capybara::Cuprite::Driver.new(
    app,
    headless: !ENV['DISABLE_HEADLESS'],
    logger: StringIO.new,
    # Force French so the app's language auto-detection (navigator.language)
    # resolves to 'fr' — the UI assertions in these tests are in French.
    browser_options: { 'disable-gpu' => nil, 'lang' => 'fr-FR', 'accept-lang' => 'fr-FR' },
    save_path: DOWNLOAD_DIR,
    # Spawning Chrome, not running a test: the 10s default failed on cold CI
    # runners, and 30s still does — "Browser did not produce websocket url
    # within 30 seconds" took a shard down on main twice in a day, and it also
    # shows up locally when eight workers start their browsers at once. This is
    # a ceiling on how long we wait for a process to exist, so raising it costs
    # nothing when the machine is healthy and buys a green run when it isn't.
    process_timeout: 60
  )
end
Capybara.default_driver = :cuprite
# Cold-start OSMD renders are borderline on slower CI runners (the default 2s
# was already raised to 5s); the heavier OSMD 1.9.9 bundle pushed some renders
# past 5s, so give selector waits more headroom.
Capybara.default_max_wait_time = 10
Capybara.enable_aria_label = true

# Clean up download directory at exit
at_exit { FileUtils.rm_rf(DOWNLOAD_DIR) }

class CapybaraTestBase < Minitest::Test
  include Capybara::DSL
  include Capybara::Minitest::Assertions

  def teardown
    Capybara.reset_sessions!
  end

  # Wait for a file matching pattern to appear in download dir
  def wait_for_download(pattern, timeout: Capybara.default_max_wait_time)
    Timeout.timeout(timeout) do
      loop do
        file = Dir.glob(File.join(DOWNLOAD_DIR, pattern)).first
        return file if file
        sleep 0.05
      end
    end
  rescue Timeout::Error
    nil
  end

  # Block until the app has created its IndexedDB store, so seeding scripts
  # don't race the page. Opening the database from a test before the app has
  # built it creates an empty one at the same version, which then never
  # upgrades — the stores are missing for good and the page renders nothing.
  def wait_for_store(store, timeout: Capybara.default_max_wait_time)
    Timeout.timeout(timeout) do
      # `databases()` is used rather than open(): probing with open() would
      # itself create the database this is waiting for.
      until page.evaluate_async_script(<<~JS, store)
        const [store, done] = [arguments[0], arguments[arguments.length - 1]];
        indexedDB.databases().then((dbs) => {
          if (!dbs.some((d) => d.name === 'arabesque')) return done(false);
          const request = indexedDB.open('arabesque');
          request.onerror = () => done(false);
          request.onsuccess = () => {
            const present = request.result.objectStoreNames.contains(store);
            request.result.close();
            done(present);
          };
        });
      JS
        sleep 0.05
      end
    end
  end

  # Drive the page's clock by hand instead of waiting on the wall clock.
  #
  # Chrome's virtual time makes `performance.now()`, `Date.now()` and every
  # timer advance on command. The strict-playthrough engine schedules its whole
  # run with setTimeout and matches input against `performance.now()`, so a test
  # that steps the clock exercises exactly the same millisecond arithmetic as
  # one that sleeps — the count-in, the ±450ms tolerance window and the note
  # spacing all keep their real values. What disappears is only the waiting.
  #
  # It also removes the load-sensitivity: a note dispatched while the clock is
  # parked lands on an exact virtual instant, where a `sleep 2` lands wherever a
  # loaded CI runner happens to schedule it.
  def with_clock_control
    cdp = page.driver.browser.page
    # `pause` parks virtual time; every later advance is explicit. Timers keep
    # firing in order, they just wait for a budget to be granted.
    cdp.command('Emulation.setVirtualTimePolicy', policy: 'pause')
    yield
  ensure
    # Hand the page back to the wall clock so teardown and any later
    # interaction behave normally.
    cdp&.command('Emulation.setVirtualTimePolicy', policy: 'advance')
  end

  # Advance the parked clock by `ms` of virtual time and block until the page
  # has actually consumed it. Chrome burns the budget as fast as the CPU
  # allows, so this returns in a few real milliseconds.
  def advance_clock(ms, timeout: 10)
    cdp = page.driver.browser.page
    target = page.evaluate_script('performance.now()') + ms
    # Chrome pauses virtual time again once the budget is spent.
    cdp.command('Emulation.setVirtualTimePolicy', policy: 'advance', budget: ms)
    Timeout.timeout(timeout) do
      sleep 0.01 until page.evaluate_script('performance.now()') >= target - 1
    end
  end

  # Write records into an IndexedDB store and block until the transaction has
  # actually committed.
  #
  # A put() request resolves well before the transaction it belongs to, so a
  # test that fires the puts and then sleeps is betting on a fixed delay. The
  # bet pays while the page is idle and loses on a loaded machine — or as soon
  # as the suite is split and each process gets a fraction of the cores.
  # `oncomplete` is the only signal that says the data is durable and will be
  # there for the next page load.
  def seed_store(store, records)
    wait_for_store(store)
    committed = page.evaluate_async_script(<<~JS, store, records)
      const [store, records, done] = [arguments[0], arguments[1], arguments[arguments.length - 1]];
      const request = indexedDB.open('arabesque', 3);
      request.onerror = () => done(false);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(store, 'readwrite');
        tx.oncomplete = () => { db.close(); done(true); };
        tx.onabort = tx.onerror = () => { db.close(); done(false); };
        const objectStore = tx.objectStore(store);
        for (const record of records) objectStore.put(record);
      };
    JS
    assert committed, "seeding the '#{store}' store did not commit"
  end

  # Block until an IndexedDB store holds `count` records matching `where`, a JS
  # expression evaluated against each `record`.
  #
  # The app writes practice sessions asynchronously once a playthrough ends, so
  # a test that navigates away or starts a second playthrough right after the
  # completion modal appears can outrun the write. Waiting on the record itself
  # states what the test is actually waiting for, and takes exactly as long as
  # it needs to instead of a guessed half-second.
  def wait_for_records(store, where: 'true', count: 1, timeout: Capybara.default_max_wait_time)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    loop do
      matching = count_records(store, where)
      return if matching >= count

      if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
        flunk "'#{store}' still held #{matching} record(s) matching #{where.inspect} " \
              "after #{timeout}s, expected #{count}"
      end
      sleep 0.05
    end
  end

  # Helper to run code with a virtual browser time
  # Accepts a Time object or a string like "2026-01-10 12:00"
  # Resets the browser page after the block to restore normal time behavior
  def with_virtual_time(time)
    time = Time.parse(time) if time.is_a?(String)
    page.driver.browser.page.command('Emulation.setVirtualTimePolicy',
      policy: 'advance',
      initialVirtualTime: time.to_i
    )
    yield
  ensure
    Capybara.current_session.reset!
  end

  # Helper to simulate MIDI input events
  # Example: simulate_midi_input("ON C4") or simulate_midi_input("OFF C4")
  def simulate_midi_input(notation)
    data_array = parse_midi_notation(notation)
    page.execute_script(<<~JS)
      const event = new CustomEvent('mock-midi-input', {
        detail: { data: #{data_array.to_json} }
      });
      window.dispatchEvent(event);
    JS
  end

  # Helper to play a single note (ON + OFF)
  def play_note(note)
    simulate_midi_input("ON #{note}")
    simulate_midi_input("OFF #{note}")
  end

  # Helper to play a sequence of notes.
  #
  # The gap between notes is deliberate rather than a wait for something to
  # settle: it is what makes these separate notes instead of a chord. Dispatch
  # them back to back and the engine sees one simultaneous group — which is
  # exactly what play_chord below does on purpose.
  def play_notes(notes)
    notes.each do |note|
      play_note(note)
      sleep 0.05
    end
  end

  # Dispatch a chord (all notes ON, then all OFF) in a single JS turn so the
  # engine sees them at virtually the same instant. Useful for strict-tempo
  # tests where consecutive simulate_midi_input round-trips would smear notes
  # across the timing window.
  def play_chord(notes)
    on_data = notes.map { |n| parse_midi_notation("ON #{n}") }
    off_data = notes.map { |n| parse_midi_notation("OFF #{n}") }
    page.execute_script(<<~JS)
      const events = #{(on_data + off_data).to_json};
      for (const data of events) {
        window.dispatchEvent(new CustomEvent('mock-midi-input', { detail: { data } }));
      }
    JS
  end

  # Records every change in the number of lit noteheads, from now until the page
  # navigates away. Assertions then run on the whole progression once the replay
  # is over, instead of trying to catch a transient state while it happens:
  # polling for "between 1 and 3 notes lit" is a race the test loses whenever a
  # repetition starts and finishes between two Capybara polls, which is exactly
  # what a loaded CI runner produces.
  def record_played_notes
    page.execute_script(<<~JS)
      window.__playedNotes = [];
      const sample = () => {
        const lit = document.querySelectorAll('svg g.vf-notehead.played-note').length;
        const log = window.__playedNotes;
        if (log[log.length - 1] !== lit) log.push(lit);
      };
      sample();
      // Observe #score, not the SVG: OSMD replaces the whole SVG on a redraw,
      // which would strand an observer attached to it. Class changes are what
      // note highlighting does; childList catches the redraws themselves.
      new MutationObserver(sample).observe(document.getElementById('score'), {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    JS
  end

  # The recorded progression, with consecutive duplicates collapsed — e.g.
  # [0, 1, 2, 3, 4, 0, 1, ...] for a measure lit note by note, then reset.
  def played_notes_timeline
    page.evaluate_script('window.__playedNotes')
  end

  # Helper to load a score from test fixtures
  def load_score(filename, expected_notes)
    attach_file('musicxml-upload', File.expand_path("fixtures/#{filename}", __dir__))
    assert_selector '#score[data-render-complete]'
    assert_selector 'svg g.vf-stavenote', count: expected_notes
  end

  # Helper to click on a measure in the score
  def click_measure(measure_number)
    page.all('svg rect.measure-click-area')[measure_number - 1].trigger('click')
  end

  private

  def count_records(store, where)
    page.evaluate_async_script(<<~JS, store)
      const [store, done] = [arguments[0], arguments[arguments.length - 1]];
      const request = indexedDB.open('arabesque', 3);
      request.onerror = () => done(0);
      request.onsuccess = () => {
        const db = request.result;
        const all = db.transaction(store, 'readonly').objectStore(store).getAll();
        all.onerror = () => { db.close(); done(0); };
        all.onsuccess = () => {
          db.close();
          done(all.result.filter((record) => #{where}).length);
        };
      };
    JS
  end

  def parse_midi_notation(notation)
    # Parse notation like "ON C4", "OFF C#4", "ON Bb4", or "ON G#5"
    match = notation.match(/^(ON|OFF)\s+([A-G][#b]?)(\d+)$/)
    raise "Invalid MIDI notation: #{notation}" unless match

    status_str, note_name, octave_str = match.captures
    status = status_str == 'ON' ? 144 : 128
    octave = octave_str.to_i
    velocity = status == 144 ? 80 : 64

    # Convert note name to MIDI note number
    note_map = { 'C' => 0, 'C#' => 1, 'Db' => 1, 'D' => 2, 'D#' => 3, 'Eb' => 3,
                 'E' => 4, 'F' => 5, 'F#' => 6, 'Gb' => 6, 'G' => 7, 'G#' => 8,
                 'Ab' => 8, 'A' => 9, 'A#' => 10, 'Bb' => 10, 'B' => 11 }
    note_offset = note_map[note_name]
    raise "Invalid note name: #{note_name}" unless note_offset

    midi_note = (octave + 1) * 12 + note_offset
    [status, midi_note, velocity]
  end
end
