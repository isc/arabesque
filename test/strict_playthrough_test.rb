require_relative 'test_helper'

class StrictPlaythroughTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_strict_mode_button_starts_and_stops_engine
    load_score('chord.xml', 1)

    click_on '⏱ Mode strict'
    click_on '▶ Démarrer'
    assert_text '⏸ Pause'

    click_on '⏸ Pause'
    assert_text '▶ Démarrer'
    # Aborted runs do not surface the result modal
    assert_no_text 'Playthrough strict terminé'
  end

  def test_perfect_play_reports_100_percent
    load_score('chord.xml', 1)

    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      # Sync on the engine opening the timing window (cursor arrival at T=2s).
      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.expected-note', wait: 4

      # The clock is parked exactly on the note's instant, so the chord lands
      # dead centre of the tolerance window rather than wherever the runner
      # happened to schedule it.
      play_chord(%w[C4 E4 G4])

      # Past the last event's off-tempo window (450ms) and the 300ms tail.
      advance_clock(1000)
      assert_text 'Playthrough strict terminé', wait: 2
    end

    assert_text '100%'
    assert_text '3 sur 3'
    assert_no_text 'fausses notes'
    assert_no_text 'manquées'
    assert_no_text 'hors tempo'
  end

  def test_no_input_marks_all_notes_missed
    load_score('chord.xml', 1)
    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      # Count-in 2s + off-tempo window 450ms + 300ms tail.
      advance_clock(3000)
      assert_text 'Playthrough strict terminé', wait: 4
    end

    assert_text '0%'
    assert_text '3 manquées'
  end

  # Regression: a strict run used to leave no trace at all — its notes go to the
  # strict engine instead of the score's cursor, so nothing ever fed the
  # practice tracker and a piece played end to end in strict mode was missing
  # from the practice journal.
  def test_full_run_lands_in_the_practice_journal
    # From the catalog rather than an upload: a session is only opened for a
    # score that has a URL, and there is nothing to record without one.
    visit '/score.html?url=/test-fixtures/chord.xml'
    wait_for_score_render(1)
    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.expected-note', wait: 4
      play_chord(%w[C4 E4 G4])

      advance_clock(1000)
      assert_text 'Playthrough strict terminé', wait: 2
    end

    # Leaving the page before the session lands would lose it from the journal.
    wait_for_records('sessions', where: 'record.completedAt && record.measures.length === 1')

    visit '/library.html'
    within '#daily-log' do
      assert_text 'Chord Test'
      assert_text 'Joué en entier'
    end
  end

  # Regression: when the cursor crosses a repeat barline, free mode wipes the
  # whole upcoming repeat section. Strict mode must do the same — clearing only
  # the entered measure leaves later notes in the section showing first-pass
  # results until the cursor walks into them.
  def test_repeat_clears_whole_section_at_boundary_not_per_measure
    load_score('repeat-endings.xml', 4)
    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      # First pass: play m1 (C4), m2 (D4), m3 (E4) correctly. Each is a whole
      # note → 2s/measure at BPM=120. Land exactly on T=2,4,6.
      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.expected-note', wait: 4
      play_chord(%w[C4])
      advance_clock(2000)
      play_chord(%w[D4])
      advance_clock(2000)
      play_chord(%w[E4])

      # After E4, the cursor jumps back to m1 at T=8s and the boundary reset
      # fires. Only E4 (volta-1, never replayed) should still show played-note.
      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.played-note', count: 1, wait: 4

      # Second pass replays m1 and m2 then takes volta 2 (F4) at T=12s; the run
      # ends after that event's window and the 300ms tail. Let it finish so
      # teardown is clean.
      advance_clock(5000)
      assert_text 'Playthrough strict terminé', wait: 12
    end
  end

  private

  # BPM=120 → 2s count-in, ±150ms strict window, ±450ms off-tempo. The window
  # is an absolute constant, so the tempo is what every timing comment below
  # is expressed against.
  def start_strict_mode(bpm: 120)
    click_on '⏱ Mode strict'
    fill_in 'Tempo en BPM', with: bpm.to_s
  end
end
