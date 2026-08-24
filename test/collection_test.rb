require_relative 'test_helper'

# Collections ("recueils"): catalog entries with `parts` instead of `file`,
# e.g. the 20 Hanon exercises — one library row, a part navigator on the
# score page, and per-part fingerprints for MIDI search.
class CollectionTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
    assert_selector 'tbody tr', minimum: 1
  end

  def test_collection_is_a_single_library_row
    assert_selector 'td a', text: 'Le Pianiste virtuose (1re partie)', count: 1
    assert_selector 'td', text: '20 exercices'
    refute_text 'Exercice 12' # parts are not separate rows
  end

  def test_collection_opens_first_part_and_navigates_between_parts
    click_link 'Le Pianiste virtuose (1re partie)'
    assert_current_path %r{/score\.html\?url=.*Ex_01}
    assert_selector '#score[data-render-complete]'

    select 'Exercice 3', from: 'Choisir un exercice'
    assert_current_path %r{Ex_03}
    assert_selector '#score[data-render-complete]'

    click_button 'Exercice suivant'
    assert_current_path %r{Ex_04}
    assert_selector '#score[data-render-complete]'
    assert_selector '.pt-topbar__title', text: 'Le Pianiste virtuose (1re partie)'
  end

  def test_first_part_disables_previous_button
    click_link 'Le Pianiste virtuose (1re partie)'
    assert_selector '#score[data-render-complete]'
    assert_selector 'button[aria-label="Exercice précédent"]:disabled'
  end

  def test_collection_resumes_last_played_part
    # Inject a practice session on exercise 3, then reload the library: the
    # collection row should link to that exercise instead of the first one.
    started_at = (Time.now - 3600).utc.iso8601(3)
    attempt = { startedAt: started_at, durationMs: 5000, wrongNotes: 0, clean: true }
    session = {
      id: 'hanon-resume-test',
      scoreId: 'scores/Hanon_Le_Pianiste_Virtuose_Ex_03.mxl',
      mode: 'free',
      startedAt: started_at,
      endedAt: started_at,
      totalMeasures: 29,
      measures: [{ sourceMeasureIndex: 0, attempts: [attempt] }]
    }
    seed_store('sessions', [session])

    visit '/library.html'
    assert_selector 'tbody tr', minimum: 1
    link = find('td a', text: 'Le Pianiste virtuose (1re partie)')
    assert_match(/Ex_03/, link[:href])
  end

  def test_open_exercise_by_playing_its_beginning
    # Hanon exercise 1, right hand: C3 E3 F3 G3 A3
    play_notes(%w[C3 E3 F3 G3 A3])

    assert_current_path %r{/score\.html\?url=.*Ex_01}
  end
end
