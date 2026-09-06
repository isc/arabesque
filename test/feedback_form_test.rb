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

  # Nothing here may reach the real feedback table, so that one POST is answered
  # locally and its body kept for the assertions. Every other request the page
  # makes goes through untouched.
  CAPTURE_SUBMISSIONS = <<~JS.freeze
    window.__sent = []
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = String(input?.url ?? input)
      if (!url.includes('/rest/v1/feedback')) return realFetch(input, init)
      window.__sent.push(JSON.parse(init.body))
      return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') })
    }
  JS

  # Signed in for sync, as far as a page can tell without loading
  # @supabase/supabase-js: the session the client persists. Written after load,
  # so it reaches the form and not the sync triggers, which already ran.
  SIGN_IN = <<~JS.freeze
    localStorage.setItem(#{AUTH_KEY.inspect}, JSON.stringify({
      access_token: 'x', user: { email: 'player@example.com' },
    }))
  JS

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
    page.execute_script(CAPTURE_SUBMISSIONS)
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

  def open_feedback
    open_menu
    click_on '💬 Avis'
    assert_selector 'textarea'
  end

  def send_feedback(message)
    fill_in 'Message', with: message
    click_button 'Envoyer'
    assert_text 'Merci'
    # The footer button, not the header's ✕ — both are labelled "Fermer".
    find('dialog footer button', text: 'Fermer').click
  end

  # Through JSON: a bare null coming back from the driver is indistinguishable
  # from an entry that was never there, and "no address" is what one case is
  # about.
  def sent_emails
    JSON.parse(page.evaluate_script('JSON.stringify(window.__sent.map((row) => row.email))'))
  end
end
