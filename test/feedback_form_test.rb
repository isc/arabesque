require_relative 'test_helper'
require 'json'

# The feedback form's e-mail field, which now opens on an address instead of
# blank — six of one evening's eight reports came in with none, from someone who
# has one. What needs a browser is the wiring: the field is filled when the ⚙️
# menu opens it, still editable, and what leaves is what the player left in it.
# The precedence rules themselves are pinned in test/js/feedbackEmail.test.js.
class FeedbackFormTest < CapybaraTestBase
  EMAIL_FIELD = 'E-mail (facultatif)'.freeze
  AUTH_KEY = 'sb-mtihhulokbhhvkomlmmk-auth-token'.freeze

  # Signed in for sync, as far as a page can tell without loading
  # @supabase/supabase-js: the session the client persists, minus the fields
  # only a real refresh needs. Nothing loads that client here — test_helper.rb
  # blocks the CDN it comes from, and says why this session would not survive
  # it.
  SIGN_IN = <<~JS.freeze
    localStorage.setItem(#{AUTH_KEY.inspect}, JSON.stringify({
      access_token: 'x', user: { email: 'player@example.com' },
    }))
  JS

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
    capture_submissions
  end

  def test_the_field_opens_on_the_address_given_for_sync_and_a_cleared_one_stays_cleared
    page.execute_script(SIGN_IN)

    open_feedback
    assert_equal 'player@example.com', find_field(EMAIL_FIELD).value

    # Sending anonymously has to stay possible — and stay chosen. Cleared from
    # the keyboard, the way a player does it: setting the value from the driver
    # leaves x-model none the wiser.
    find_field(EMAIL_FIELD).send_keys([:control, 'a'], :backspace)
    send_feedback 'Sans adresse.'
    assert_equal [nil], sent_emails

    open_feedback
    assert_equal '', find_field(EMAIL_FIELD).value
  end

  def test_an_address_typed_into_the_form_comes_back_on_the_next_report
    open_feedback
    assert_equal '', find_field(EMAIL_FIELD).value

    fill_in EMAIL_FIELD, with: 'typed@example.com'
    send_feedback 'Une idée.'
    assert_equal ['typed@example.com'], sent_emails

    open_feedback
    assert_equal 'typed@example.com', find_field(EMAIL_FIELD).value
  end

  private

  def sent_emails
    sent_reports.map { |row| row['email'] }
  end
end
