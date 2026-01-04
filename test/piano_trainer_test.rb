require_relative 'test_helper'

class PianoTrainerTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_play_simple_score_till_the_end
    load_score('simple-score.xml', 4)
    replay_cassette('oh-when-the-saints', wait_for_end: false)
    assert_text 'Partition terminée'
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

  def test_cassette_recording_saves_valid_midi_data
    cassette_name = 'test-recording'
    cassette_file = File.join(__dir__, '..', 'public', 'cassettes', "#{cassette_name}.json")

    begin
      load_score('simple-score.xml', 4)
      click_on 'Démarrer enregistrement'
      assert_text 'Enregistrement en cours'

      # Simulate MIDI events via custom events
      simulate_midi_input("ON C4")
      simulate_midi_input("OFF C4")
      simulate_midi_input("ON E4")
      simulate_midi_input("OFF E4")

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
    click_measure(8)

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
    simulate_midi_input("ON E5")
    simulate_midi_input("OFF E5")

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
    simulate_midi_input("ON E5")

    # The note should be validated (green) because left hand is disabled
    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end

  def test_hand_selection_left_hand_only
    load_score('schumann-melodie.xml', 256)

    # Uncheck right hand checkbox
    uncheck 'Main droite'

    # Play only the left hand note (C4)
    simulate_midi_input("ON C4")

    # The note should be validated because right hand is disabled
    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end

  def test_grace_notes_played_sequentially_before_main_note
    # Grace notes (ornaments) are played quickly before the main note.
    # They should be validated sequentially, NOT held together with the main note.
    # Score has: E4 (grace) -> F4 (grace) -> G4 (main)
    load_score('grace-note.xml', 3)

    # Play grace note E4 first
    simulate_midi_input("ON E4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    simulate_midi_input("OFF E4")

    # Play grace note F4 second
    simulate_midi_input("ON F4")
    assert_selector 'svg g.vf-notehead.played-note', count: 2
    simulate_midi_input("OFF F4")

    # Play main note G4 last
    simulate_midi_input("ON G4")
    assert_selector 'svg g.vf-notehead.played-note', count: 3
    simulate_midi_input("OFF G4")

    # Score should be completed
    assert_text 'Partition terminée'
  end

  def test_repeat_endings_playback_sequence
    # Score has:
    # - Measure 1: C4 (repeat start)
    # - Measure 2: E4 (first ending / volta 1, with backward repeat)
    # - Measure 3: F4 (second ending / volta 2)
    #
    # Expected playback sequence: C4 -> E4 -> C4 -> F4
    # (measure 1 is played twice, ending 1 first time, ending 2 second time)
    #
    # Note: Visual note count may differ from playback count because
    # repeated measures show the same SVG notes being highlighted again.
    load_score('repeat-endings.xml', 3)

    # First pass: C4 (measure 1)
    simulate_midi_input("ON C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    simulate_midi_input("OFF C4")

    # First pass: E4 (measure 2, ending 1) - triggers repeat
    simulate_midi_input("ON E4")
    assert_selector 'svg g.vf-notehead.played-note', count: 2
    simulate_midi_input("OFF E4")

    # Second pass: C4 again (measure 1, repeated)
    # Visual count stays at 2 because C4 is the same SVG note
    simulate_midi_input("ON C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 2
    simulate_midi_input("OFF C4")

    # Second pass: F4 (measure 3, ending 2) - skips ending 1
    simulate_midi_input("ON F4")
    assert_selector 'svg g.vf-notehead.played-note', count: 3
    simulate_midi_input("OFF F4")

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

      # Wait for scroll to stabilize before capturing position
      scroll_before_last_note = wait_for_stable_scroll

      # Simulate the last note of measure 1 (D4)
      # This should trigger the scroll to next system
      simulate_midi_input('ON D4')
      simulate_midi_input('OFF D4')

      # Wait for scroll to change from initial value, then stabilize
      scroll_after_last_note = wait_for_stable_scroll(expect_change_from: scroll_before_last_note)

      assert scroll_after_last_note > scroll_before_last_note, "Page should have scrolled down when completing last note of first system (before: #{scroll_before_last_note}, after: #{scroll_after_last_note})"
    ensure
      # Always restore original window size for subsequent tests
      page.current_window.resize_to(*original_size)
    end
  end

  private

  def load_score(filename, expected_notes)
    attach_file('musicxml-upload', File.expand_path("fixtures/#{filename}", __dir__))
    assert_selector 'svg g.vf-stavenote', count: expected_notes
    sleep 0.05  # Wait for DOM and callbacks to fully initialize
  end

  def replay_cassette(name, wait_for_end: true)
    select name
    click_on 'Rejouer cassette'
    assert_text 'Rejeu terminé' if wait_for_end
  end

  def click_measure(measure_number)
    page.all('svg rect.measure-click-area')[measure_number - 1].trigger('click')
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
