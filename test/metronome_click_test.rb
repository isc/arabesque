require_relative 'test_helper'

# Where the strict-mode click comes out is a preference in the ⚙️ menu, so what
# needs a browser is the wiring: the switch is in the menu, what it is set to
# outlives the page, and it is one setting for the app rather than one per page.
# The bytes it sends are pinned without a browser in
# test/js/metronomeClick.test.js.
class MetronomeClickTest < CapybaraTestBase
  SETTING = '🥁 Clic dans le piano'.freeze
  STORAGE_KEY = 'arabesque:metronome-midi'.freeze

  def test_the_switch_is_off_by_default_and_what_it_is_set_to_follows_the_player
    visit '/library.html'
    open_menu
    refute find_field(SETTING).checked?

    check SETTING
    assert_equal 'true', page.evaluate_script("localStorage.getItem('#{STORAGE_KEY}')")

    # Another page, not just another load: the menu is the same everywhere and
    # so is the setting behind it.
    visit '/score.html'
    open_menu
    assert find_field(SETTING).checked?
  end
end
