require_relative 'test_helper'

class LibraryFiltersTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
    inject_aggregates
    visit '/library.html'
  end

  def test_clicking_composer_in_table_filters_library
    assert_selector 'tbody tr', minimum: 4

    # Click "Chopin" on a row → activates composer filter, narrows the list to Chopin's pieces
    click_link 'Chopin', match: :first
    assert_current_path %r{\?.*composer=Chopin}

    rows = all('tbody tr')
    refute_empty rows
    rows.each do |row|
      assert_match(/Chopin/, row.find('td:nth-child(2)').text)
    end
  end

  def test_clicking_status_pill_filters_library
    assert_selector 'tbody tr', minimum: 4

    click_link 'Répertoire', match: :first
    assert_current_path %r{\?.*status=repertoire}

    titles = all('tbody tr td:first-child').map(&:text)
    assert_includes titles, 'Waltz in A Minor'
    refute_includes titles, 'Nocturne Op. 9 No. 1'
    refute_includes titles, 'Prelude Op. 28 No. 4 in E Minor'
  end

  def test_status_filter_pills_at_top_filter_library
    # Filter pill at top of page (the visible count is appended, e.g. "Déchiffrage 2")
    find('button.pt-filter-pill[data-status="dechiffrage"]').click
    assert_current_path %r{\?.*status=dechiffrage}

    titles = all('tbody tr td:first-child').map(&:text)
    assert_includes titles, 'Nocturne No. 20 in C# Minor'
    assert_includes titles, 'Prelude Op. 28 No. 4 in E Minor'
    refute_includes titles, 'Waltz in A Minor'
    # Half a minute of playing is under the practice floor, so the Ballade has
    # no status at all — not even the rung its stored aggregate still claims.
    refute_includes titles, 'Ballade No. 1 in G minor Op. 23'
  end

  # A piece opened, tried for half a minute and left behind is not being
  # sight-read, and wears no badge — including one graded before the floor
  # existed, which the library re-grades on its way to the screen.
  def test_barely_practised_score_wears_no_status_badge
    assert_selector 'tbody .pt-pill--dechiffrage', count: 2
    find('tbody tr', text: 'Ballade No. 1 in G minor Op. 23').assert_no_selector '.pt-pill'
  end

  def test_filters_persist_via_url_params
    visit '/library.html?status=repertoire&composer=Chopin'

    assert_selector 'tbody tr', count: 1, text: 'Waltz in A Minor'
  end

  def test_clicking_active_filter_clears_it
    click_link 'Chopin', match: :first
    assert_current_path %r{\?.*composer=Chopin}

    click_link 'Chopin', match: :first
    refute_match(/composer=/, page.current_url)
  end

  def test_period_filter_narrows_library_to_one_era
    select 'Romantique', from: 'Filtrer par période musicale', match: :first
    assert_current_path %r{\?.*period=romantique}

    composers = all('tbody tr td:nth-child(2)').map(&:text).uniq
    refute_empty composers
    composers.each do |c|
      refute_match(/Bach|Mozart|Debussy|Traditional/, c, "Expected only Romantic composers, got #{c}")
    end
  end

  def test_period_filter_persists_via_url_param
    visit '/library.html?period=baroque'

    # Wait for init() to finish wiring URL filters into the table before
    # snapshotting composers — init now defers filter restoration to a
    # $nextTick so the select dropdowns can pick up their option.
    assert_selector 'tbody tr', minimum: 1
    assert_no_selector 'tbody tr td:nth-child(2)', text: /Mozart|Debussy|Chopin/

    composers = all('tbody tr td:nth-child(2)').map(&:text).uniq
    composers.each { |c| assert_match(/Bach|Pachelbel|Petzold|Handel/, c) }
  end

  # The numbers asserted here are STATUS_THRESHOLDS (practiceTracker.js), which
  # is also what computeScoreStatus() grades by — if the rules move, this test
  # is where the two are checked to have moved together.
  def test_status_filter_spells_out_what_the_next_status_takes
    assert_no_selector '.pt-criteria'

    find('button.pt-filter-pill[data-status="dechiffrage"]').click
    # text-transform uppercases the heading on screen, which is what Capybara reads.
    assert_selector '.pt-criteria', text: /pour passer en perfectionnement/i
    assert_selector '.pt-criteria li', text: '50 % des mesures jouées proprement au moins 3 fois'
    assert_selector '.pt-criteria li', text: 'La partition jouée en entier au moins une fois'

    find('button.pt-filter-pill[data-status="perfectionnement"]').click
    assert_selector '.pt-criteria', text: /pour passer en répertoire/i
    assert_selector '.pt-criteria li', text: 'Toutes les mesures jouées proprement au moins 10 fois'
    assert_selector '.pt-criteria li', text: 'La partition jouée en entier au moins 10 fois'
    assert_selector '.pt-criteria li', text: 'Travaillée sur au moins 3 jours différents'

    # Nothing sits above Répertoire, so there is nothing to explain.
    find('button.pt-filter-pill[data-status="repertoire"]').click
    assert_no_selector '.pt-criteria'
  end

  # "Proches du répertoire" is a slice of Perfectionnement, so it asks the same
  # question — reached from the URL, since the chip needs measure-level data.
  def test_near_repertoire_focus_explains_the_repertoire_bar
    visit '/library.html?focus=near-mastery'

    assert_selector '.pt-criteria', text: /pour passer en répertoire/i
  end

  private

  def inject_aggregates
    aggregates = [
      {
        scoreId: 'scores/Prlude_No._4_in_E_Minor_Op._28_-_Frdric_Chopin.mxl',
        scoreTitle: 'Prelude Op. 28 No. 4 in E Minor',
        composer: 'Chopin',
        status: 'dechiffrage',
        lastPlayedAt: '2026-01-01T10:00:00.000Z',
        totalPracticeTimeMs: 300_000,
        practiceDays: ['2026-01-01'],
      },
      {
        scoreId: 'scores/Chopin_-_Nocturne_Op._9_No._1.mxl',
        scoreTitle: 'Nocturne Op. 9 No. 1',
        composer: 'Chopin',
        status: 'perfectionnement',
        lastPlayedAt: '2026-02-15T10:00:00.000Z',
        totalPracticeTimeMs: 1_800_000,
        practiceDays: ['2026-02-13', '2026-02-14', '2026-02-15'],
      },
      {
        scoreId: 'scores/Waltz_in_A_MinorChopin.mxl',
        scoreTitle: 'Waltz in A Minor',
        composer: 'Chopin',
        status: 'repertoire',
        lastPlayedAt: '2026-03-10T10:00:00.000Z',
        totalPracticeTimeMs: 3_600_000,
        practiceDays: ['2026-03-08', '2026-03-09', '2026-03-10'],
      },
      # Half a minute of playing, and a status stored before the practice floor
      # existed: the library grades it again on the way to the screen.
      {
        scoreId: 'scores/Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl',
        scoreTitle: 'Ballade No. 1 in G minor Op. 23',
        composer: 'Chopin',
        status: 'dechiffrage',
        lastPlayedAt: '2026-03-16T10:00:00.000Z',
        totalPracticeTimeMs: 30_000,
        practiceDays: ['2026-03-16'],
      },
      {
        scoreId: 'scores/Nocturne_No._20_in_C_sharp_Minor.mxl',
        scoreTitle: 'Nocturne No. 20 in C# Minor',
        composer: 'Chopin',
        status: 'dechiffrage',
        lastPlayedAt: '2026-03-15T10:00:00.000Z',
        totalPracticeTimeMs: 600_000,
        practiceDays: ['2026-03-15'],
      },
    ]

    seed_store('aggregates', aggregates)
  end
end
