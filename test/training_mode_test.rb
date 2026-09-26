require_relative 'test_helper'

# Training mode on its default passage, one measure: three clean repetitions,
# shown as dots, before the cursor moves on. Passages of several measures are in
# training_passage_test.rb.
class TrainingModeTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_training_mode_repeats_same_measure
    load_score('simple-score.xml', 4)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Verify measure rectangles are present in training mode
    assert_selector 'svg rect.measure-click-area.selected'

    # Recorded rather than sampled: the highlighting is transient, and polling
    # for it mid-replay misses whatever happens between two polls.
    record_played_notes
    replay_cassette('simple-score-3-repeats')

    assert_text 'Félicitations'
    assert_text 'complété toutes les mesures'

    # The cassette repeats the measure 3 times. Each repetition lights its 4
    # notes one by one, and the automatic reset clears them before the next.
    repetitions = played_notes_timeline.slice_before(0).to_a
    # The reset that follows the last repetition may or may not have fired yet.
    repetitions.pop if repetitions.last == [0]

    assert_equal 3, repetitions.size, "expected 3 repetitions, got #{repetitions.inspect}"
    repetitions.each do |lit_counts|
      assert_equal 0, lit_counts.first, "repetition should start cleared: #{lit_counts.inspect}"
      assert_equal 4, lit_counts.last, "repetition should end with the measure lit: #{lit_counts.inspect}"
      assert_equal lit_counts.sort, lit_counts, "notes should never un-light mid-repetition: #{lit_counts.inspect}"
    end
    # Note by note, not all at once — what makes the highlighting readable.
    assert repetitions.any? { |lit| lit.any? { |n| (1..3).cover?(n) } },
           "expected a partially lit measure at some point, got #{repetitions.inspect}"
  end

  def test_training_mode_requires_clean_repetitions
    load_score('simple-score.xml', 4)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    replay_cassette('simple-score-with-mistakes')

    # The cassette has 3 repetitions: clean, dirty (D instead of F), clean
    # Only 2 clean repetitions count, so training should NOT complete
    # Check repeat indicators: 2 filled circles, 1 empty
    assert_selector 'svg circle.repeat-indicator', count: 3
    assert_selector 'svg circle.repeat-indicator.filled', count: 2
    assert_no_text 'Félicitations'
    assert_no_text 'complété toutes les mesures'
  end

  def test_a_wrong_note_is_shown_and_reddens_the_repetition_under_way
    load_score('simple-score.xml', 4)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # A dot only fills on a flawless repetition, and nothing used to say a
    # mistake had happened: the dots simply stopped filling.
    play_note('D4') # the measure opens on C4

    assert_selector 'svg g.vf-notehead.wrong-note', count: 1
    assert_selector 'svg circle.repeat-indicator.spoiled', count: 1

    # Playing the note that was owed clears the flash rather than leaving it
    # red over the played colour until the animation ends.
    play_note('C4')
    assert_no_selector 'svg g.vf-notehead.wrong-note'
  end

  def test_training_mode_allows_jumping_to_specific_measure
    load_score('schumann-melodie.xml', 256)

    click_on 'Mode Entraînement'

    # Measure 1 should be highlighted by default
    initial_rect_x = page.find('svg rect.measure-click-area.selected')['x'].to_f

    click_measure(2)

    # Verify the highlight moved to measure 2
    new_rect_x = page.find('svg rect.measure-click-area.selected')['x'].to_f
    assert new_rect_x != initial_rect_x, "Highlight should have moved"

    # Play first notes of measure 2 (A4 = MIDI 69, F4 = MIDI 65 - polyphonic)
    replay_cassette('melodie-measure-2-first-note')

    # Verify that both polyphonic notes were validated together
    assert_selector 'svg g.vf-notehead.played-note', count: 2
  end
end
