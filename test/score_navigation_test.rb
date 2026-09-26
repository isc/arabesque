require_relative 'test_helper'

# Where the next note is expected: the path through repeats and voltas, and a
# measure clicked to pick the piece up from.
#
# repeat-endings.xml is one note per measure — C4, D4, then E4 under volta 1 and
# F4 under volta 2 — so it is played C4 D4 E4 C4 D4 F4.
class ScoreNavigationTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_repeat_endings_playback_sequence
    # Score has:
    # - Measure 1: C4 (repeat start)
    # - Measure 2: D4 (will be repeated)
    # - Measure 3: E4 (first ending / volta 1, with backward repeat)
    # - Measure 4: F4 (second ending / volta 2)
    #
    # Expected playback sequence: C4 -> D4 -> E4 -> C4 -> D4 -> F4
    # After E4 (volta 1), only C4 and D4 are reset (they will be replayed),
    # but E4 stays green (volta 1 won't be replayed).
    load_score('repeat-endings.xml', 4)

    # First pass: C4 (measure 1)
    play_note('C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    # First pass: D4 (measure 2)
    play_note('D4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # First pass: E4 (measure 3, volta 1) - triggers repeat
    # After E4, only C4 and D4 are reset (will be replayed), E4 stays green
    play_note('E4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1  # Only E4 remains

    # Second pass: C4 again (measure 1, repeated)
    play_note('C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2  # E4 + C4

    # Second pass: D4 again (measure 2, repeated)
    play_note('D4')
    assert_selector 'svg g.vf-notehead.played-note', count: 3  # E4 + C4 + D4

    # Second pass: F4 (measure 4, volta 2) - skips volta 1
    play_note('F4')
    assert_selector 'svg g.vf-notehead.played-note', count: 4  # All notes green

    # Score should be completed after playing the correct sequence
    assert_text 'Partition terminée'
  end

  def test_free_play_allows_clicking_measure_to_reposition
    load_score('repeat-endings.xml', 4)

    # One click area per engraved measure, even without training mode. A
    # repeated measure is played twice but drawn once: a rect per pass would
    # stack identical ones, and the click would land on the topmost — the last
    # pass — restarting past the repeat.
    assert_selector 'svg rect.measure-click-area', count: 4

    # Play first two measures: C4 (measure 1) and D4 (measure 2)
    play_note("C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    play_note("D4")
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # Click on measure 1 to reposition - should reset measure 1 and all following
    click_measure(1)
    assert_no_selector 'svg g.vf-notehead.played-note'

    # Back on the first pass, so the whole sequence is owed again. Measure 3 is
    # volta 1 (E4), which the second pass never plays: it stays green while the
    # repeat resets measures 1 and 2.
    play_note("C4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    play_note("D4")
    play_note("E4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    assert_no_text 'Partition terminée'

    # Second pass, ending on volta 2 (F4) - only now is the score finished
    play_note("C4")
    play_note("D4")
    play_note("F4")
    assert_text 'Partition terminée'
  end

  def test_restarting_from_the_top_starts_the_run_over
    # The tracker restarts its clock when the run is picked up from its first
    # measure, so the measures already played can't stay to its credit: the
    # last measure alone would otherwise finish the score, and the run would be
    # recorded with the time of that one measure.
    load_score('repeat-endings.xml', 4)

    # Everything but the second ending: C4 D4 E4 (volta 1), then the repeat.
    play_note("C4")
    play_note("D4")
    play_note("E4")
    play_note("C4")
    play_note("D4")

    click_measure(1)

    # Straight to the second ending. Only that measure has been played since
    # the restart, so the score is not finished.
    click_measure(4)
    play_note("F4")
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    assert_no_text 'Partition terminée'
  end

  def test_a_measure_is_clickable_on_the_staff_its_hand_rests_on
    # Measure 2 is a whole rest in the right hand. Its click area used to be
    # built from the staves holding notes only, so the treble staff above the
    # rest was dead to the click that picks where to play from.
    load_score('one-hand-rest-measure.xml', 6)

    # Just under the top staff line of the treble staff, at the middle of the
    # measure's click area: above the whole rest, which hangs from line 4.
    x, y = page.evaluate_script(<<~JS)
      (() => {
        const rect = document.querySelector('rect.measure-click-area[data-measure-index="1"]').getBoundingClientRect()
        const lines = [...document.querySelectorAll('g.vf-measure[id="2"] > path')]
          .map((p) => p.getBoundingClientRect())
          .filter((r) => r.height < 1 && r.width > 0)
        return [rect.left + rect.width / 2, Math.min(...lines.map((r) => r.top)) + 2]
      })()
    JS
    page.driver.browser.mouse.click(x: x, y: y)

    # Measure 2's left-hand D3 is only the next note if the click landed there.
    play_note('D3')
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    assert_no_selector 'svg g.vf-notehead.wrong-note'
  end
end
