require_relative 'test_helper'

class ArabesqueTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_note_highlighting_when_playing_complex_score
    load_score('schumann-melodie.xml', 256)
    assert_no_selector 'svg g.vf-notehead.played-note'

    replay_cassette('melodie-2-bars', wait_for_end: false)

    assert_selector 'svg g.vf-notehead.played-note', minimum: 5
    assert first('svg g.vf-notehead')[:class].include?('played-note')
  end

  def test_notes_must_be_played_in_correct_order
    load_score('simple-score.xml', 4)
    assert_no_selector 'svg g.vf-notehead.played-note'

    replay_cassette('simple-score-wrong-order')

    assert_selector 'svg g.vf-notehead.played-note', count: 3
    assert_no_text 'Partition terminée'
  end

  def test_training_mode_repeats_same_measure
    load_score('simple-score.xml', 4)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Verify measure rectangles are present in training mode
    assert_selector 'svg rect.measure-click-area.selected'

    replay_cassette('simple-score-3-repeats', wait_for_end: false)

    # Verify visual transitions during playback
    assert_selector 'svg g.vf-notehead.played-note', count: 4  # After 1st repetition
    assert_selector 'svg g.vf-notehead.played-note', count: 0  # After automatic reset (500ms)
    assert_selector 'svg g.vf-notehead.played-note', minimum: 1, maximum: 3  # During 2nd repetition

    assert_text 'Rejeu terminé'
    assert_text 'Félicitations'
    assert_text 'complété toutes les mesures'
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

  def test_free_play_allows_clicking_measure_to_reposition
    load_score('repeat-endings.xml', 4)

    # Measure click areas should be present even without training mode
    assert_selector 'svg rect.measure-click-area', minimum: 4

    # Play first two measures: C4 (measure 1) and D4 (measure 2)
    play_note("C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    play_note("D4")
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # Click on measure 1 to reposition - should reset measure 1 and all following
    click_measure(1)
    assert_no_selector 'svg g.vf-notehead.played-note'

    # Play C4 again - should validate measure 1
    play_note("C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end

  def test_cassette_recording_saves_valid_midi_data
    cassette_name = 'test-recording'
    cassette_file = File.join(__dir__, '..', 'public', 'cassettes', "#{cassette_name}.json")

    begin
      load_score('simple-score.xml', 4)
      click_on 'Démarrer enregistrement'
      assert_text 'Enregistrement en cours'

      # Simulate MIDI events via custom events
      play_note("C4")
      play_note("E4")

      expected_midi_events = [
        [144, 60, 80],  # Note ON C4
        [128, 60, 64],  # Note OFF C4
        [144, 64, 80],  # Note ON E4
        [128, 64, 64],  # Note OFF E4
      ]

      # Give a moment for MIDI events to be recorded
      sleep 0.1

      accept_alert do
        accept_prompt(with: cassette_name) do
          click_on 'Arrêter enregistrement'
        end
      end

      # Verify the cassette is served correctly by the server
      visit "/cassettes/#{cassette_name}.json"
      cassette_data = JSON.parse(page.find('pre').text)
      actual_data = cassette_data['data'].map { |event| event['data'] }
      assert_equal expected_midi_events, actual_data, 'Cassette should contain exact MIDI data'
    ensure
      File.delete(cassette_file) if File.exist?(cassette_file)
    end
  end

  def test_polyphonic_duplicate_notes_validation
    load_score('schumann-melodie.xml', 256)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Measure 8 contains polyphonic notes with duplicate stems
    # Schumann has a repeat on measures 1-4, so playback sequence is:
    # indices 0-3: measures 1-4, indices 4-7: repeat, indices 8-11: measures 5-8
    click_measure(12)

    replay_cassette('polyphonic-duplicate-notes')

    # Check repeat indicators: should have 1 filled circle (1 clean repetition)
    # This verifies that duplicate notes at same timestamp are all validated
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_polyphonic_notes_must_be_held_together
    load_score('schumann-melodie.xml', 256)

    # Schumann measure 1 starts with polyphonic notes:
    # - E5 (MIDI 76) in voice 1 (right hand)
    # - C4 (MIDI 60) in voice 5 (left hand)
    # Both notes have the same timestamp and must be played together

    # Play C4 (Note ON)
    simulate_midi_input("ON C4")

    # The note should be highlighted while held
    assert_selector 'svg g.vf-notehead.active-note', count: 1

    # Release C4 without having played E5 (Note OFF)
    simulate_midi_input("OFF C4")

    # The note should no longer be highlighted (not validated)
    assert_no_selector 'svg g.vf-notehead.active-note'
    assert_no_selector 'svg g.vf-notehead.played-note'

    # Now play E5 alone (Note ON then OFF)
    play_note("E5")

    # Still no notes should be validated because they weren't held together
    assert_no_selector 'svg g.vf-notehead.played-note'
  end

  def test_tied_notes_do_not_require_replay
    # Load score with tied notes:
    # Measure 1: G4 whole note (tie-start)
    # Measure 2: G4 half (tie-stop) + F4 half (polyphonic, same timestamp)
    # The tied G4 in measure 2 should NOT require a new note-on if held
    load_score('tied-notes.xml', 3)

    # Play G4 and HOLD it (don't release yet)
    simulate_midi_input("ON G4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    # While holding G4, play F4 - both G4 tie-continuation and F4 should validate together
    simulate_midi_input("ON F4")
    assert_selector 'svg g.vf-notehead.played-note', count: 3

    # Now release both notes
    simulate_midi_input("OFF G4")
    simulate_midi_input("OFF F4")

    assert_text 'Partition terminée'
  end

  def test_chord_activates_only_pressed_note
    # Load score with C major chord (C4, E4, G4 at same timestamp)
    # A chord is a single vf-stavenote element with multiple noteheads
    load_score('chord.xml', 1)

    # Play only C4 - only C4's notehead should be orange, not E4 and G4
    simulate_midi_input("ON C4")

    assert_selector 'svg g.vf-notehead.active-note', count: 1
    assert_no_selector 'svg g.vf-notehead.played-note'
  end

  def test_hand_selection_right_hand_only
    load_score('schumann-melodie.xml', 256)

    # Schumann measure 1 has polyphonic notes:
    # - E5 (MIDI 76) on staff 0 (right hand)
    # - C4 (MIDI 60) on staff 1 (left hand)

    # Uncheck left hand checkbox
    uncheck 'Main gauche'

    # Play only the right hand note (E5)
    play_note('E5')

    # The note should be validated (green) because left hand is disabled
    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end

  def test_hand_selection_left_hand_only
    load_score('schumann-melodie.xml', 256)

    # Uncheck right hand checkbox
    uncheck 'Main droite'

    # Play only the left hand note (C4)
    play_note('C4')

    # The note should be validated because right hand is disabled
    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end

  def test_repeat_endings_playback_sequence
    # Score has:
    # - Measure 1: C4 (repeat start)
    # - Measure 2: D4 (will be repeated)
    # - Measure 3: E4 (first ending / volta 1, with backward repeat)
    # - Measure 4: F4 (second ending / volta 2)
    #
    # Expected playback sequence: C4 -> D4 -> E4 -> C4 -> D4 -> F4
    # After E4 (volta 1), only C4 and D4 are reset (they will be replayed),
    # but E4 stays green (volta 1 won't be replayed).
    load_score('repeat-endings.xml', 4)

    # First pass: C4 (measure 1)
    play_note('C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    # First pass: D4 (measure 2)
    play_note('D4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # First pass: E4 (measure 3, volta 1) - triggers repeat
    # After E4, only C4 and D4 are reset (will be replayed), E4 stays green
    play_note('E4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1  # Only E4 remains

    # Second pass: C4 again (measure 1, repeated)
    play_note('C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2  # E4 + C4

    # Second pass: D4 again (measure 2, repeated)
    play_note('D4')
    assert_selector 'svg g.vf-notehead.played-note', count: 3  # E4 + C4 + D4

    # Second pass: F4 (measure 4, volta 2) - skips volta 1
    play_note('F4')
    assert_selector 'svg g.vf-notehead.played-note', count: 4  # All notes green

    # Score should be completed after playing the correct sequence
    assert_text 'Partition terminée'
  end

  def test_autoscroll_when_moving_between_visual_systems
    # Save original window size
    original_size = page.current_window.size

    begin
      # Resize window to force more systems (one measure per system)
      page.current_window.resize_to(600, 1200)

      load_score('schumann-melodie.xml', 256)

      # Play cassette (measures 0-1, minus the very last note)
      # This brings us to the last note of measure 1 (end of first system)
      replay_cassette('melodie-2-bars')

      # Reset scroll to top (Capybara may have scrolled down to click the cassette button)
      page.execute_script('window.scrollTo(0, 0)')

      # Wait for scroll to stabilize before capturing position
      scroll_before_last_note = wait_for_stable_scroll

      # Simulate the last note of measure 1 (D4)
      # This should trigger the scroll to next system
      play_note('D4')

      # Wait for scroll to change from initial value, then stabilize
      scroll_after_last_note = wait_for_stable_scroll(expect_change_from: scroll_before_last_note)

      assert scroll_after_last_note > scroll_before_last_note, "Page should have scrolled down when completing last note of first system (before: #{scroll_before_last_note}, after: #{scroll_after_last_note})"
    ensure
      # Always restore original window size for subsequent tests
      page.current_window.resize_to(*original_size)
    end
  end

  def test_training_mode_autoscroll_only_after_clean_repetitions
    # This test verifies that auto-scroll only triggers when moving to the next measure
    # after completing 3 clean repetitions, not during the repetitions themselves
    original_size = page.current_window.size

    begin
      # Resize window to force each measure on its own system
      page.current_window.resize_to(300, 600)

      # Use repeat-endings score: 4 measures with one note each (C4, D4, E4, F4)
      load_score('repeat-endings.xml', 4)

      # Enable training mode
      click_on 'Mode Entraînement'
      assert_text 'Mode Entraînement Actif'

      # Play first repetition
      play_note('C4')
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      initial_scroll = wait_for_stable_scroll

      # Play second repetition - scroll should not change
      play_note('C4')
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      scroll_after_rep2 = wait_for_stable_scroll
      assert_equal initial_scroll, scroll_after_rep2, "Scroll should not change after second repetition"

      # Play third repetition - this triggers advancement
      play_note('C4')

      # Wait for advancement by checking repeat indicators reset to 0 filled
      assert_selector 'svg circle.repeat-indicator.filled', count: 0

      # Verify scroll changed when advancing to measure 2 (on different system)
      final_scroll = wait_for_stable_scroll
      assert final_scroll > initial_scroll, "Scroll should change when advancing to measure 2 (initial: #{initial_scroll}, final: #{final_scroll})"
    ensure
      page.current_window.resize_to(*original_size)
    end
  end

  def test_training_mode_autoscroll_works_when_starting_from_non_first_measure
    # This test verifies that auto-scroll works even when jumping to a measure > 0
    # (regression test: currentSystemIndex was null when not starting from measure 0)
    #
    # With a 200x600 window, each measure should be on its own system
    original_size = page.current_window.size

    begin
      # Very narrow window to force each measure on its own system
      page.current_window.resize_to(200, 600)

      load_score('repeat-endings.xml', 4)

      click_on 'Mode Entraînement'
      assert_text 'Mode Entraînement Actif'

      # Jump to measure 2 (index 1) - a non-first measure
      click_measure(2)

      # Capture initial scroll position
      initial_scroll = wait_for_stable_scroll

      # Play the note 3 times
      3.times do
        play_note('D4')
        assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      end

      # Wait for advancement by checking repeat indicators reset to 0 filled
      assert_selector 'svg circle.repeat-indicator.filled', count: 0

      # Verify scroll changed when advancing to measure 3 (on different system)
      final_scroll = wait_for_stable_scroll
      assert final_scroll > initial_scroll, "Scroll should work when starting from non-first measure (initial: #{initial_scroll}, final: #{final_scroll})"
    ensure
      page.current_window.resize_to(*original_size)
    end
  end

  def test_reinforcement_mode_after_playthrough_with_mistakes
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    assert_selector 'svg g.vf-stavenote', count: 4
    sleep 0.05  # Wait for all initialization to complete

    # Play with mistakes on measure 1
    # Sequence: C4 -> D4 -> E4 -> C4 -> D4 -> F4

    # Measure 1 (first pass) - play wrong note then correct
    play_note("D4")  # Wrong note (expected C4)
    play_note("C4")  # Correct

    # Measure 2 (first pass) - clean
    play_note("D4")

    # Measure 3 (volta 1) - triggers repeat
    play_note("E4")

    # Measure 1 (second pass) - clean
    play_note("C4")

    # Measure 2 (second pass) - clean
    play_note("D4")

    # Measure 4 (volta 2) - completes score
    play_note("F4")

    assert_text 'Partition terminée'

    # Close the completion modal
    click_on 'Close'

    # Verify reinforcement link is visible at the top
    assert_text 'Renforcer 1 mesure'

    # Start reinforcement mode
    click_on 'Renforcer 1 mesure'

    # Verify we're in training mode on measure 1
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.measure-click-area.selected'

    # Play measure 1 three times cleanly
    3.times do
      play_note("C4")
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
    end

    # Reinforcement should be complete (only 1 measure to reinforce)
    assert_text 'Renforcement terminé'
    assert_no_selector 'svg rect.measure-click-area.selected'
    assert_no_selector 'svg circle.repeat-indicator'
  end

  def test_rests_with_display_position_are_not_treated_as_notes
    # Regression test: OSMD interprets rests with display-step/display-octave as notes with pitch.
    # This caused a phantom G5 note to appear in measure 5 of Kinderscenen, breaking note order.
    # Note: This test uses URL-based loading which requires a fresh page (no prior visit to /score.html)
    Capybara.reset_sessions!
    visit '/score.html?url=/scores/Schumann_Kinderszenen_No_1.mxl'
    assert_selector 'svg g.vf-stavenote', minimum: 100

    click_on 'Mode Entraînement'
    click_measure(5)

    replay_cassette('bug-des-pays-lointains')

    assert_selector 'svg g.vf-notehead.played-note', count: 5
  end

  def test_playback_starts_and_stops
    load_score('simple-score.xml', 4)

    click_on 'Écouter'
    assert_text '⏹ Stop'

    click_on 'Stop'
    assert_text '▶ Écouter'
  end

  private

  def replay_cassette(name, wait_for_end: true)
    select name
    click_on 'Rejouer cassette'
    assert_text 'Rejeu terminé' if wait_for_end
  end

  # Wait for scroll position to stabilize (stop changing)
  # If expect_change is true, first wait for the scroll to change from initial value
  def wait_for_stable_scroll(expect_change_from: nil, max_iterations: 100, interval: 0.01)
    last_scroll = nil
    stable_count = 0
    changed = expect_change_from.nil?

    max_iterations.times do
      current_scroll = page.evaluate_script('window.scrollY')

      # If we expect a change, wait for scroll to differ from initial value
      if !changed && current_scroll != expect_change_from
        changed = true
      end

      if changed && current_scroll == last_scroll
        stable_count += 1
        return current_scroll if stable_count >= 3
      else
        stable_count = 0
        last_scroll = current_scroll
      end
      sleep interval
    end

    last_scroll
  end

  # Helper method to display the browser console logs.
  # Should remain unused in committed files but can be used by the AI agent when debugging.
  def console_logs
    logs = page.driver.browser.options.logger.string
    logs.split("\n").map do |line|
      next if line.empty?

      first_character = line.strip[0]
      next if ['◀', '▶'].include? first_character

      line
    end.compact
  end
end
