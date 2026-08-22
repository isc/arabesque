require_relative 'test_helper'

class LibraryTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
  end

  def test_library_page_loads_scores
    assert_text 'Bibliothèque'
    assert_selector 'table'
    assert_selector 'tbody tr', minimum: 50
  end

  def test_search_filters_scores_by_title
    fill_in 'Rechercher une partition', with: 'Moonlight'

    assert_selector 'tr td', text: 'Moonlight Sonata'
    assert_selector 'tbody tr', count: 2
  end

  def test_search_filters_scores_by_composer
    fill_in 'Rechercher une partition', with: 'Chopin'

    assert_selector 'tbody tr', count: 9
    assert_selector 'tr td', text: 'Chopin'
  end

  def test_clicking_score_navigates_to_score_page
    page.driver.set_cookie('test-env', 'true')
    fill_in 'Rechercher une partition', with: 'Carol of the Bells'
    click_link 'Carol of the Bells', match: :first

    assert_current_path %r{/score\.html\?url=}
    assert_text 'Bibliothèque' # Back link
    assert_selector 'svg g.vf-stavenote', minimum: 1

    # History button should be visible for URL-loaded scores
    click_on 'Historique'
    assert_selector 'dialog[open]'
    assert_text 'Historique de pratique'
    find('button[aria-label="Close"]').click

    # Play the first measure (C B C A) to create a session
    play_notes(%w[C5 B4 C5 A4])
    assert_selector 'svg g.vf-notehead.played-note', minimum: 4

    # Go back to library and verify the score is now first (most recently played)
    click_on 'Bibliothèque'
    assert_equal 'Carol of the Bells (Easy)', first('td a').text
  end

  def test_open_score_by_playing_its_beginning
    assert_selector 'tbody tr', minimum: 1  # wait for init() to complete (fingerprints loaded)

    # Symphony No. 5 fingerprint: [67, 67, 67, 63, 65, ...] = G4 G4 G4 Eb4 F4
    # Happy Birthday also starts G4 G4 but diverges at note 3 (expects F#4/A4, not G4)
    # → Symphony No. 5 is the unique leader after 5 matched notes (MIN_MATCH)
    play_notes(%w[G4 G4 G4 Eb4 F4])

    assert_current_path %r{/score\.html\?url=.*Beethoven_Symphony_No\._5}
  end

  def test_open_score_by_playing_both_hands
    assert_selector 'tbody tr', minimum: 1

    # Same Symphony No. 5 melody with interspersed left-hand notes (C2 = MIDI 36)
    # Subsequence matching advances the pointer only on melody notes, ignoring the rest
    play_notes(%w[C2 G4 G4 C2 G4 Eb4 C2 F4 F4])

    assert_current_path %r{/score\.html\?url=.*Beethoven_Symphony_No\._5}
  end

  def test_charger_une_partition_link
    open_menu
    click_on 'Charger une partition'

    assert_current_path '/score.html'
  end

  def test_slash_shortcut_focuses_search_input
    assert_selector 'tbody tr', minimum: 1  # wait for init() to finish
    refute page.evaluate_script("document.activeElement === document.querySelector('input[type=search]')")

    page.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))")

    assert page.evaluate_script("document.activeElement === document.querySelector('input[type=search]')"),
           'Pressing "/" outside an input should focus the search field'
  end

  def test_slash_inside_input_is_not_hijacked
    assert_selector 'tbody tr', minimum: 1
    fill_in 'Rechercher une partition', with: 'Cho'
    find_field('Rechercher une partition').send_keys('/')

    assert_equal 'Cho/', find_field('Rechercher une partition').value
  end

  def test_back_link_from_score_to_library
    visit '/score.html'
    click_on 'Bibliothèque'

    assert_current_path '/library.html'
    assert_text 'Bibliothèque'
    assert_selector 'table'
  end

  def test_search_filters_scores_by_multiple_words_in_any_order
    # Test "Bach INV"
    fill_in 'Rechercher une partition', with: 'Bach INV'
    assert_selector 'tbody tr', count: 3
    assert_selector 'tr td', text: 'Invention'
    assert_selector 'tr td', text: 'J.S. Bach'

    # Test "INV Bach" - word order doesn't matter
    fill_in 'Rechercher une partition', with: 'INV Bach'
    assert_selector 'tbody tr', count: 3
  end

  private

  # The changelog, feedback, data-page link and language controls now live
  # behind the ⚙️ header menu; open it before interacting with those items.
  # (Backup import/export moved to the data page — see data_test.rb.)
  def open_menu
    find('button[aria-label="Menu"]').click
  end
end
