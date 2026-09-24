require_relative 'test_helper'

# The on-screen keyboard is a beginner's crutch: never there from the start,
# brought up when a note is clearly not being found — several wrong keys for
# it, or a long wait over it — with that note lit.
#
# two-measures.xml is one whole note per bar, C4 then D4, right hand.
class KeyboardHintTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    # The strip fades in, and under a parked clock that fade can sit at its
    # first frame — opacity 0, which Capybara takes for not visible. Reduced
    # motion drops it: the strip is there the moment x-show reveals it.
    emulate_media([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  end

  def teardown
    emulate_media([])
    super
  end

  def test_wrong_keys_for_a_note_bring_the_keyboard_up_with_that_note_lit
    open_two_measures
    # Clock held, so that the three keys alone bring it up, not the wait.
    with_clock_control do
      play_note('E4')
      play_note('F4')
      advance_clock(100)
      assert_keyboard_down

      play_note('G4')
      # Alpine reveals from a timer of its own.
      advance_clock(100)
      assert_selector '.pt-keyhint__chip', text: 'do4'
      assert_selector '.pt-keyhint__hand', text: 'MD'
      assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]', text: 'do'
      assert_selector '.pt-keyhint__key.is-owed', count: 1

      # Found: the keyboard moves on to the next note.
      play_note('C4')
      assert_selector '.pt-keyhint__key.is-owed[data-midi="62"]', text: 'ré'
      assert_selector '.pt-keyhint__chip', text: 'ré4'
    end
  end

  # A lit white key must not climb over the black keys that sit across it.
  def test_the_black_keys_stay_on_top_of_a_lit_white_key
    open_two_measures
    3.times { play_note('G4') }
    assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]'

    on_top = page.evaluate_script(<<~JS)
      (() => {
        const black = document.querySelector('.pt-keyhint__key[data-midi="61"]').getBoundingClientRect()
        return document.elementFromPoint(black.left + 2, black.top + black.height / 2)?.closest('.pt-keyhint__key')?.dataset.midi
      })()
    JS
    assert_equal '61', on_top
  end

  # Training replays the measure a beat after its last note: the keyboard
  # follows the cursor back to the note owed again, with no key pressed.
  def test_it_follows_the_cursor_through_a_training_repetition
    open_two_measures
    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'
    3.times { play_note('G4') }
    assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]'

    play_note('C4')
    assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]'
    assert_selector 'svg circle.repeat-indicator.filled', count: 0
    play_note('C4')
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
    assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]'
  end

  def test_a_long_wait_over_a_note_brings_the_keyboard_up
    open_two_measures
    with_clock_control do
      play_note('C4')
      advance_clock(5000)
      assert_keyboard_down

      advance_clock(4000)
      assert_selector '.pt-keyhint__key.is-owed[data-midi="62"]'
    end
  end

  def test_the_cross_puts_it_away_for_the_visit
    open_two_measures
    3.times { play_note('G4') }
    assert_selector '.pt-keyhint'

    find('.pt-keyhint__close').click
    assert_no_selector '.pt-keyhint'

    3.times { play_note('G4') }
    play_note('C4')
    3.times { play_note('G4') }
    assert_no_selector '.pt-keyhint'
  end

  # Feedback b7682019: the last note played, the cursor goes back to the top
  # under the results, and a wait over that first note is not hesitation. The
  # keyboard goes down with the piece and stays down, through the results and
  # after them, until the next run gives it a reason.
  def test_it_goes_down_with_a_finished_piece_and_stays_down
    open_two_measures
    3.times { play_note('G4') }
    assert_selector '.pt-keyhint'

    play_note('C4')
    play_note('D4')
    assert_text 'Partition terminée'
    assert_back_at_the_top

    with_clock_control do
      assert_stays_down_through_the_results

      3.times { play_note('G4') }
      advance_clock(100)
      assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]'
    end
  end

  # A picked passage done opens its results from inside its last note, before
  # the keyboard has had that key: it must not count it as the next go begun.
  def test_it_does_not_come_up_over_a_finished_passage
    open_two_measures
    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'
    click_on '🔁 Boucle'
    click_measure(1)
    assert_text 'cliquez sur la dernière mesure du passage'
    click_measure(2)
    assert_text 'Mesures 1 à 2'
    3.times do
      play_note('C4')
      assert_selector 'svg rect.measure-click-area.selected[data-measure-index="1"]'
      play_note('D4')
      assert_back_at_the_top
    end
    assert_text 'Entraînement terminé'

    with_clock_control { assert_stays_down_through_the_results }
  end

  # Started from a bar further on, a run reaches the end with no results to
  # show, but it is over all the same.
  def test_it_does_not_come_up_after_a_run_ended_without_results
    open_two_measures
    click_measure(2)
    play_note('D4')
    assert_no_text 'Partition terminée'
    assert_back_at_the_top

    with_clock_control do
      advance_clock(20_000)
      assert_keyboard_down
    end
  end

  # Strict mode asks for notes on the metronome's time, not the player's: the
  # keyboard has no place there, and keys tried while it is selected do not
  # count toward the next mode either.
  def test_strict_mode_never_brings_it_up
    open_two_measures
    click_on '⏱ Mode strict'
    3.times { play_note('G4') }
    assert_no_selector '.pt-keyhint'

    click_on 'Libre'
    play_note('G4')
    assert_no_selector '.pt-keyhint'
  end

  private

  def open_two_measures
    visit '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
  end

  # The beat after the last note, which takes the cursor back to the top.
  # Waited for before the clock is parked: parked ahead of it, a 20 s advance
  # was seen not to reach the wait the keyboard counts from there.
  def assert_back_at_the_top
    assert_no_selector 'svg g.vf-notehead.played-note'
  end

  def emulate_media(features)
    page.driver.browser.page.command('Emulation.setEmulatedMedia', features: features)
  end

  # Down the way x-show puts it, rather than merely not visible: a strip
  # caught mid-fade would pass assert_no_selector.
  def assert_keyboard_down
    assert_selector '.pt-keyhint[style*="display: none"]', visible: :all
  end

  # However long the results are read, and after they are closed. Inside
  # with_clock_control.
  def assert_stays_down_through_the_results
    advance_clock(20_000)
    assert_keyboard_down
    within('dialog.pt-result-dialog') { trigger_click_on 'Fermer' }
    advance_clock(20_000)
    assert_keyboard_down
  end
end
