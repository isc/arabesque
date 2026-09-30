require_relative 'test_helper'

class ScoreLoadingTest < CapybaraTestBase
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

  # A page left while it was still creating the database went into the
  # back/forward cache with the creation half done, and the score opened next
  # waited behind it for good (DataTest leaves data.html that way, and failed
  # one CI run in thirty). The creation is held open here, so the page is
  # always left mid-way.
  def test_a_page_left_while_creating_the_database_does_not_hold_up_the_next
    page.driver.browser.page.command('Page.addScriptToEvaluateOnNewDocument', source: <<~JS)
      if (location.pathname === '/data.html') {
        const open = IDBFactory.prototype.open
        IDBFactory.prototype.open = function (...args) {
          const request = open.apply(this, args)
          request.addEventListener('upgradeneeded', () => {
            const store = request.result.createObjectStore('held-open')
            const hold = () => { store.get(0).onsuccess = hold }
            hold()
            window.__upgrading = true
          })
          return request
        }
      }
    JS
    visit '/data.html'
    wait_until('data.html to start creating the database') { page.evaluate_script('window.__upgrading') }

    open_two_measures
  end

  # A sheet OSMD cannot read is reported with OSMD's own error. It used to be
  # swallowed, and the page carried on without a score until reading its tempo
  # threw: that TypeError was what raised the error card, and all a feedback
  # report carried.
  def test_a_score_that_cannot_be_read_is_reported_with_its_own_error
    visit '/score.html?url=/test-fixtures/not-a-score.xml'

    assert_selector '.pt-onboarding', text: 'Impossible de charger la partition'
    assert_no_selector '[aria-busy="true"]'
    assert recorded_error_messages.any?, 'the error is kept for a feedback report'
    assert_empty recorded_error_messages.grep(/TypeError/)
  end

  # A file that is not a score is refused with a word, and the page stays as
  # it was. It used to go on laying out a score that never came, and threw.
  def test_a_file_that_is_not_a_score_is_refused_and_nothing_else
    visit '/score.html'
    message = accept_alert { attach_score('not-a-score.xml') }
    assert_equal 'Ce fichier ne semble pas être un fichier MusicXML valide', message

    # A score afterwards: whatever the refused file set off has run by then.
    load_score('two-measures.xml', 2)
    assert_empty recorded_error_messages
  end
end
