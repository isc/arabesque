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

    play_perfect_chord_run

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

    # The verdict stays on the score to be read, but leaves with the mode.
    within('dialog.pt-result-dialog') { click_on 'Fermer' }
    assert_selector 'svg g.vf-notehead.missed-note', count: 3
    click_on 'Libre'
    assert_no_selector 'svg g.vf-notehead.missed-note'
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

    play_perfect_chord_run

    # Leaving the page before the session lands would lose it from the journal.
    wait_for_records('sessions', where: "record.completedAt && record.measures.length === 1 && record.mode === 'strict'")

    # Filed as what it is: a run to the metronome, with its verdict, not a
    # free run whose time would rank against the player's own. The result
    # modal is still up; its own button leads to the history.
    within('dialog.pt-result-dialog') { click_on 'Historique' }
    within '#scoreHistoryModal' do
      assert_text '1× en entier (100 % à 120 BPM) · mode strict'
      assert_no_text 'Évolution'
    end

    visit '/library.html'
    within '#daily-log' do
      assert_text 'Chord Test'
      assert_text 'Joué en entier · mode strict'
    end
  end

  # A run to the end with a note missed is still the piece played through —
  # the metronome moved on — and it is listed with its verdict, which is the
  # point. Demanding a clean run left nearly every real run out of the journal.
  def test_a_run_with_a_missed_note_still_counts_as_played_in_full
    visit '/score.html?url=/test-fixtures/chord.xml'
    wait_for_score_render(1)
    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')
      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.expected-note', wait: 4
      play_chord(%w[C4 E4])
      advance_clock(1000)
      assert_text 'Playthrough strict terminé', wait: 2
    end
    assert_text '67%'
    assert_text '1 manquée'

    wait_for_records('sessions', where: 'record.completedAt && record.measures.length === 1')

    within('dialog.pt-result-dialog') { click_on 'Historique' }
    within '#scoreHistoryModal' do
      assert_text '1× en entier (67 % à 120 BPM) · mode strict'
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

  # The tempo trainer: the passage between two clicked measures, run after run
  # with a pause between them, the tempo moving with the results — and a
  # summary of the runs when ⏸ ends it.
  def test_loop_replays_the_passage_and_sums_the_runs_up
    load_score('two-measures.xml', 2)
    start_strict_mode
    click_on '🔁 Boucle'
    click_measure(1)
    assert_text 'cliquez sur la dernière mesure du passage'
    click_measure(1)
    assert_text 'Boucle des mesures 1 à 1.'

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      # Count-in 2s, then the whole-note C4 of bar 1 — the only note expected.
      advance_clock(2000)
      assert_selector 'svg g.vf-notehead.expected-note', count: 1, wait: 4
      play_chord(%w[C4])

      # The passage stops at bar 1: past its tail (450ms window + 300ms) the
      # run is judged and the band counts it in the streak, while a run to
      # the end of the score would still be waiting for bar 2.
      advance_clock(1000)
      assert_text '120 BPM · passage 1 · 1 sur 3 propres', wait: 2
      assert_no_selector 'svg g.vf-notehead.missed-note'

      # A second's pause, then the next run counts in.
      advance_clock(1000)
      assert_selector '.pt-countin__beat.is-now', text: '1', wait: 2

      trigger_click_on('⏸ Pause')
    end

    assert_text 'Boucle terminée'
    assert_text '1 passage'
    assert_text 'à 120 BPM'
    assert_text 'meilleure série : 1 propres'
  end

  # A count-in is a whole bar in which nothing else on screen moves. Reported as
  # feedback 659acd4e by a player who never noticed there was one — the clicks
  # come out of the device, and she was at the piano.
  def test_the_count_in_is_shown_beat_by_beat
    load_score('chord.xml', 1)
    start_strict_mode

    with_clock_control do
      trigger_click_on('▶ Démarrer')

      # 4/4 at 120 BPM: four beats of 500ms. The first lands on the click; the
      # budget only has to clear it, not reach the second.
      advance_clock(50)
      assert_selector '.pt-countin__beat', count: 4
      assert_selector '.pt-countin__beat.is-now', text: '1'

      advance_clock(500)
      assert_selector '.pt-countin__beat.is-now', text: '2'

      # The band stays, its contents swap back: the score must not move on the
      # downbeat, which is the moment the player is reading it.
      top_before = score_top
      advance_clock(1450)
      assert_no_selector '.pt-countin__beat'
      assert_selector 'svg g.vf-notehead.expected-note', wait: 4
      assert_equal top_before, score_top
    end
  end

  private

  def score_top
    page.evaluate_script("document.querySelector('.pt-score-main').getBoundingClientRect().top")
  end

  # BPM=120 → 2s count-in, ±150ms strict window, ±450ms off-tempo. The window
  # is an absolute constant, so the tempo is what every timing comment below
  # is expressed against.
  def start_strict_mode(bpm: 120)
    click_on '⏱ Mode strict'
    fill_in 'Tempo en BPM', with: bpm.to_s
  end

  # One flawless run of chord.xml at the tempo start_strict_mode set, from
  # ▶ Démarrer to the result modal.
  def play_perfect_chord_run
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
  end
end
