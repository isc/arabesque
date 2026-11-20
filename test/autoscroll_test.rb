require_relative 'test_helper'

# The page follows the cursor down the score, a system at a time — and in
# training mode only once the measure is done with, not while it is repeated.
# Each test narrows the window so that measures land on systems of their own.
class AutoscrollTest < CapybaraTestBase
  def setup
    visit '/score.html'
  end

  def test_autoscroll_when_moving_between_visual_systems
    # Narrow enough for one measure per system
    page.current_window.resize_to(600, 1200)
    load_score('schumann-melodie.xml', 256)

    # Play cassette (measures 0-1, minus the very last note)
    # This brings us to the last note of measure 1 (end of first system)
    replay_cassette('melodie-2-bars')

    # Start from the top, so the last note's scroll has somewhere to go
    page.execute_script('window.scrollTo(0, 0)')
    scroll_before_last_note = settled_scroll

    # The last note of measure 1 (D4) takes the cursor to the next system
    play_note('D4')

    scroll_after_last_note = settled_scroll(from: scroll_before_last_note)
    assert scroll_after_last_note > scroll_before_last_note, "Page should have scrolled down when completing last note of first system (before: #{scroll_before_last_note}, after: #{scroll_after_last_note})"
  end

  # Auto-scroll only triggers when moving to the next measure after completing
  # 3 clean repetitions, not during the repetitions themselves.
  def test_training_mode_autoscroll_only_after_clean_repetitions
    # Each measure on its own system
    page.current_window.resize_to(300, 600)

    # Use repeat-endings score: 4 measures with one note each (C4, D4, E4, F4)
    load_score('repeat-endings.xml', 4)
    enter_training_mode

    # Play first repetition
    play_note('C4')
    assert_no_selector 'svg .vf-notehead.played-note'  # Wait for measure reset
    initial_scroll = settled_scroll

    # Play second repetition - scroll should not change
    play_note('C4')
    assert_no_selector 'svg .vf-notehead.played-note'  # Wait for measure reset
    assert_equal initial_scroll, settled_scroll, 'Scroll should not change after second repetition'

    # Play third repetition - this triggers advancement
    play_note('C4')

    # Wait for advancement by checking repeat indicators reset to 0 filled
    assert_selector 'svg circle.repeat-indicator.filled', count: 0

    # Verify scroll changed when advancing to measure 2 (on different system)
    final_scroll = settled_scroll(from: initial_scroll)
    assert final_scroll > initial_scroll, "Scroll should change when advancing to measure 2 (initial: #{initial_scroll}, final: #{final_scroll})"
  end

  # The repeat dots hang over the measure's own noteheads, so a bar that climbs
  # above the staff carries them higher than the top staff line the autoscroll
  # anchors on — high enough to leave them under the sticky bars, with the
  # cursor sitting on a measure whose count of three cannot be read.
  def test_training_mode_autoscroll_keeps_the_repeat_dots_clear_of_the_sticky_bars
    page.current_window.resize_to(500, 500)

    # Measure 6 is three ledger lines above the staff; the measures after it
    # are what gives the page somewhere left to scroll.
    load_score('high-note-measure.xml', 24)
    enter_training_mode

    # Measure 4 closes its system, so filling its dots scrolls the next system
    # up — the position the dots of measure 6 then have to survive.
    click_measure(4)
    3.times do
      play_note('F4')
      assert_no_selector 'svg .vf-notehead.played-note'
    end
    settled_scroll

    3.times do
      play_note('G4')
      assert_no_selector 'svg .vf-notehead.played-note'
    end

    # Waits for the cursor to land rather than sampling where it is: the
    # geometry below is only worth reading once the high measure is the one
    # carrying the dots.
    wait_for_training_cursor(6)
    settled_scroll

    dots_top = page.evaluate_script(
      "document.getElementById('repeat-indicators').getBoundingClientRect().top"
    )

    # The headroom the page reserves for itself: what the sticky bars cover,
    # plus the breathing above the staff.
    reserved = sticky_bars_bottom + Integer(js_constant('utils.js', 'STICKY_BREATHING_PX'))
    assert dots_top >= reserved - 1,
           "Repeat dots should sit below the sticky bars (dots: #{dots_top}, reserved: #{reserved})"
  end

  # A strict run reads like free play: its system just under the bars, and the
  # room below it for the next one, to read ahead in. It used to centre the
  # cursor in the window instead — the system just played on top, the next one
  # cut off at the bottom of an iPad — and only once the count-in was over, so
  # the sheet moved on the very downbeat the player was reading it for
  # (feedbacks b06ddc5e and 8ea0e752).
  # At this width the band's text has a line of its own, which a single run
  # used to drop as the count-in ended: the same move, by another road.
  def test_a_strict_run_brings_its_system_under_the_bars_as_the_count_in_starts
    page.current_window.resize_to(500, 500)
    load_score('high-note-measure.xml', 24)
    start_strict_mode

    # Bar 9 opens the third system; the page is left at the top, away from it.
    click_measure(9)
    page.execute_script('window.scrollTo(0, 0)')
    at_the_top = settled_scroll

    with_clock_control do
      trigger_click_on('▶ Démarrer')
      # Past the first click of the count-in, which draws its beats.
      advance_clock(50)
      assert_selector '.pt-countin__beat.is-now', text: '1'
      settled_scroll(from: at_the_top)

      during_the_count_in = [cursor_top, sticky_bars_bottom]
      # Under the bars, with no more above it than its own markings ask for:
      # the breathing, and the band scanned for them. Centred, it sat some
      # 170px down.
      headroom = %w[STICKY_BREATHING_PX SYSTEM_TOP_LOOKUP_PX].sum { |name| Integer(js_constant('utils.js', name)) }
      assert_includes 0..headroom, during_the_count_in.reduce(:-).round,
                      "The run's system should sit just under the sticky bars (cursor, bars: #{during_the_count_in})"

      advance_clock(COUNT_IN_MS)
      assert_selector 'svg .vf-notehead.expected-note', wait: 4
      settled_scroll
      assert_equal during_the_count_in, [cursor_top, sticky_bars_bottom],
                   'Neither the system nor the bars over it should move as the count-in ends'
    end
  end

  # The training band travels with the sticky bars: a drill scrolls to its
  # passage, which took the band and its 🎹 out of sight (feedback 5110eacb).
  def test_the_training_band_stays_in_view_as_the_score_scrolls
    page.current_window.resize_to(500, 500)
    load_score('high-note-measure.xml', 24)
    enter_training_mode

    page.execute_script('window.scrollTo(0, 300)')
    assert_operator settled_scroll, :>, 0
    band_top = page.evaluate_script("document.querySelector('.pt-context--training').getBoundingClientRect().top")
    assert_operator band_top, :>=, 0
  end

  # Auto-scroll works even when jumping to a measure > 0 (regression test:
  # currentSystemIndex was null when not starting from measure 0).
  def test_training_mode_autoscroll_works_when_starting_from_non_first_measure
    # Very narrow window: each measure on its own system
    page.current_window.resize_to(200, 600)

    load_score('repeat-endings.xml', 4)
    enter_training_mode

    # Jump to measure 2 (index 1) - a non-first measure
    click_measure(2)
    initial_scroll = settled_scroll

    # Play the note 3 times
    3.times do
      play_note('D4')
      assert_no_selector 'svg .vf-notehead.played-note'  # Wait for measure reset
    end

    # Wait for advancement by checking repeat indicators reset to 0 filled
    assert_selector 'svg circle.repeat-indicator.filled', count: 0

    # Verify scroll changed when advancing to measure 3 (on different system)
    final_scroll = settled_scroll(from: initial_scroll)
    assert final_scroll > initial_scroll, "Scroll should work when starting from non-first measure (initial: #{initial_scroll}, final: #{final_scroll})"
  end

  # A bar picked from the history's worst measures can be anywhere in the piece,
  # and nothing on screen says where: the page has to go there. Down it from free
  # mode, the training band still to come up; back up it from training.
  def test_a_bar_picked_from_the_history_is_brought_into_view
    page.current_window.resize_to(500, 500)
    fumbled = { totalAttempts: 3, errorRate: 0.5 }
    seed_aggregates([{ scoreId: '/test-fixtures/high-note-measure.xml', measures: { '2' => fumbled, '20' => fumbled } }])
    visit '/score.html?url=/test-fixtures/high-note-measure.xml'
    wait_for_score_render(24)

    work_on_bar_from_history(21)
    work_on_bar_from_history(3)
  end

  # A drill passage over two systems, taken a hand at a time: the right hand
  # ends on the second, and the left starts back on the first.
  # one-hand-rest-measure.xml is three bars of whole notes on two staves: E5
  # over C3, a rest over D3, G5 over E3.
  def test_a_drill_step_for_other_hands_brings_the_top_of_its_passage_back
    # Bar 1 on a system of its own
    page.current_window.resize_to(300, 600)
    visit '/score.html?url=/test-fixtures/one-hand-rest-measure.xml'
    wait_for_score_render

    # The drill brings its passage under the bars, a few frames after it
    # starts: the page has to have left the top before it is read.
    reinforce_bars(1..3)
    assert_text 'Main droite seule'
    at_the_top = settled_scroll(from: 0)

    play_note('E5')
    further_down = settled_scroll(from: at_the_top)
    assert_operator further_down, :>, at_the_top, 'The page should follow the right hand down to bar 3'

    play_note('G5')
    assert_text 'Main gauche seule'
    assert_equal at_the_top, settled_scroll(from: further_down), 'The page should come back up to bar 1 for the left hand'
  end

  private

  def work_on_bar_from_history(bar)
    before = settled_scroll
    click_on 'Historique'
    find('.pt-hot-measure', text: "Mesure #{bar}").click
    wait_for_training_cursor(bar)
    settled_scroll(from: before)

    bar_top, bar_bottom, viewport = page.evaluate_script(<<~JS)
      (() => {
        const bar = document.querySelector('svg rect.measure-click-area.selected').getBoundingClientRect()
        return [bar.top, bar.bottom, innerHeight]
      })()
    JS
    assert_operator bar_top, :>=, sticky_bars_bottom, "Bar #{bar} should sit below the sticky bars"
    assert_operator bar_bottom, :<=, viewport, "Bar #{bar} should end inside the window"
  end

  def cursor_top
    page.evaluate_script(%q{document.querySelector('img[id^="cursorImg"]').getBoundingClientRect().top})
  end

  # Where the score starts to show: the bottom of what stays stuck above it.
  def sticky_bars_bottom
    page.evaluate_script("document.querySelector('.pt-stickybars').getBoundingClientRect().bottom")
  end

  # Where the page has come to rest: the same scroll position 150ms apart,
  # which a smooth scroll in flight (utils.js) never holds for that long. With
  # `from`, it has to have left that position first.
  def settled_scroll(from: nil)
    wait_until(from ? "the page to scroll away from #{from}" : 'the page to stop scrolling') do
      position = page.evaluate_script('window.scrollY')
      next if position == from

      sleep 0.15
      position if page.evaluate_script('window.scrollY') == position
    end
  end
end
