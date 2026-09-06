require_relative 'test_helper'

# A report carries a picture of the screen behind the modal (feedback 1a270bb3).
# What the test pins down is not the pixels but the contract around them: it is
# offered on every page the feedback button reaches, it is visible before it is
# sent, it can be declined, and it is a picture of the viewport rather than of
# one widget in it.
class FeedbackScreenshotTest < CapybaraTestBase
  SCORE_URL = '/test-fixtures/simple-score.xml'.freeze
  SHOT_LABEL = 'Joindre l’image de l’écran'.freeze
  DATA_URL = %r{\Adata:image/(webp|jpeg);base64,}

  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_the_score_page_attaches_a_visible_picture_of_the_screen
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    open_feedback_with_shot

    assert_checked_field SHOT_LABEL
    # Shown, not merely promised: the preview is the actual capture.
    assert_match DATA_URL, find('.pt-feedback-shot__preview')[:src]
    # And it is the whole screen: a picture of the score alone would not have
    # the window's shape.
    assert_in_delta viewport_aspect, capture_aspect, 0.02
  end

  def test_the_picture_travels_with_the_report_and_can_be_declined
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    capture_submissions

    open_feedback_with_shot
    send_feedback 'Ce do dièse est faux'

    # Same report, box unticked: the words go, the picture stays.
    open_feedback_with_shot
    uncheck SHOT_LABEL
    refute_selector '.pt-feedback-shot__preview', visible: true
    send_feedback 'Sans image cette fois'

    with, without = sent_reports
    assert_match DATA_URL, with['screenshot']
    assert_nil without['screenshot']
  end

  # The page the request itself was filed from, and the one a score-only capture
  # could say nothing about.
  def test_the_library_page_attaches_one_too
    visit '/library.html'
    capture_submissions

    open_feedback_with_shot
    send_feedback 'Une idée depuis la bibliothèque'
    assert_match DATA_URL, sent_reports.first['screenshot']
  end

  private

  def open_feedback_with_shot
    open_feedback
    assert_selector '.pt-feedback-shot__preview'
  end

  def viewport_aspect
    page.evaluate_script('document.documentElement.clientWidth / document.documentElement.clientHeight')
  end

  # Polled rather than read once: the preview element is in the DOM as soon as
  # the capture resolves, but its intrinsic size only exists once decoded.
  def capture_aspect
    Timeout.timeout(Capybara.default_max_wait_time) do
      loop do
        ratio = page.evaluate_script(<<~JS)
          (() => {
            const img = document.querySelector('.pt-feedback-shot__preview')
            return img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0
          })()
        JS
        return ratio if ratio.positive?

        sleep 0.05
      end
    end
  end
end
