require_relative 'test_helper'

# Block chords, plaqué (musicxml.js): in training, each beat is struck as one
# chord, every note of it held down at once, where the beat starts — a
# rehearsal of the passage, which fills no dot. steady-quavers.xml is two bars
# of quavers in 4/4, C4 up to C5 and back down: a bar is four chords of two
# notes.
class PlaqueTest < CapybaraTestBase
  BAR_1_BEATS = [%w[C4 D4], %w[E4 F4], %w[G4 A4], %w[B4 C5]].freeze
  BAR_1 = BAR_1_BEATS.flatten.freeze
  GAP = 120

  def test_each_beat_is_played_as_one_chord
    open_steady_quavers
    enter_training_mode
    click_on '🎹 Plaqué'
    assert_text 'Plaqué : chaque temps se joue en un accord'

    with_clock_control do
      # One note of the beat let go before the other comes down is no chord.
      play_note('C4')
      play_note('D4')
      assert_no_selector 'svg g.vf-notehead.played-note'

      # The bar played, and no dot for it.
      play_chords(BAR_1_BEATS)
      assert_selector 'svg g.vf-notehead.played-note', count: 8
      assert_no_selector 'svg circle.repeat-indicator.filled'
      advance_clock(300)

      # A key the beat does not hold is a wrong note, the repetition spoiled.
      play_chords([%w[C4 E4]])
      assert_selector 'svg circle.repeat-indicator.spoiled', count: 1
    end
    # The bar was not played as written: the journal files it as partial,
    # which says nothing of the bar as a whole.
    wait_for_records('sessions', where: <<~JS.strip)
      record.mode === 'training' && record.measures.some((m) => m.attempts.length)
        && record.measures.every((m) => m.attempts.every((a) => a.partial))
    JS
  end

  # In a drill, block chords keep the turn on the passage however cleanly they
  # go: its dots are earned playing it as written, which is what settles it.
  # The cold first try went to the chords, so the end has none to report.
  def test_a_drill_earns_its_dots_as_written
    open_steady_quavers
    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(BAR_1.reverse, first_after: 1_400)
    end
    find('dialog[open] button[aria-label="Close"]').click

    click_on 'Renforcer 1 passage'
    click_on '🎹 Plaqué'
    with_clock_control do
      2.times do
        play_chords([%w[B4 C5], %w[C5 B4]])
        advance_clock(300)
      end
      assert_no_selector 'svg circle.repeat-indicator.filled'
    end

    click_on '🎹 Plaqué'
    with_clock_control do
      3.times { play_evenly(%w[B4 C5 C5 B4], first_after: 300) }
    end
    assert_text 'Renforcement terminé'
    assert_no_selector '.pt-modal-stat'
    find('dialog[open] button[aria-label="Close"]').click
    assert_no_selector '.pt-reinforce-badge'
  end

  private

  def open_steady_quavers
    visit '/score.html?url=/test-fixtures/steady-quavers.xml'
    wait_for_score_render(16)
  end

  def play_chords(chords)
    chords.each do |chord|
      advance_clock(GAP)
      play_chord(chord)
    end
  end

  def play_evenly(notes, first_after: GAP)
    notes.each_with_index do |note, i|
      advance_clock(i.zero? ? first_after : GAP)
      play_note(note)
    end
  end
end
