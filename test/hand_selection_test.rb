require_relative 'test_helper'

# The MD / MG toggles: a hand left out is not waited for.
class HandSelectionTest < CapybaraTestBase
  def setup
    visit '/score.html'
  end

  def test_hand_selection_right_hand_only
    load_score('schumann-melodie.xml', 256)

    # Schumann measure 1 has polyphonic notes:
    # - E5 (MIDI 76) on staff 0 (right hand)
    # - C4 (MIDI 60) on staff 1 (left hand)

    # Short label, full words as its name and tooltip (feedback 0140c7ed).
    assert_selector '.pt-hands__option[title="Main gauche"]', text: 'MG'

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

  def test_changing_hands_starts_the_measure_under_way_over
    load_score('schumann-melodie.xml', 256)

    # Measure 1's first two right-hand notes, the left hand unticked.
    uncheck 'Main gauche'
    play_notes(%w[E5 D5])
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # Ticked back, the left hand's notes from the start of the bar are owed
    # again; the half-bar played without them would leave the right hand ahead
    # and the measure asking for notes the player has left behind.
    check 'Main gauche'
    assert_no_selector 'svg g.vf-notehead.played-note'

    simulate_midi_input('ON E5')
    simulate_midi_input('ON C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2
    assert_no_selector 'svg g.vf-notehead.wrong-note'
  end

  def test_hand_selection_crosses_a_measure_the_other_hand_holds_alone
    # Measure 2 is a whole rest in the right hand, so working the right hand
    # alone has to cross it. See nextPlayableMeasure in noteExtraction.js.
    load_score('one-hand-rest-measure.xml', 6)

    uncheck 'Main gauche'

    # Measure 1's right hand, then measure 3's: the middle measure has to be
    # crossed on its own for the last note to be the one that validates.
    on_the_last_note do
      play_notes(%w[E5 G5])
      assert_selector 'svg g.vf-notehead.played-note', count: 2
    end
  end

  # Unticking MD before ticking MG leaves no hand ticked for a moment, which
  # sent the cursor to the last measure and kept it there: the left hand's
  # run had nothing to validate until measure 1 was picked by hand
  # (feedback 65538ec6).
  def test_passing_through_no_hand_keeps_the_cursor_in_place
    load_score('one-hand-rest-measure.xml', 6)

    uncheck 'Main droite'
    uncheck 'Main gauche'
    check 'Main gauche'
    play_note('C3')

    assert_selector 'svg g.vf-notehead.played-note', count: 1
  end
end
