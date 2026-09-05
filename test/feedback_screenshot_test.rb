require_relative 'test_helper'

# A report from the score page carries a picture of the score behind the modal
# (feedback 1a270bb3). What the test has to pin down is not the pixels but the
# contract around them: it is offered, it is visible before it is sent, it can
# be declined, and its absence never blocks the report.
class FeedbackScreenshotTest < CapybaraTestBase
  SCORE_URL = '/test-fixtures/simple-score.xml'

  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_score_page_attaches_a_visible_picture_of_the_score
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    open_feedback

    assert_selector '.pt-feedback-shot'
    assert_checked_field 'Joindre l’image de la partition affichée'
    # Shown, not merely promised: the preview is the actual capture.
    assert_selector '.pt-feedback-shot__preview'
    assert_match %r{\Adata:image/(webp|jpeg);base64,}, find('.pt-feedback-shot__preview')[:src]
  end

  def test_the_picture_travels_with_the_report_and_can_be_declined
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    stub_feedback_endpoint
    open_feedback

    fill_in 'Message', with: 'Ce do dièse est faux'
    click_on 'Envoyer'
    assert_text 'Merci'
    assert_match %r{\Adata:image/(webp|jpeg);base64,}, sent_feedback['screenshot']
    # Scoped: the dialog header's × carries the same label.
    find('dialog[open] footer button', text: 'Fermer').click

    # Same report, box unticked: the words go, the picture stays.
    open_feedback
    uncheck 'Joindre l’image de la partition affichée'
    refute_selector '.pt-feedback-shot__preview', visible: true
    fill_in 'Message', with: 'Sans image cette fois'
    click_on 'Envoyer'
    assert_text 'Merci'
    assert_nil sent_feedback['screenshot']
  end

  def test_a_page_with_no_score_still_sends_a_report
    visit '/library.html'
    stub_feedback_endpoint
    open_feedback

    refute_selector '.pt-feedback-shot'
    fill_in 'Message', with: 'Une idée depuis la bibliothèque'
    click_on 'Envoyer'
    assert_text 'Merci'
    assert_nil sent_feedback['screenshot']
  end

  private

  def open_feedback
    open_menu
    click_on '💬 Avis'
    assert_selector 'dialog[open]', text: 'Votre avis'
  end

  # Intercept the POST rather than file real feedback: the publishable key in
  # the repo writes to the live table, and a test suite is not a reporter.
  def stub_feedback_endpoint
    page.execute_script(<<~JS)
      window.__sentFeedback = null;
      const real = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).includes('/rest/v1/feedback')) {
          window.__sentFeedback = options.body;
          return Promise.resolve(new Response('', { status: 201 }));
        }
        return real(url, options);
      };
    JS
  end

  def sent_feedback
    body = page.evaluate_script('window.__sentFeedback')
    refute_nil body, 'no feedback POST was made'
    JSON.parse(body)
  end
end
