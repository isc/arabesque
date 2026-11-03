require_relative 'test_helper'

# A page whose module graph fails has no menu to report it from, and in the iOS
# app no reload button (public/js/version.js, feedback 88e8152f). What needs a
# browser is that a real failed graph leaves the page in the state the check
# reads, at the moment it reads it.
class BootFailureTest < CapybaraTestBase
  def navigation_type
    page.evaluate_script("performance.getEntriesByType('navigation')[0].type")
  end

  def test_a_page_whose_scripts_never_ran_reloads_once_then_offers_a_way_out
    # library.js is in the library's graph and out of feedback.js's.
    CapybaraTestBase.block_cdn(page, '*/js/library.js')
    visit '/library.html'

    assert_selector '[data-testid="boot-failure"]', text: 'Cette page n’a pas pu se charger.'
    assert_equal 'reload', navigation_type, 'the check should have reloaded once, then stopped'
    assert_includes recorded_error_messages, 'Error: /library.html did not start'

    capture_submissions
    click_button 'Envoyer un rapport'
    assert_selector '[data-testid="boot-failure"] [role="status"]', text: 'Rapport envoyé'

    report = sent_reports.first
    assert_equal 'bug', report['category']
    assert_includes report['message'], '/library.html'
    assert_includes report['context']['errors'].map { |error| error['where'] }, 'Boot failure'

    CapybaraTestBase.block_cdn(page)
    click_button 'Recharger'
    assert_no_selector '[data-testid="boot-failure"]'
    assert_selector 'h1', text: 'Bibliothèque'
    assert_selector '.pt-library__table'
  end

  def test_a_page_that_started_shows_nothing_of_the_kind
    visit '/library.html'
    assert_selector '.pt-library__table'
    assert_no_selector '[data-testid="boot-failure"]'
    assert_equal 'navigate', navigation_type
    refute_includes recorded_error_messages, 'Error: /library.html did not start'
  end
end
