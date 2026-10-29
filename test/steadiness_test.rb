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

      # ...until the next repetition's first note: left up, it would read as
      # a fault of the repetition under way, in a bar not yet reached.
      play_evenly(BAR_1.take(1), first_after: 10)
      assert_no_selector 'svg g.vf-notehead.late-note'

      play_evenly(BAR_1.drop(1) + BAR_2)
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
    # bar's attempt as its join's, the bar itself clean and steady.
    wait_for_records('sessions', where: <<~JS.strip)
      record.measures.some((m) => m.sourceMeasureIndex === 1
        && m.attempts.some((a) => a.clean && a.joined && a.entryHole && !a.hesitations && a.entryRatio > 10))
    JS

    # Strict mode marks its off-tempo notes in the same colour: the mark goes.
    find('dialog[open] button[aria-label="Close"]').click
    click_on '⏱ Mode strict'
    assert_no_selector 'svg g.vf-notehead.late-note'
  end

  # Where a wrong key was played shows red once the repetition is over, beside
  # where it came late — and not before: until then, the right key turning the
  # note green is how the player knows it was taken.
  def test_a_note_fumbled_turns_red_once_the_repetition_is_over
    open_steady_quavers
    enter_training_mode
    pick_passage(1, 2)

    with_clock_control do
      play_evenly(%w[C4 D4])
      advance_clock(GAP)
      play_note('G4') # E4 is owed
      play_evenly(%w[E4], first_after: HESITATION)
      assert_selector 'svg g.vf-notehead.played-note', count: 3
      assert_no_selector 'svg g.vf-notehead.fumbled-note'

      play_evenly(BAR_1.drop(3) + BAR_2)
      assert_selector 'svg g.vf-notehead.fumbled-note', count: 1
      # The time the mistake took is its own, no hesitation.
      assert_no_selector 'svg g.vf-notehead.late-note'

      # Up through the beat the passage starts over after, gone with the next
      # repetition's first note.
      advance_clock(300)
      assert_selector 'svg g.vf-notehead.fumbled-note', count: 1
      play_evenly(BAR_1.take(1), first_after: 10)
      assert_no_selector 'svg g.vf-notehead.fumbled-note'
    end
  end

  # A run that stops at the bar line, both bars clean: what reinforcement
  # offers is the way in, the last beat of bar 1 and the first of bar 2,
  # which drilling bar 2 alone would never play (fragments.js).
  def test_a_join_stalled_at_is_reinforced_as_the_beats_on_either_side
    open_steady_quavers
    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(BAR_2, first_after: HESITATION)
    end
    find('dialog[open] button[aria-label="Close"]').click

    drill_the_fragment(%w[B4 C5 C5 B4], shaded_bars: 2)
  end

  # The stall of feedback 534a800b: the downbeat on time, and the hand only
  # then setting up for the rest of the bar. It is the way in all the same.
  def test_a_stall_after_the_downbeat_is_reinforced_as_the_way_in
    open_steady_quavers
    with_clock_control do
      play_evenly(BAR_1 + BAR_2.take(1))
      play_evenly(BAR_2.drop(1), first_after: HESITATION)
    end
    find('dialog[open] button[aria-label="Close"]').click

    drill_the_fragment(%w[B4 C5 C5 B4], shaded_bars: 2)
    # Each bar played in part: its attempts say nothing of the whole bar.
    wait_for_records('sessions', where: <<~JS.strip)
      record.mode === 'training' && [0, 1].every((bar) =>
        record.measures.some((m) => m.sourceMeasureIndex === bar && m.attempts.length && m.attempts.every((a) => a.partial)))
    JS
  end

  # What to drill is read again from the note log, not from what the page kept
  # of the run: a reload still offers it.
  def test_what_to_reinforce_is_read_back_from_the_note_log
    open_steady_quavers
    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(BAR_2, first_after: HESITATION)
    end
    wait_for_records('noteLogs')
    wait_for_records('sessions', where: 'record.endedAt')

    open_steady_quavers
    assert_selector '.pt-reinforce-badge', text: 'Renforcer 1 passage'
  end

  # A history played before the note log existed has none to read: its bars
  # and joins are offered the way they were, drilled as whole bars.
  def test_a_history_with_no_note_log_offers_its_bars_whole
    open_steady_quavers
    seed_store('sessions', [{
      id: '1700000000000-old', scoreId: '/test-fixtures/steady-quavers.xml', scoreTitle: 'Steady quavers',
      mode: 'free', startedAt: '2023-11-14T22:13:20.000Z', endedAt: '2023-11-14T22:15:00.000Z', totalMeasures: 2,
      measures: [{ sourceMeasureIndex: 1, attempts: [
        { startedAt: '2023-11-14T22:13:30.000Z', durationMs: 3000, wrongNotes: 1, clean: false, hands: 'both' },
      ] }],
    }])

    open_steady_quavers
    click_on 'Renforcer 1 passage'
    assert_selector 'svg rect.fragment-range', count: 1
    with_clock_control do
      3.times { play_evenly(BAR_2, first_after: 300) }
    end
    assert_text 'Tout ce qui était proposé a été renforcé avec succès.'
  end

  # Two passages taking turns, each round going back up the score to the
  # first: where it starts is where it owes a note, which the other fragment,
  # still in place as the drill moved on, once said was nowhere — and the drill
  # started at the end of the score, nothing shaded.
  def test_a_drill_moves_on_to_a_passage_earlier_in_the_score
    open_steady_quavers
    with_clock_control do
      play_evenly(%w[C4 D4])
      play_note('G4') # E4 is owed
      play_evenly(%w[E4 F4 G4 A4 B4 C5 C5 B4 A4 G4 F4 E4])
      play_note('F4') # D4 is owed
      play_evenly(%w[D4])
      play_note('A4') # C4 is owed: two notes of that beat fumbled, against one
      play_evenly(%w[C4])
    end
    find('dialog[open] button[aria-label="Close"]').click

    click_on 'Renforcer 2 passages'
    3.times do |round|
      with_clock_control do
        play_evenly(%w[C4 D4 E4 F4], first_after: 300)
        play_evenly(%w[F4 E4 D4 C4], first_after: 300)
        advance_clock(1_000)
      end
      # Back up to the first passage, shaded — but for the last round, which
      # ends the drill.
      assert_selector 'svg rect.fragment-range', count: 1 if round < 2
    end
    assert_text 'Tout ce qui était proposé a été renforcé avec succès.'
  end

  # A wrong note inside a bar: its beat, and the beat before.
  def test_a_wrong_note_inside_a_bar_offers_its_beat_and_the_one_before
    open_steady_quavers
    with_clock_control do
      play_evenly(BAR_1)
      play_evenly(%w[C5 B4 G4 A4 G4 F4 E4 D4 C4]) # G4 where A4 is owed
    end
    find('dialog[open] button[aria-label="Close"]').click

    drill_the_fragment(%w[C5 B4 A4 G4], shaded_bars: 1)
  end

  # A late group can hold a tie the player never let go of: only the note
  # struck over it came late. (held-tie-under-quavers.xml: quavers C5 up to
  # C6 over a C4 tied from beat 1 into beat 3.)
  def test_a_tie_held_through_a_hole_is_not_marked_late
    visit '/score.html?url=/test-fixtures/held-tie-under-quavers.xml'
    wait_for_score_render(10)

    with_clock_control do
      simulate_midi_input('ON C4')
      play_evenly(%w[C5 D5 E5 F5])
      play_evenly(%w[G5 A5 B5 C6], first_after: HESITATION)
      simulate_midi_input('OFF C4')
    end
    # G5 came late; the C4 held under it did not.
    assert_selector 'svg g.vf-notehead.late-note', count: 1
  end

  private

  def open_steady_quavers
    visit '/score.html?url=/test-fixtures/steady-quavers.xml'
    wait_for_score_render(16)
  end

  # The one passage offered, drilled to done: three clean repetitions of
  # `notes`, the rest of the bars around them owed nothing.
  def drill_the_fragment(notes, shaded_bars:)
    click_on 'Renforcer 1 passage'
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.fragment-range', count: shaded_bars

    with_clock_control do
      3.times { play_evenly(notes, first_after: 300) }
    end
    assert_text 'Tout ce qui était proposé a été renforcé avec succès.'
  end

  def play_evenly(notes, first_after: GAP)
    notes.each_with_index do |note, i|
      advance_clock(i.zero? ? first_after : GAP)
      play_note(note)
    end
  end
end
