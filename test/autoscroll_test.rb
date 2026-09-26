require_relative 'test_helper'

# The page follows the cursor down the score, a system at a time — and in
# training mode only once the measure is done with, not while it is repeated.
# Each test narrows the window so that measures land on systems of their own.
class AutoscrollTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_autoscroll_when_moving_between_visual_systems
    # Save original window size
    original_size = page.current_window.size

    begin
      # Resize window to force more systems (one measure per system)
      page.current_window.resize_to(600, 1200)

      load_score('schumann-melodie.xml', 256)

      # Play cassette (measures 0-1, minus the very last note)
      # This brings us to the last note of measure 1 (end of first system)
      replay_cassette('melodie-2-bars')

      # Start from the top, so the last note's scroll has somewhere to go
      page.execute_script('window.scrollTo(0, 0)')

      # Wait for scroll to stabilize before capturing position
      scroll_before_last_note = wait_for_stable_scroll

      # Simulate the last note of measure 1 (D4)
      # This should trigger the scroll to next system
      play_note('D4')

      # Wait for scroll to change from initial value, then stabilize
      scroll_after_last_note = wait_for_stable_scroll(expect_change_from: scroll_before_last_note)

      assert scroll_after_last_note > scroll_before_last_note, "Page should have scrolled down when completing last note of first system (before: #{scroll_before_last_note}, after: #{scroll_after_last_note})"
    ensure
      # Always restore original window size for subsequent tests
      page.current_window.resize_to(*original_size)
    end
  end

  def test_training_mode_autoscroll_only_after_clean_repetitions
    # This test verifies that auto-scroll only triggers when moving to the next measure
    # after completing 3 clean repetitions, not during the repetitions themselves
    original_size = page.current_window.size

    begin
      # Resize window to force each measure on its own system
      page.current_window.resize_to(300, 600)

      # Use repeat-endings score: 4 measures with one note each (C4, D4, E4, F4)
      load_score('repeat-endings.xml', 4)

      # Enable training mode
      click_on 'Mode Entraînement'
      assert_text 'Mode Entraînement Actif'

      # Play first repetition
      play_note('C4')
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      initial_scroll = wait_for_stable_scroll

      # Play second repetition - scroll should not change
      play_note('C4')
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      scroll_after_rep2 = wait_for_stable_scroll
      assert_equal initial_scroll, scroll_after_rep2, "Scroll should not change after second repetition"

      # Play third repetition - this triggers advancement
      play_note('C4')

      # Wait for advancement by checking repeat indicators reset to 0 filled
      assert_selector 'svg circle.repeat-indicator.filled', count: 0

      # Verify scroll changed when advancing to measure 2 (on different system)
      final_scroll = wait_for_stable_scroll
      assert final_scroll > initial_scroll, "Scroll should change when advancing to measure 2 (initial: #{initial_scroll}, final: #{final_scroll})"
    ensure
      page.current_window.resize_to(*original_size)
    end
  end

  # The repeat dots hang over the measure's own noteheads, so a bar that climbs
  # above the staff carries them higher than the top staff line the autoscroll
  # anchors on — high enough to leave them under the sticky bars, with the
  # cursor sitting on a measure whose count of three cannot be read.
  def test_training_mode_autoscroll_keeps_the_repeat_dots_clear_of_the_sticky_bars
    original_size = page.current_window.size

    begin
      page.current_window.resize_to(500, 500)

      # Measure 6 is three ledger lines above the staff; the measures after it
      # are what gives the page somewhere left to scroll.
      load_score('high-note-measure.xml', 24)

      click_on 'Mode Entraînement'
      assert_text 'Mode Entraînement Actif'

      # Measure 4 closes its system, so filling its dots scrolls the next system
      # up — the position the dots of measure 6 then have to survive.
      click_measure(4)
      3.times do
        play_note('F4')
        assert_no_selector 'svg g.vf-notehead.played-note'
      end
      wait_for_stable_scroll

      3.times do
        play_note('G4')
        assert_no_selector 'svg g.vf-notehead.played-note'
      end

      # Waits for the cursor to land rather than sampling where it is: the
      # geometry below is only worth reading once the high measure is the one
      # carrying the dots.
      assert_selector 'svg rect.measure-click-area.selected[data-measure-index="5"]'
      wait_for_stable_scroll

      # The headroom the page reserves for itself: what the sticky bars cover,
      # plus the breathing above the staff.
      offset = page.evaluate_script(
        "parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pt-sticky-offset'))"
      )
      dots_top = page.evaluate_script(
        "document.getElementById('repeat-indicators').getBoundingClientRect().top"
      )

      assert dots_top >= offset - 1,
             "Repeat dots should sit below the sticky bars (dots: #{dots_top}, reserved: #{offset})"
    ensure
      page.current_window.resize_to(*original_size)
    end
  end

  def test_training_mode_autoscroll_works_when_starting_from_non_first_measure
    # This test verifies that auto-scroll works even when jumping to a measure > 0
    # (regression test: currentSystemIndex was null when not starting from measure 0)
    #
    # With a 200x600 window, each measure should be on its own system
    original_size = page.current_window.size

    begin
      # Very narrow window to force each measure on its own system
      page.current_window.resize_to(200, 600)

      load_score('repeat-endings.xml', 4)

      click_on 'Mode Entraînement'
      assert_text 'Mode Entraînement Actif'

      # Jump to measure 2 (index 1) - a non-first measure
      click_measure(2)

      # Capture initial scroll position
      initial_scroll = wait_for_stable_scroll

      # Play the note 3 times
      3.times do
        play_note('D4')
        assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
      end

      # Wait for advancement by checking repeat indicators reset to 0 filled
      assert_selector 'svg circle.repeat-indicator.filled', count: 0

      # Verify scroll changed when advancing to measure 3 (on different system)
      final_scroll = wait_for_stable_scroll
      assert final_scroll > initial_scroll, "Scroll should work when starting from non-first measure (initial: #{initial_scroll}, final: #{final_scroll})"
    ensure
      page.current_window.resize_to(*original_size)
    end
  end

  private

  # Wait for scroll position to stabilize (stop changing)
  # If expect_change is true, first wait for the scroll to change from initial value
  def wait_for_stable_scroll(expect_change_from: nil, max_iterations: 100, interval: 0.01)
    last_scroll = nil
    stable_count = 0
    changed = expect_change_from.nil?

    max_iterations.times do
      current_scroll = page.evaluate_script('window.scrollY')

      # If we expect a change, wait for scroll to differ from initial value
      if !changed && current_scroll != expect_change_from
        changed = true
      end

      if changed && current_scroll == last_scroll
        stable_count += 1
        return current_scroll if stable_count >= 3
      else
        stable_count = 0
        last_scroll = current_scroll
      end
      sleep interval
    end

    last_scroll
  end
end
