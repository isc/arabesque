require_relative 'test_helper'

class ScoreLoadingTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_score_that_cannot_be_fetched_says_so_instead_of_spinning
    # A score that never arrives used to leave the page loading for good.
    visit '/score.html?url=scores/does-not-exist.mxl'

    assert_selector '.pt-onboarding', text: 'Impossible de charger la partition'
    assert_selector 'button', text: 'Réessayer'
    assert_no_selector '[aria-busy="true"]'
  end

  def test_score_that_cannot_be_fetched_says_so_without_waiting_on_the_database
    # Nothing about a score that never arrives depends on IndexedDB, so an open
    # that never answers must not hold the page on its spinner — which is what
    # start-up opening the database in front of the load did, and how the test
    # above failed intermittently under load.
    stall_indexeddb
    visit '/score.html?url=scores/does-not-exist.mxl'

    assert_selector '.pt-onboarding', text: 'Impossible de charger la partition'
    assert_no_selector '[aria-busy="true"]'
  end
end
