require_relative 'test_helper'

# A report carries the JavaScript errors the app ran into shortly before it
# (public/js/errorLog.js), so a bug arrives with its cause. The rules of the
# buffer are pinned in test/js/errorLog.test.js; what needs a browser is that
# the real events reach it, that it outlives the page they happened on, and that
# the report sent from another page picks it up.
class FeedbackErrorsTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_errors_from_the_page_before_travel_with_a_report_sent_from_the_library
    visit '/practice.html'
    # Through a script element, so they are the page's own: an error thrown
    # from the driver's evaluation would be reported on no script at all.
    page.execute_script(<<~JS)
      const script = document.createElement('script')
      script.textContent = "Promise.reject(new RangeError('lost promise')); throw new TypeError('boom')"
      document.head.append(script)
    JS
    # The rejection is reported from a task of its own, after the throw.
    Timeout.timeout(Capybara.default_max_wait_time) do
      sleep 0.02 until recorded_messages.include?('RangeError: lost promise')
    end

    visit '/library.html'
    capture_submissions
    open_feedback
    send_feedback 'Ça a planté sur le calendrier.'

    errors = sent_reports.first['context']['errors'].to_h { |error| [error['message'], error] }
    thrown = errors.fetch('TypeError: boom')
    assert_equal 'uncaught', thrown['where']
    assert_equal '/practice.html', thrown['page']
    assert_equal 1, thrown['count']
    refute_empty thrown['stack']
    assert_equal 'unhandled rejection', errors.fetch('RangeError: lost promise')['where']
  end

  private

  def recorded_messages
    page.evaluate_script(<<~JS)
      JSON.parse(sessionStorage.getItem('arabesque:recent-errors') ?? '[]').map((error) => error.message)
    JS
  end
end
