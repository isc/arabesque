require_relative 'test_helper'

# Block chords, plaqué (musicxml.js): in training, each beat is struck as one
# chord, every note of it held down at once, where the beat starts — a
# rehearsal of the passage, which fills no dot. Offered on a passage written
# in broken chords alone, and advised in a drill where the runs stalled at the
# bar line.
#
# broken-chords.xml is two bars of semiquavers in 4/4, each beat a broken
# chord that comes back to its middle note: C E G E twice, then C F A F twice;
# B D G D twice, then C E G E twice.
class PlaqueTest < CapybaraTestBase
  BAR_1_BEATS = [%w[C4 E4 G4 E4], %w[C4 E4 G4 E4], %w[C4 F4 A4 F4], %w[C4 F4 A4 F4]].freeze
  BAR_2_BEATS = [%w[B3 D4 G4 D4], %w[B3 D4 G4 D4], %w[C4 E4 G4 E4], %w[C4 E4 G4 E4]].freeze
  # The join into bar 2, as reinforcement drills it: bar 1's last beat and
  # bar 2's first.
  JOIN = (BAR_1_BEATS.last + BAR_2_BEATS.first).freeze

  def test_each_beat_is_played_as_one_chord
    open_score('broken-chords', 32)
    enter_training_mode
    click_on '🎹 Plaqué'
    assert_text 'Plaqué : chaque temps se joue en un accord'

    with_clock_control do
      # One note of the beat let go before the others come down is no chord.
      play_note('C4')
      play_note('E4')
      play_note('G4')
      assert_no_selector 'svg g.vf-notehead.played-note'

      # The bar played, and no dot for it.
      play_evenly(BAR_1_BEATS.map(&:uniq))
      assert_selector 'svg g.vf-notehead.played-note', count: 16
      assert_no_selector 'svg circle.repeat-indicator.filled'
      advance_clock(300)

      # A key the beat does not hold is a wrong note, the repetition spoiled.
      play_evenly([%w[C4 D4]])
      assert_selector 'svg circle.repeat-indicator.spoiled', count: 1
    end
    # The bar was not played as written: the journal files it as partial,
    # which says nothing of the bar as a whole.
    wait_for_records('sessions', where: <<~JS.strip)
      record.mode === 'training' && record.measures.some((m) => m.attempts.length)
        && record.measures.every((m) => m.attempts.every((a) => a.partial))
    JS
  end

  # A line has no chord to find: nothing is offered on it.
  def test_a_line_is_offered_no_block_chords
    open_score('steady-quavers', 16)
    enter_training_mode
    assert_text 'Chaque mesure doit être jouée'
    assert_no_button '🎹 Plaqué'
  end

  # The runs stalled at the join into bar 2, the hand looking for the next
  # chord once the downbeat was down: the drill advises block chords there.
  # They keep the turn on the passage however cleanly they go; its dots are
  # earned playing it as written, which is what settles it. The cold first try
  # went to the chords, so the end has none to report.
  def test_a_stall_at_the_bar_line_is_advised_block_chords_and_drilled_as_written
    open_score('broken-chords', 32)
    with_clock_control do
      play_evenly(BAR_1_BEATS.flatten + BAR_2_BEATS.first.take(1))
      play_evenly(BAR_2_BEATS.flatten.drop(1), first_after: 1_400)
    end
    find('dialog[open] button[aria-label="Close"]').click

    click_on 'Renforcer 1 passage'
    assert_text 'Ce passage cale juste après la barre de mesure'
    assert_selector 'button.is-advised', text: '🎹 Plaqué'

    click_on '🎹 Plaqué'
    assert_no_selector 'button.is-advised'
    with_clock_control do
      2.times do
        play_evenly([BAR_1_BEATS.last.uniq, BAR_2_BEATS.first.uniq])
        advance_clock(300)
      end
      assert_no_selector 'svg circle.repeat-indicator.filled'
    end

    click_on '🎹 Plaqué'
    with_clock_control do
      3.times { play_evenly(JOIN, first_after: 300) }
    end
    assert_text 'Renforcement terminé'
    assert_no_selector '.pt-modal-stat'
    find('dialog[open] button[aria-label="Close"]').click
    assert_no_selector '.pt-reinforce-badge'
  end

  private

  def open_score(name, notes)
    visit "/score.html?url=/test-fixtures/#{name}.xml"
    wait_for_score_render(notes)
  end
end
