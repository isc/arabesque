require_relative 'test_helper'

class EngravingTest < CapybaraTestBase
  # OSMD left a Fine out of the first system's skyline, and set the composer on
  # top of it: "Traditionnel" over "Fine" on an iPad held sideways, where the
  # first system of "Sur le pont d'Avignon" closes on its Fine
  # (reserveRepetitionWords in public/js/musicxml.js).
  def test_the_composer_clears_a_fine_closing_the_first_system
    page.current_window.resize_to(*IPAD)
    visit '/score.html?url=scores/Chansons_08_sur-le-pont-d-avignon.musicxml'
    wait_for_score_render

    composer, fine = page.evaluate_script(<<~JS)
      [document.querySelector('#score .osmd-composer'),
       [...document.querySelectorAll('#score svg text')].find((text) => text.textContent === 'Fine')]
        .map((element) => element.getBoundingClientRect().toJSON())
    JS

    assert fine['left'] < composer['right'] && fine['right'] > composer['left'],
           "the Fine (#{fine['left']}–#{fine['right']}px) is no longer under the composer " \
           "(#{composer['left']}–#{composer['right']}px): this width no longer tests anything"
    assert_operator composer['bottom'], :<=, fine['top'], 'the composer runs into the Fine'
  end
end
