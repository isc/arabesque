require_relative 'test_helper'

class PracticeTrackingTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_score_complete_modal_shows_time_and_ranking
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    assert_selector 'svg g.vf-stavenote', count: 2
    sleep 0.2

    # First playthrough
    play_notes(%w[C4 D4])
    assert_selector 'dialog[open]'
    assert_text 'Partition terminée'
    assert_selector 'p strong' # Time display (no table yet for first playthrough)

    # Close modal
    find('button[aria-label="Close"]').click
    assert_no_selector 'dialog[open]'
    sleep 0.5 # Wait for session to be saved

    # Second playthrough
    play_notes(%w[C4 D4])

    # Verify modal shows ranking table with both playthroughs
    assert_selector 'dialog[open]'
    sleep 0.3 # Wait for async data loading
    assert_selector 'table tbody tr', minimum: 2
    assert_text 'maintenant'
  end

  def test_history_modal_shows_playthrough_evolution_chart
    # Inject 3 completed playthroughs with decreasing durations into IndexedDB,
    # then open the history modal and verify the chart renders.
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    assert_selector 'svg g.vf-stavenote', count: 2

    wait_for_store('sessions')
    page.execute_script(<<~JS)
      const SCORE_ID = '/test-fixtures/two-measures.xml'
      const now = Date.now()
      const day = 86400000
      const sessions = [
        { daysAgo: 7, durationMin: 8 },
        { daysAgo: 4, durationMin: 7 },
        { daysAgo: 1, durationMin: 6 },
      ].map((s, i) => {
        const startedAt = new Date(now - s.daysAgo * day).toISOString()
        const completedAt = new Date(now - s.daysAgo * day + s.durationMin * 60000).toISOString()
        return {
          id: 'chart-test-' + i,
          scoreId: SCORE_ID,
          mode: 'free',
          startedAt,
          endedAt: completedAt,
          playthroughStartedAt: startedAt,
          completedAt,
          totalMeasures: 2,
          measures: [{ sourceMeasureIndex: 0, attempts: [{ startedAt, durationMs: s.durationMin * 60000, wrongNotes: 0, clean: true }] }],
        }
      })
      const req = indexedDB.open('arabesque', 3)
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite')
        const store = tx.objectStore('sessions')
        for (const s of sessions) store.put(s)
      }
    JS
    sleep 0.2

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
    sleep 0.2 # Wait for callbacks to initialize

    # Play the complete score (C4, E4, F4, G4)
    play_notes(%w[C4 E4 F4 G4])

    # Wait for score complete modal (dialog[open])
    assert_selector 'dialog[open]'
    sleep 0.3

    # Go to library and check daily log
    visit '/library.html'

    # Verify daily log shows today's practice
    within '#daily-log' do
      assert_text "aujourd'hui"
      assert_text 'Simple Score' # Score title from fixture
    end
  end

end
