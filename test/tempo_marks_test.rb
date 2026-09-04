require_relative 'test_helper'

# A MuseScore export writes the tempo curve made for playback onto the page as
# bare numbers, alongside the markings a pianist actually reads. They are
# dropped before the score is engraved, and the tempo they carried stays in the
# sheet — see public/js/tempoMarks.js.
class TempoMarksTest < CapybaraTestBase
  def test_bare_tempo_numbers_leave_the_page_but_their_tempo_stays
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
    load_score('playback-tempo-marks.xml', 3)

    assert_selector '#score svg text', text: 'Andantino con moto'
    assert_selector '#score svg text', text: 'rit.'
    refute_selector '#score svg text', text: '137'

    assert_equal [120, 137, 108], page.evaluate_script(<<~JS)
      window.osmdInstance.Sheet.SourceMeasures.map((measure) => measure.TempoInBPM)
    JS
  end
end
