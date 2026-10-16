require_relative 'test_helper'

# The pace of the notes, besides the notes themselves (steadiness.js): a run
# that stops dead at a bar line marks the note that came late, and in
# training the repetition does not fill its dot.
#
# steady-quavers.xml is two bars of quavers, C4 up to C5 and back down. The
# clock is driven so the intervals are exact: GAP between notes, much longer
# where the test hesitates.
class SteadinessTest < CapybaraTestBase
  BAR_1 = %w[C4 D4 E4 F4 G4 A4 B4 C5].freeze
  BAR_2 = BAR_1.reverse.freeze
  # Shorter than the beat a finished repetition holds the sheet for: the step
  # into the passage's second bar has to be immediate for its first note to
  # count.
  GAP = 120
  HESITATION = 1_400

  def test_a_hesitation_at_the_join_spoils_the_repetition
    open_steady_quavers
    enter_training_mode
    pick_passage(1, 2)

    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(BAR_2, first_after: HESITATION)
      # Both bars clean, and the repetition still spoiled: the first note of
      # bar 2 is the one that came late.
      assert_selector 'svg circle.repeat-indicator.spoiled', count: 1
      assert_selector 'svg g.vf-notehead.late-note', count: 1
      assert_no_selector 'svg circle.repeat-indicator.filled'

      # Past the beat the passage starts over, and the note stays marked...
      advance_clock(300)
      assert_selector 'svg g.vf-notehead.late-note', count: 1
      assert_no_selector 'svg g.vf-notehead.played-note'

      # ...until it is played again, on time, and the dot fills.
      play_evenly(BAR_1 + BAR_2, first_after: 10)
      assert_no_selector 'svg g.vf-notehead.late-note'
      assert_selector 'svg circle.repeat-indicator.filled', count: 1
    end
  end

  def test_a_run_keeps_where_it_stopped_and_files_the_join
    open_steady_quavers

    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(BAR_2, first_after: HESITATION)
      # The run is over and the sheet cleared a beat later — but for the
      # note that came late.
      advance_clock(300)
    end
    assert_selector 'dialog[open]'
    assert_selector 'svg g.vf-notehead.late-note', count: 1
    assert_no_selector 'svg g.vf-notehead.played-note'

    # The join into bar 2 took nearly twelve quavers' time: filed on the
    # bar's attempt, which stays clean — no wrong note.
    wait_for_records('sessions', where: <<~JS.strip)
      record.measures.some((m) => m.sourceMeasureIndex === 1
        && m.attempts.some((a) => a.clean && a.hesitations === 1 && a.entryRatio > 10))
    JS

    # Strict mode marks its off-tempo notes in the same colour: the mark goes.
    find('dialog[open] button[aria-label="Close"]').click
    click_on '⏱ Mode strict'
    assert_no_selector 'svg g.vf-notehead.late-note'
  end

  private

  def open_steady_quavers
    visit '/score.html?url=/test-fixtures/steady-quavers.xml'
    wait_for_score_render(16)
  end

  def play_evenly(notes, first_after: GAP)
    notes.each_with_index do |note, i|
      advance_clock(i.zero? ? first_after : GAP)
      play_note(note)
    end
  end
end
