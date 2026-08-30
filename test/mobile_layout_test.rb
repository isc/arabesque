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

    { '/library.html' => 'tbody tr', '/data.html' => '.pt-card', '/practice.html' => '.pt-calendar' }
      .each do |path, ready|
        visit path
        assert_selector ready

        assert_no_horizontal_overflow(path)
      end
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
    assert_selector 'tbody tr'

    refute filters_visible?, 'filters should start folded on a phone'

    find('.pt-librarybar button.pt-filter-pill').click
    assert filters_visible?, 'clicking Filtrer should unfold the filters'

    # A composer, not a status pill: the catalog always has several composers,
    # where a status only exists once something has been practised.
    select 'Chopin', from: 'Filtrer par compositeur'
    find('.pt-librarybar button.pt-filter-pill').click

    refute filters_visible?
    assert_selector '.pt-librarybar .pt-filter-pill__count', text: '1'
  end

  private

  def assert_no_horizontal_overflow(path)
    overflow = page.evaluate_script(<<~JS)
      document.scrollingElement.scrollWidth - document.documentElement.clientWidth
    JS
    assert_operator overflow, :<=, 0, "#{path} scrolls #{overflow}px sideways at #{PHONE.first}px"
  end

  def filters_visible?
    page.evaluate_script("getComputedStyle(document.querySelector('.pt-filters')).display") != 'none'
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
