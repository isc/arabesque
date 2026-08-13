require_relative 'test_helper'

class PracticeTrackingTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_score_complete_modal_shows_time_and_ranking
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    assert_selector 'svg g.vf-stavenote', count: 2
    assert_selector '#score[data-render-complete]'

    # First playthrough
    play_notes(%w[C4 D4])
    assert_selector 'dialog[open]'
    assert_text 'Partition terminée'
    assert_selector 'p strong' # Time display (no table yet for first playthrough)

    # Close modal
    find('button[aria-label="Close"]').click
    assert_no_selector 'dialog[open]'
    # The playthrough is written asynchronously; the second one must not start
    # before the first is on record, or the ranking table has nothing to rank.
    wait_for_records('sessions', where: 'record.completedAt')

    # Second playthrough
    play_notes(%w[C4 D4])

    # Verify modal shows ranking table with both playthroughs
    assert_selector 'dialog[open]'
    assert_selector 'table tbody tr', minimum: 2
    assert_text 'maintenant'
  end

  def test_history_modal_shows_playthrough_evolution_chart
    # Inject 3 completed playthroughs with decreasing durations into IndexedDB,
    # then open the history modal and verify the chart renders.
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    assert_selector 'svg g.vf-stavenote', count: 2

    seed_store('sessions', completed_playthroughs)

    click_on 'Historique'
    assert_selector 'dialog[open]'
    assert_text 'Évolution du temps de jeu'

    # 3 playthroughs => 3 dots
    within('.playthrough-chart') do
      assert_selector 'circle.chart-point', count: 3
      assert_text '8m 0s' # max duration label
      assert_text '6m 0s' # min duration label
    end
  end

  def test_daily_log_shows_practiced_score
    # Play a score to generate practice data
    visit "/score.html?url=/test-fixtures/simple-score.xml"
    assert_selector 'svg g.vf-stavenote', count: 4
    assert_selector '#score[data-render-complete]'

    # Play the complete score (C4, E4, F4, G4)
    play_notes(%w[C4 E4 F4 G4])

    # Wait for score complete modal (dialog[open])
    assert_selector 'dialog[open]'
    # Leaving the page before the session lands would lose it from the log.
    wait_for_records('sessions', where: 'record.completedAt')

    # Go to library and check daily log
    visit '/library.html'

    # Verify daily log shows today's practice
    within '#daily-log' do
      assert_text "aujourd'hui"
      assert_text 'Simple Score' # Score title from fixture
    end
  end

  private

  # Three finished playthroughs of the two-measure fixture, oldest and longest
  # first, so the chart has a visible downward trend to draw.
  def completed_playthroughs
    now = Time.now.utc
    [[7, 8], [4, 7], [1, 6]].each_with_index.map do |(days_ago, duration_min), index|
      started_at = now - (days_ago * 86_400)
      completed_at = started_at + (duration_min * 60)
      attempt = { startedAt: started_at.iso8601(3), durationMs: duration_min * 60_000,
                  wrongNotes: 0, clean: true }
      {
        id: "chart-test-#{index}",
        scoreId: '/test-fixtures/two-measures.xml',
        mode: 'free',
        startedAt: started_at.iso8601(3),
        endedAt: completed_at.iso8601(3),
        playthroughStartedAt: started_at.iso8601(3),
        completedAt: completed_at.iso8601(3),
        totalMeasures: 2,
        measures: [{ sourceMeasureIndex: 0, attempts: [attempt] }]
      }
    end
  end
end
