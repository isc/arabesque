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

  # A pick gives up only what actually blocked it. Chopin is romantique, so
  # asking for baroque has to let the composer go — but not the status, which
  # baroque scores can perfectly well be in.
  def test_a_pick_releases_only_the_filter_that_was_in_its_way
    find('button.pt-filter-pill[data-status="dechiffrage"]').click
    click_link 'Chopin', match: :first

    find('select[aria-label="Filtrer par période musicale"]').select 'Baroque'

    assert_selector 'button.pt-filter-pill[data-status="dechiffrage"][aria-pressed="true"]'
    assert_equal '', find('select[aria-label="Filtrer par compositeur"]').value
    refute_empty all('tbody tr')
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
    assert_selector 'tbody .pt-pill--dechiffrage', count: 3
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

  # The point of the change: a filter you click never bounces off one you set
  # earlier. Only the Nocturne Op. 9 is close to the répertoire, and it is in
  # Perfectionnement, so no Déchiffrage row can ever be in both sets.
  def test_picking_a_focus_chip_releases_the_status_it_cannot_coexist_with
    find('button.pt-filter-pill[data-status="dechiffrage"]').click
    assert_selector 'button.pt-filter-pill[data-status="dechiffrage"][aria-pressed="true"]'

    # The chip announces the row it would show, not the nought it would leave.
    assert_selector 'button.pt-focus__chip[data-focus="near-mastery"]', text: '1'
    find('button.pt-focus__chip[data-focus="near-mastery"]').click

    # The chip took, and the status pill let go rather than the other way round.
    assert_selector 'button.pt-focus__chip[data-focus="near-mastery"][aria-pressed="true"]'
    assert_includes all('tbody tr td:first-child').map(&:text), 'Nocturne Op. 9 No. 1'

    # And with only the chip left, the status pills count against it — "Tous"
    # included, which clears the status and so counts what the chip leaves.
    assert_selector 'button.pt-filter-pill[data-status="perfectionnement"]', text: '1'
    assert_selector 'button.pt-filter-pill[aria-pressed="true"]', text: /Tous\s+1/
  end

  # And the same the other way round, since neither filter is the senior one.
  def test_picking_a_status_releases_the_focus_it_cannot_coexist_with
    find('button.pt-focus__chip[data-focus="near-mastery"]').click

    assert_selector 'button.pt-filter-pill[data-status="dechiffrage"]', text: '3'
    find('button.pt-filter-pill[data-status="dechiffrage"]').click

    assert_selector 'button.pt-filter-pill[data-status="dechiffrage"][aria-pressed="true"]'
    assert_no_selector 'button.pt-focus__chip[aria-pressed="true"]'
    refute_empty all('tbody tr')
  end

  def test_period_options_count_against_the_active_composer
    click_link 'Chopin', match: :first

    period = find('select[aria-label="Filtrer par période musicale"]')
    # Baroque is still offered, carrying the count picking it would show:
    # the composer filter gives way rather than the option going dead.
    refute_equal '0', period.find('option[value="baroque"]', visible: :all).text[/\((\d+)\)/, 1]
  end

  def test_a_dead_combination_restored_from_a_url_offers_a_way_out
    visit '/library.html?status=dechiffrage&focus=near-mastery'

    assert_selector '.pt-library-empty'
    assert_no_selector 'tbody tr'

    click_button 'Réinitialiser les filtres'

    assert_selector 'tbody tr', minimum: 4
    assert_no_selector '.pt-library-empty'
    refute_match(/status=|focus=/, page.current_url)
  end

  # "🎯 À renforcer" now asks the question the score page answers with its
  # "Renforcer N mesures" badge — are there bars reinforcement mode would offer
  # right now? — instead of reading the aggregates, whose counters never forget.
  # The Prelude's lifetime error rate still looks damning and used to pin it in
  # the chip for ever; its fumble is ten sessions old, so it is done with.
  def test_the_reinforce_chip_forgets_mistakes_the_reinforcement_window_has_dropped
    seed_store('aggregates', [
      {
        scoreId: PRELUDE,
        scoreTitle: 'Prelude Op. 28 No. 4 in E Minor',
        composer: 'Chopin',
        status: 'dechiffrage',
        lastPlayedAt: '2026-01-11T10:00:00.000Z',
        totalPracticeTimeMs: 300_000,
        practiceDays: ['2026-01-01'],
        # Six fumbles out of ten, counted since the first day: over the bar the
        # old rule set, and never coming back down. Re-seeded deliberately, so
        # a revert to the aggregate rule fails this test rather than passing it.
        measures: { '0' => { totalAttempts: 10, cleanAttempts: 4, errorRate: 0.6 } },
      },
    ])
    # One old fumble, then ten sessions spent elsewhere in the piece — enough to
    # push it out of the ten-session window.
    sessions = [reinforce_session(PRELUDE, 0, 0, fumbled: true)]
    sessions += (1..10).map { |day| reinforce_session(PRELUDE, day, 9, fumbled: false) }
    sessions << reinforce_session(NOCTURNE_20, 11, 3, fumbled: true)
    seed_store('sessions', sessions)

    visit '/library.html'

    chip = find('button.pt-focus__chip[data-focus="reinforce"]')
    assert_equal '1', chip.find('.pt-focus__count').text

    chip.click

    titles = all('tbody tr td:first-child').map(&:text)
    assert_includes titles, 'Nocturne No. 20 in C# Minor'
    refute_includes titles, 'Prelude Op. 28 No. 4 in E Minor'

    # And the page says what the chip selects, which is what nobody could tell
    # from "🎯 À renforcer" alone — the question that prompted all this. On the
    # card that already answers it for a status, not a title tooltip: a tooltip
    # never opens on the tablet the question came from.
    criteria = find('.pt-criteria')
    assert_match(/À RENFORCER/i, criteria.text)
    assert_match(/10 dernières séances/, criteria.text)
    assert_match(/3 passages de suite/, criteria.text)
  end

  private

  PRELUDE = 'scores/Prlude_No._4_in_E_Minor_Op._28_-_Frdric_Chopin.mxl'
  NOCTURNE_20 = 'scores/Nocturne_No._20_in_C_sharp_Minor.mxl'

  # One session on one bar, `day` days into January 2026.
  def reinforce_session(score_id, day, measure_index, fumbled:)
    started = format('2026-01-%<d>02dT10:00:00.000Z', d: day + 1)
    {
      id: "s-#{score_id.hash.abs}-#{day}",
      scoreId: score_id,
      mode: 'training',
      startedAt: started,
      endedAt: started,
      measures: [
        {
          sourceMeasureIndex: measure_index,
          attempts: [{ startedAt: started, durationMs: 4_000, wrongNotes: fumbled ? 2 : 0, clean: !fumbled }],
        },
      ],
    }
  end

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
        # Every measure played clean often enough: the one score the
        # "⭐ Proches du répertoire" chip has to offer.
        measures: (1..4).to_h { |i| [i.to_s, { totalAttempts: 5, cleanAttempts: 5, errorRate: 0 }] },
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
      # A baroque score in Déchiffrage, so that status and period can coexist:
      # it is what makes "release only the composer" the minimal answer when
      # Baroque is picked under Déchiffrage + Chopin.
      {
        scoreId: 'scores/J._S._Bach_-_Air_on_the_G_String_Piano_arrangement.mxl',
        scoreTitle: 'Air on the G String',
        composer: 'J.S. Bach',
        status: 'dechiffrage',
        lastPlayedAt: '2026-03-14T10:00:00.000Z',
        totalPracticeTimeMs: 900_000,
        practiceDays: ['2026-03-14'],
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
