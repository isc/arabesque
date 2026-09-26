require_relative 'test_helper'

# A bar the file writes as two <measure>s — split so a system can break inside
# it, which is what the cadenza of Chopin's Op. 9 No. 2 needs to be readable on
# an iPad — is still one bar: one index for its fingerings and its practice
# history, one unit for the training cursor. See barCounter in
# public/js/fingeringKeys.js.
#
# continuation-measure.xml is 4/4: four quarters, then bar 2 as eight
# sixteenths and two quarters written as two measures, then a whole note. At
# phone width the halves of bar 2 land on two systems.
class ContinuationMeasureTest < CapybaraTestBase
  SCORE = '/test-fixtures/continuation-measure.xml'.freeze
  PHONE = [360, 740].freeze
  NOCTURNE = 'scores/Chopin_-_Nocturne_Op_9_No_2_E_Flat_Major.mxl'.freeze
  IPAD = [1024, 748].freeze
  BAR_2_FIRST_HALF = %w[G4 A4 B4 C5 D5 C5 B4 A4].freeze
  BAR_2_SECOND_HALF = %w[G4 E4].freeze
  WHOLE_SCORE = %w[C4 D4 E4 F4] + BAR_2_FIRST_HALF + BAR_2_SECOND_HALF + %w[C4]

  def setup
    @original_size = page.current_window.size
    page.driver.set_cookie('test-env', 'true')
  end

  def teardown
    page.current_window.resize_to(*@original_size)
    super
  end

  # Split or not, the journal files the bar once, under the index it had
  # before the split, and the bar after it keeps its own — a history written
  # against the unsplit score still points at the right bars.
  def test_the_journal_files_a_split_bar_as_one_measure
    visit "/score.html?url=#{SCORE}"
    wait_for_score_render(15)

    play_notes(WHOLE_SCORE)
    assert_text 'Partition terminée'
    # One attempt per bar, as sourceMeasureIndex:attempts.
    wait_for_records('sessions', where: <<~JS)
      record.completedAt && record.totalMeasures === 3 &&
        record.measures.map((m) => `${m.sourceMeasureIndex}:${m.attempts.length}`).join() === '0:1,1:1,2:1'
    JS
  end

  # Each half is outlined on its own system, and both are the bar: a click on
  # either picks it, the cursor lights both, and a repetition is only banked
  # once the second half is played too.
  def test_training_takes_a_split_bar_whole
    page.current_window.resize_to(*PHONE)
    visit "/score.html?url=#{SCORE}"
    wait_for_score_render(15)
    assert_selector 'svg rect.measure-click-area[data-measure-index="1"]', count: 2

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'
    all('svg rect.measure-click-area[data-measure-index="1"]').last.trigger('click')
    assert_selector 'svg rect.measure-click-area.selected[data-measure-index="1"]', count: 2
    assert_selector 'svg rect.measure-click-area.selected', count: 2

    play_notes(BAR_2_FIRST_HALF)
    assert_selector 'svg g.vf-notehead.played-note', count: BAR_2_FIRST_HALF.length
    assert_no_selector 'svg circle.repeat-indicator.filled'

    play_notes(BAR_2_SECOND_HALF)
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  # The note count runs on through the second half, so its first note is the
  # ninth of the bar, and the bar after keeps its index. Reloading proves the
  # file's walk (the injection) and the sheet's walk (the click) agree on it.
  def test_a_fingering_on_the_second_half_is_filed_under_the_bar_and_comes_back
    visit "/score.html?url=#{SCORE}"
    wait_for_score_render(15)

    # Noteheads in score order: bar 1's four, bar 2's eight then two, bar 3's
    # one. Fingers past 3, which OSMD prints over bar 3 as its number.
    write_fingering(12, '4')
    write_fingering(14, '5')
    assert_equal %w[m1:0:0:8 m2:0:0:0], stored_fingering_keys(SCORE)

    visit "/score.html?url=#{SCORE}"
    wait_for_score_render(15)
    assert_selector 'svg g.vf-text', text: '4', count: 1
    assert_selector 'svg g.vf-text', text: '5', count: 1
  end

  # The bar the split is for (feedback 559437e9). Bar 32 of the Nocturne carries
  # a cadenza of sixty-four grace notes; the system gave it two thirds of the
  # width it asked for, and VexFlow spaces what it can at full width and piles
  # the shortfall onto the last notes, drawn on top of one another on an iPad.
  def test_the_nocturne_cadenza_is_readable_on_an_ipad
    page.current_window.resize_to(*IPAD)
    visit "/score.html?url=#{NOCTURNE}"
    wait_for_score_render

    systems = cadenza_noteheads_by_system
    assert_equal [32, 32], systems.map(&:length)
    systems.flat_map { |heads| heads.each_cons(2).to_a }.each do |left, right|
      assert_operator right['x'] - left['x'], :>=, left['width'], "grace notes of bar 32 overlap at x=#{left['x'].round}"
    end
    assert_selector 'svg rect.measure-click-area[data-measure-index="32"]', count: 2
  end

  private

  # The noteheads of the Nocturne's bar 32 grace notes, left to right, one list
  # per system.
  def cadenza_noteheads_by_system
    page.evaluate_script(<<~JS)
      (() => {
        const systems = new Map();
        const graces = osmdInstance.Sheet.SourceMeasures
          .filter((measure) => measure.MeasureNumberXML === 32)
          .flatMap((measure) => measure.verticalSourceStaffEntryContainers)
          .flatMap((container) => container.staffEntries)
          .flatMap((staffEntry) => staffEntry?.voiceEntries ?? [])
          .filter((voiceEntry) => voiceEntry.IsGrace)
          .flatMap((voiceEntry) => voiceEntry.Notes);
        for (const note of graces) {
          const graphical = osmdInstance.rules.GNote(note);
          const box = graphical.getSVGGElement().querySelector('.vf-notehead').getBoundingClientRect();
          const system = graphical.parentVoiceEntry.parentStaffEntry.parentMeasure.parentMusicSystem;
          if (!systems.has(system)) systems.set(system, []);
          systems.get(system).push({ x: box.x, width: box.width });
        }
        return [...systems.values()].map((heads) => heads.sort((a, b) => a.x - b.x));
      })()
    JS
  end

  def write_fingering(notehead_index, finger)
    all('svg g.vf-notehead')[notehead_index].click
    assert_selector 'dialog#fingeringModal[open]'
    click_button finger
    click_button '✓ Valider'
    wait_for_score_render
    assert_selector 'svg g.vf-text', text: finger, count: 1
  end
end
