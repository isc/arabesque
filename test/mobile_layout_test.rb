require_relative 'test_helper'

# Phone-width layout. Every assertion here stands for a bug that shipped: on a
# 390px screen the library table forced the whole page 254px sideways, the score
# page put the ⚙️ button off-screen, the backup file picker did the same to the
# data page, and the engraved title took a third of the width. None of them are
# visible at desktop width, which is why they lasted.
class MobileLayoutTest < CapybaraTestBase
  PHONE = [390, 844].freeze # iPhone 13, the narrow end of what the app meets
  # A catalog score, not an uploaded file: only a score with a URL gets the
  # "Historique" pill, and it is the one that pushed ⚙️ off the right edge.
  SCORE_URL = 'scores/Waltz_in_A_MinorChopin.mxl'.freeze

  def setup
    @original_size = page.current_window.size
    page.driver.set_cookie('test-env', 'true')
  end

  def teardown
    page.current_window.resize_to(*@original_size)
  end

  # A page wider than the viewport is the failure mode this whole breakpoint
  # exists to prevent: it takes the sticky chrome sideways with it, so buttons
  # sit off-screen and every vertical scroll drifts horizontally.
  def test_no_page_is_wider_than_a_phone
    page.current_window.resize_to(*PHONE)

    { '/library.html' => '.pt-journal__day', '/data.html' => '.pt-card', '/practice.html' => '.pt-calendar' }
      .each do |path, ready|
        visit path
        assert_selector ready

        assert_no_horizontal_overflow(path)
      end

    # The score list is the half that used to overflow, and it is behind a tab.
    visit '/library.html'
    find('[role="tab"]', text: 'Partitions').click
    assert_selector 'tbody tr'
    assert_no_horizontal_overflow('/library.html (partitions)')
  end

  def test_score_page_is_not_wider_than_a_phone
    page.current_window.resize_to(*PHONE)
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render

    assert_no_horizontal_overflow('/score.html')
  end

  # The topbar's actions don't shrink, so on a phone they have to wrap onto a
  # row of their own — otherwise the last one (⚙️) is drawn past the edge.
  def test_topbar_actions_stay_on_screen
    page.current_window.resize_to(*PHONE)
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    assert_selector '.pt-topbar__pill', text: 'Historique'

    right = page.evaluate_script(<<~JS)
      document.querySelector('.pt-topbar__actions').getBoundingClientRect().right
    JS
    assert_operator right, :<=, PHONE.first, 'topbar actions are drawn past the right edge'
  end

  # OSMD engraves the title at a size fixed in its own units, so without
  # scaleTitleBlock() it is the same 40px on a phone as on a desktop — a third
  # of the width instead of a tenth.
  def test_engraved_title_shrinks_with_the_viewport
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render
    wide = title_font_size

    page.current_window.resize_to(*PHONE)
    # The relayout is driven by our own resize handler, not OSMD's autoResize.
    assert_selector 'svg text', wait: 5
    narrow = nil
    Timeout.timeout(Capybara.default_max_wait_time) do
      loop do
        narrow = title_font_size
        break if narrow && narrow < wide

        sleep 0.1
      end
    end

    assert_operator narrow, :<, wide,
                    "engraved title stayed at #{wide}px on a #{PHONE.first}px screen"
  end

  # The filters cost a whole phone screen before any content, so they start
  # folded — but a filter that is still narrowing the list has to say so.
  def test_library_filters_fold_away_and_report_what_is_active
    page.current_window.resize_to(*PHONE)
    visit '/library.html'
    # The filter chrome lives with the list it narrows, so it is on that tab.
    find('[role="tab"]', text: 'Partitions').click
    assert_selector 'tbody tr'

    assert_no_selector '.pt-filters', visible: true

    find('.pt-librarybar button.pt-filter-pill').click
    assert_selector '.pt-filters', visible: true

    # A composer, not a status pill: the catalog always has several composers,
    # where a status only exists once something has been practised.
    select 'Chopin', from: 'Filtrer par compositeur'
    find('.pt-librarybar button.pt-filter-pill').click

    assert_no_selector '.pt-filters', visible: true
    assert_selector '.pt-librarybar .pt-filter-pill__count', text: '1'
  end

  # Filters above the journal above the filtered list read as one page acting on
  # itself. Two panes, one at a time, put the filter chrome back next to the
  # list it narrows — and cut the journal's 14 cards out of the way of the
  # scores, which sat ~2000px down.
  def test_library_shows_one_pane_at_a_time_on_a_phone
    page.current_window.resize_to(*PHONE)
    visit '/library.html'
    assert_selector 'tbody tr', visible: :all

    assert_selector '.pt-library__sidebar', text: 'aujourd', wait: 5
    assert_no_selector '.pt-library__main'
    assert_no_selector '.pt-librarybar', visible: true

    find('[role="tab"]', text: 'Partitions').click
    assert_no_selector '.pt-library__sidebar'
    assert_selector '.pt-library__main'
    assert_selector '.pt-librarybar'
  end

  # Two ways to say "I want the list": a link that carries a filter, and the
  # search box, which sits above both panes and is the one narrowing control
  # reachable while the journal is showing.
  def test_narrowing_the_list_opens_the_scores
    page.current_window.resize_to(*PHONE)

    visit '/library.html?composer=Chopin'
    assert_selector '.pt-library__main'
    assert_no_selector '.pt-library__sidebar'

    visit '/library.html'
    assert_selector '.pt-library__sidebar'
    fill_in 'Rechercher une partition', with: 'chopin'
    assert_selector '.pt-library__main'
    assert_no_selector '.pt-library__sidebar'
  end

  # The whole point of keying the panes off data-tab in CSS rather than x-show:
  # an inline display:none would apply at every width and cost the wide layout
  # its second column.
  def test_a_wide_screen_keeps_both_panes_and_no_tabs
    page.current_window.resize_to(1280, 900)
    visit '/library.html'
    assert_selector 'tbody tr'

    assert_selector '.pt-library__sidebar', visible: true
    assert_selector '.pt-library__main', visible: true
    assert_selector '.pt-filters', visible: true
    assert_no_selector '.pt-librarytabs', visible: true
  end

  # A score title and a journal line sit one above the other on a phone; 8px of
  # drift between their left edges reads as a misalignment.
  def test_score_titles_line_up_with_the_journal
    page.current_window.resize_to(*PHONE)
    visit '/library.html'
    assert_selector 'tbody tr', visible: :all

    journal = left_edge_of('.pt-journal__day-header h3')
    find('[role="tab"]', text: 'Partitions').click
    title = left_edge_of('tbody tr td:first-child a')

    assert_in_delta journal, title, 1,
                    "score titles start at #{title}px, journal lines at #{journal}px"
  end

  private

  def left_edge_of(selector)
    page.evaluate_script("document.querySelector('#{selector}').getBoundingClientRect().left")
  end

  def assert_no_horizontal_overflow(path)
    overflow = page.evaluate_script(<<~JS)
      document.scrollingElement.scrollWidth - document.documentElement.clientWidth
    JS
    assert_operator overflow, :<=, 0, "#{path} scrolls #{overflow}px sideways at #{PHONE.first}px"
  end

  # The title is the largest text OSMD draws, and it is drawn before the staves.
  def title_font_size
    page.evaluate_script(<<~JS)
      (() => {
        const sizes = [...document.querySelectorAll('#score svg text')]
          .map((t) => parseFloat(t.getAttribute('font-size')))
          .filter((n) => !Number.isNaN(n))
        return sizes.length ? Math.max(...sizes) : null
      })()
    JS
  end
end
