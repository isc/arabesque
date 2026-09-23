require_relative 'test_helper'

# The on-screen keyboard is a beginner's crutch: never there from the start,
# brought up when a note is clearly not being found — several wrong keys for
# it, or a long wait over it — with that note lit.
#
# two-measures.xml is one whole note per bar, C4 then D4, right hand.
class KeyboardHintTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_wrong_keys_for_a_note_bring_the_keyboard_up_with_that_note_lit
    open_two_measures

    play_note('E4')
    play_note('F4')
    assert_no_selector '.pt-keyhint'

    play_note('G4')
    assert_selector '.pt-keyhint__chip', text: 'do4'
    assert_selector '.pt-keyhint__hand', text: 'main droite'
    assert_selector '.pt-keyhint__key.is-owed[data-midi="60"]', text: 'do'
    assert_selector '.pt-keyhint__key.is-owed', count: 1

    # Found: the keyboard moves on to the next note.
    play_note('C4')
    assert_selector '.pt-keyhint__key.is-owed[data-midi="62"]', text: 'ré'
    assert_selector '.pt-keyhint__chip', text: 'ré4'
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
      assert_no_selector '.pt-keyhint'

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
end
