require_relative 'test_helper'

# A fingering is stored under a name for the note it belongs to, and two
# separate walks over the score produce that name: fingeringInjector.js reads
# the MusicXML as the file writes it, to put the fingering back into the score
# before OSMD loads it, and noteExtraction.js reads OSMD's sheet, to know which
# note the player just clicked. The name has to mean the same note in both, and
# it has to mean only one note.
#
# It used to do neither. See public/js/fingeringKeys.js for the scheme itself.
class FingeringKeySchemeTest < CapybaraTestBase
  SIMPLE_SCORE = '/test-fixtures/simple-score.xml'.freeze
  # Three measures all printed "0", the way Satie's barless Gnossienne is.
  REPEATED_NUMBER_SCORE = '/test-fixtures/repeated-measure-number.xml'.freeze
  # A grand staff written as two one-staff parts, the way the Entertainer is.
  TWO_PART_SCORE = '/test-fixtures/two-parts.xml'.freeze

  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  # The invariant the feature rests on, held against every score in the library
  # rather than a fixture: for each note OSMD's walk names, the file's walk must
  # name a note of the same pitch. A key both walks produce but for different
  # notes hands the player's fingering to the note next door, and that is what
  # the shipped library was doing on thirteen of its scores.
  #
  # In batches, because the whole library is one long stretch of parsing and a
  # single CDP command that ran that long would sit near Ferrum's ceiling.
  def test_the_two_walks_name_the_same_note_in_every_score_of_the_library
    visit "/score.html?url=#{SIMPLE_SCORE}"
    wait_for_score_render

    files = page.evaluate_async_script(CATALOG_FILES)
    assert_operator files.length, :>, 50, 'the catalog came back nearly empty'

    files.each_slice(20) do |batch|
      result = page.evaluate_async_script(COMPARE_WALKS, batch)
      assert_empty result['disagreements'],
                   "a fingering key names a different note in each walk: #{result['disagreements']}"
      assert_operator result['compared'], :>, 0, "no note was checked in #{batch.first}"
    end
  end

  # The headline symptom. All three measures of this score are printed "0", so
  # a key naming the measure by that number could not tell them apart: the 3
  # went onto note 1 of every measure, and there was no way to take it off one
  # of them.
  def test_a_fingering_lands_on_one_note_of_a_score_that_prints_one_measure_number
    visit "/score.html?url=#{REPEATED_NUMBER_SCORE}"
    wait_for_score_render

    all('svg g.vf-notehead').first.click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '3'
    click_button '✓ Valider'
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '3', count: 1

    visit "/score.html?url=#{REPEATED_NUMBER_SCORE}"
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '3', count: 1
  end

  # The second part's staff is staff 1 of the sheet, not staff 0 of its own
  # part. Numbering it within the part gave the two parts the same key, so the
  # fingering was injected onto the first part's note instead -- and on the
  # shipped two-part Entertainer that was 963 of its notes.
  def test_a_fingering_on_the_second_part_comes_back_on_the_second_part
    visit "/score.html?url=#{TWO_PART_SCORE}"
    wait_for_score_render

    # Two notes per part, in score order: index 2 is the lower staff's first.
    all('svg g.vf-notehead')[2].click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '4'
    click_button '✓ Valider'
    wait_for_score_render

    # Reload, so the fingering comes back through the injection rather than
    # from the model it was just added to.
    visit "/score.html?url=#{TWO_PART_SCORE}"
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '4', count: 1
    assert_equal [0, 1], fingering_counts_per_staff
  end

  # A record written before the scheme changed. `0:0:0:0` meant "the first note
  # of a measure printed 0", which is all three of this score's measures, and
  # the player saw their 3 on all three notes. The migration keeps every one of
  # them -- the score looks exactly as it did -- but each is now its own key, so
  # the two they never wrote can be taken off.
  def test_a_fingering_stored_under_an_ambiguous_old_key_keeps_every_note_it_was_drawn_on
    visit "/score.html?url=#{REPEATED_NUMBER_SCORE}"
    wait_for_score_render
    seed_store('fingerings', [{ 'scoreUrl' => REPEATED_NUMBER_SCORE, 'fingerings' => { '0:0:0:0' => 3 }, 'updatedAt' => 1 }])

    visit "/score.html?url=#{REPEATED_NUMBER_SCORE}"
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '3', count: 3
    assert_equal %w[m0:0:0:0 m1:0:0:0 m2:0:0:0], stored_fingering_keys(REPEATED_NUMBER_SCORE)

    # And the copies are now separable: taking one off leaves the others.
    all('svg g.vf-notehead')[2].click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '×'
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '3', count: 2
  end

  # An ordinary score's keys are rewritten too -- the measure is named by its
  # place rather than by the number printed on it, and here the two differ by
  # one -- and the fingering is on screen on the load that rewrites them, not
  # only on the next one.
  def test_a_fingering_stored_under_an_old_key_is_rewritten_and_still_drawn
    visit "/score.html?url=#{SIMPLE_SCORE}"
    wait_for_score_render
    seed_store('fingerings', [{ 'scoreUrl' => SIMPLE_SCORE, 'fingerings' => { '1:0:0:1' => 2 }, 'updatedAt' => 1 }])

    visit "/score.html?url=#{SIMPLE_SCORE}"
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '2', count: 1
    assert_equal %w[m0:0:0:1], stored_fingering_keys(SIMPLE_SCORE)

    # Nothing left to do on the next load, and nothing lost by it.
    visit "/score.html?url=#{SIMPLE_SCORE}"
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: '2', count: 1
    assert_equal %w[m0:0:0:1], stored_fingering_keys(SIMPLE_SCORE)
  end

  private

  # How many fingerings each staff of the first measure carries, staff by staff.
  def fingering_counts_per_staff
    page.evaluate_script(<<~JS)
      osmdInstance.graphic.MeasureList[0].map((measure) =>
        measure.staffEntries.reduce((total, entry) => total + (entry.FingeringEntries?.length ?? 0), 0),
      )
    JS
  end

  def stored_fingering_keys(score_url)
    keys = page.evaluate_async_script(<<~JS, score_url)
      const [scoreUrl, done] = [arguments[0], arguments[arguments.length - 1]];
      const request = indexedDB.open('arabesque', 3);
      request.onerror = () => done(null);
      request.onsuccess = () => {
        const db = request.result;
        const record = db.transaction('fingerings', 'readonly').objectStore('fingerings').get(scoreUrl);
        record.onerror = () => { db.close(); done(null); };
        record.onsuccess = () => { db.close(); done(Object.keys(record.result?.fingerings ?? {})); };
      };
    JS
    (keys || []).sort
  end

  CATALOG_FILES = <<~JS.freeze
    const done = arguments[arguments.length - 1];
    fetch('/data/scores.json')
      .then((response) => response.json())
      .then((catalog) => {
        const files = [];
        for (const score of catalog.scores) {
          if (score.file) files.push(score.file);
          for (const part of score.parts ?? []) files.push(part.file);
        }
        done(files);
      });
  JS

  # For each score: walk the file, walk OSMD's sheet, and check that every key
  # the sheet produced names a note of the same pitch in the file. The sheet's
  # keys are a subset of the file's -- extraction leaves out cue notes and notes
  # the score hides, while still counting them, which is exactly what keeps the
  # two in step.
  #
  # osmd.load() without render(): the sheet is all this needs, and laying out a
  # hundred scores would take minutes rather than seconds.
  COMPARE_WALKS = <<~JS.freeze
    const [files, done] = [arguments[0], arguments[arguments.length - 1]];
    const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const midiOf = (note) => {
      const pitch = note.querySelector('pitch');
      if (!pitch) return null;
      const octave = parseInt(pitch.querySelector('octave').textContent, 10);
      const alter = parseInt(pitch.querySelector('alter')?.textContent ?? '0', 10);
      return (octave + 1) * 12 + SEMITONES[pitch.querySelector('step').textContent] + alter;
    };
    (async () => {
      const [{ fingeringNotesInDocument }, { extractNotesFromScore }, { loadMxlAsXml }] = await Promise.all([
        import('/js/fingeringInjector.js'),
        import('/js/noteExtraction.js'),
        import('/js/mxlLoader.js'),
      ]);
      const container = document.createElement('div');
      container.style.display = 'none';
      document.body.appendChild(container);
      const disagreements = [];
      let compared = 0;
      for (const file of files) {
        const xml = await loadMxlAsXml('scores/' + file);
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const midiByKey = new Map();
        for (const { note, key } of fingeringNotesInDocument(doc)) {
          if (midiByKey.has(key)) disagreements.push([file, key, 'named twice by the file']);
          midiByKey.set(key, midiOf(note));
        }
        const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, { autoResize: false });
        await osmd.load(xml);
        for (const measure of extractNotesFromScore(osmd).allNotes) {
          for (const noteData of measure.notes) {
            // An ornament expands into notes of its own, which share their
            // principal's key and carry no notehead: only the principal is a
            // note the file has.
            if (noteData.noteheadIndex < 0) continue;
            compared++;
            if (!midiByKey.has(noteData.fingeringKey)) {
              disagreements.push([file, noteData.fingeringKey, 'unknown to the file']);
            } else if (midiByKey.get(noteData.fingeringKey) !== noteData.midiNumber) {
              disagreements.push([file, noteData.fingeringKey, midiByKey.get(noteData.fingeringKey), noteData.midiNumber]);
            }
          }
        }
      }
      container.remove();
      done({ compared, disagreements: disagreements.slice(0, 10) });
    })();
  JS
end
