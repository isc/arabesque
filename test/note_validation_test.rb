require_relative 'test_helper'

# Which key presses count for the note the score expects, and how the noteheads
# say so: in order, chords and voices held together, ties held over rather than
# struck again.
class NoteValidationTest < CapybaraTestBase
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

  def test_rests_with_display_position_are_not_treated_as_notes
    # Regression test: OSMD interprets rests with display-step/display-octave as notes with pitch.
    # This caused a phantom G5 note to appear in measure 5 of Kinderscenen, breaking note order.
    visit '/score.html?url=/scores/Schumann_Kinderszenen_No_1.mxl'
    assert_selector 'svg g.vf-stavenote', minimum: 100

    click_on 'Mode Entraînement'
    click_measure(5)

    replay_cassette('bug-des-pays-lointains')

    assert_selector 'svg g.vf-notehead.played-note', count: 5
  end
end
