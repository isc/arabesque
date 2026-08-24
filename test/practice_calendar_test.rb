require_relative 'test_helper'

# The year-at-a-glance grid on practice.html: one square per day, coloured by
# how long that day was practised.
class PracticeCalendarTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    # Opening the page once is what creates the IndexedDB stores; seeding
    # before that would create an empty database the app can never upgrade.
    visit '/practice.html'
    seed_store('sessions', calendar_sessions)
    seed_store('aggregates', calendar_aggregates)
    visit '/practice.html'
  end

  def test_calendar_renders_a_full_year_of_days
    assert_text 'Assiduité'
    # 53 columns of 7, whatever the year: the grid starts on the Monday on or
    # before 1 January and runs to 31 December.
    assert_selector '.pt-calendar__week', minimum: 52
    assert_selector '.pt-calendar__day[data-level]', minimum: 364
  end

  def test_stats_summarise_the_year
    # Three separate days, 5 + 20 + 45 minutes, none of them consecutive.
    assert_selector '.pt-stat dd', count: 5
    assert_equal ['3', '1h 10m', '3', '0 jours', '1 jour'], all('.pt-stat dd').map(&:text)
  end

  def test_darker_squares_mark_longer_days
    within('.pt-calendar__cells') do
      assert_selector ".pt-calendar__day[data-level='1']", count: 1 # 5 min
      assert_selector ".pt-calendar__day[data-level='2']", count: 1 # 20 min
      assert_selector ".pt-calendar__day[data-level='3']", count: 1 # 45 min
      assert_no_selector ".pt-calendar__day[data-level='4']"
    end
  end

  def test_clicking_a_day_lists_what_was_played
    longest_day = ".pt-calendar__cells .pt-calendar__day[data-level='3']"
    find(longest_day).click

    assert_text 'Nocturne op. 9 no 2 · Chopin'
    assert_text '45m 0s'

    # Clicking the same square again closes the panel.
    find(longest_day).click
    assert_no_text 'Nocturne op. 9 no 2 · Chopin'
  end

  def test_journal_sidebar_links_to_the_calendar
    visit '/library.html'
    click_link 'Voir l’année →'

    assert_current_path '/practice.html'
    assert_text 'Assiduité'
  end

  private

  # Three practised days in the current year, at three different intensities.
  # Anchored on 1 March so the dates never fall in the future, whatever day the
  # suite runs — the calendar refuses to open a day that hasn't happened.
  def calendar_days
    year = Time.now.year
    [[Time.new(year, 3, 1, 19, 0, 0), 5], [Time.new(year, 3, 3, 19, 0, 0), 20],
     [Time.new(year, 3, 5, 19, 0, 0), 45]]
  end

  def calendar_sessions
    calendar_days.each_with_index.map { |(started_at, minutes), index| calendar_session(started_at, minutes, index) }
  end

  def calendar_session(started_at, minutes, index)
    ended_at = (started_at + (minutes * 60)).iso8601(3)
    attempt = { startedAt: started_at.iso8601(3), durationMs: minutes * 60_000, wrongNotes: 0, clean: true }
    {
      id: "calendar-#{index}",
      scoreId: 'scores/nocturne.mxl',
      mode: 'free',
      totalMeasures: 1,
      startedAt: started_at.iso8601(3),
      endedAt: ended_at,
      playthroughStartedAt: started_at.iso8601(3),
      completedAt: ended_at,
      measures: [{ sourceMeasureIndex: 0, attempts: [attempt] }]
    }
  end

  # The day panel reads titles off the aggregates, as the journal does.
  def calendar_aggregates
    [{ scoreId: 'scores/nocturne.mxl', scoreTitle: 'Nocturne op. 9 no 2', composer: 'Chopin',
       status: 'perfectionnement', totalPracticeTimeMs: 4_200_000, practiceDays: [] }]
  end
end
