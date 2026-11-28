require_relative 'test_helper'

# Branch previews, opened from the settings menu (previews.js): how the iPad, whose
# Safari has no Web MIDI, gets to play one inside the app. The test server
# serves the previews test/fixtures/previews-index.json lists, each one this
# same build under previews/<slug>/, as GitHub Pages does (app.rb).
class PreviewsTest < CapybaraTestBase
  # A player off the App Store never sees them: the list waits for five taps on
  # the support page's version line.
  def test_the_menu_lists_the_open_previews_once_the_version_line_is_tapped_five_times
    visit '/library.html'
    open_menu
    assert_no_selector '.pt-popover h4', text: 'Préversions'

    show_previews
    visit '/library.html'
    open_menu
    assert_selector '.pt-preview-item', count: 2
    # Number and title are two items of the row's flex: a line apart to Capybara.
    assert_selector '.pt-preview-item', text: /#561\s+Let the player open a preview in the app/
    assert_no_button 'Version publiée'

    visit '/support.html'
    tap_version_line
    assert_selector '.pt-version-line', text: 'préversions masquées'
    visit '/library.html'
    open_menu
    assert_no_selector '.pt-popover h4', text: 'Préversions'
  end

  # The piece on the stand goes along, there and back: the point is to try the
  # change on it.
  def test_a_preview_opens_on_the_same_piece_and_the_strip_comes_back_to_it
    show_previews
    open_two_measures
    open_menu
    find('.pt-preview-item', text: '#561').click

    assert_current_path '/previews/open-in-the-app/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
    assert_selector '.pt-preview-strip', text: '#561 Let the player open a preview in the app'

    # The other previews are a tap away, and so is production.
    open_menu
    assert_selector '.pt-preview-item[aria-current="true"]', text: '#561'
    assert_button 'Version publiée'
    find('.pt-changelog-btn').click

    within('.pt-preview-strip') { click_on 'Revenir à la version publiée' }
    assert_current_path '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
    assert_no_selector '.pt-preview-strip'
  end

  # Merged under a player trying it in the app, where there is no address bar
  # to leave by: the next page they open lands in production.
  def test_a_page_of_a_preview_gone_with_its_pull_request_lands_in_production
    visit '/previews/merged-since/score.html?url=/test-fixtures/two-measures.xml'

    assert_current_path '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
  end

  private

  def show_previews
    visit '/support.html'
    tap_version_line
    assert_selector '.pt-version-line', text: 'préversions affichées dans le menu'
  end

  def tap_version_line
    line = find('.pt-version-line', text: 'Version dev')
    5.times { line.click }
  end
end
