require_relative 'test_helper'

# Where the sound comes out is a preference in the ⚙️ menu, so what needs a
# browser is the wiring: the switch is in the menu, off by default, and what it
# is set to outlives the page and follows to the score. What the setting
# actually reroutes is pinned without a browser in test/js/appSound.test.js —
# the sampler it hands the notes to is a CDN download the suite skips.
class AppSoundTest < CapybaraTestBase
  SETTING = '🎧 Jouer le son dans l’app'.freeze
  STORAGE_KEY = 'arabesque:app-sound'.freeze

  def test_the_switch_is_off_by_default_and_what_it_is_set_to_follows_the_player
    visit '/library.html'
    open_menu
    refute find_field(SETTING).checked?

    # Turning it on costs the player their instrument's own sound, so the menu
    # has to name the setting they need to change for it not to double.
    assert_text 'Local Control'

    check SETTING
    assert_equal 'true', page.evaluate_script("localStorage.getItem('#{STORAGE_KEY}')")

    visit '/score.html'
    open_menu
    assert find_field(SETTING).checked?
  end
end
