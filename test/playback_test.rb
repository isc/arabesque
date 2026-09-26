require_relative 'test_helper'

# ▶ Écouter: the app playing the score to the player, with the band that
# carries its transport, its tempo and the bar it starts from.
class PlaybackTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_playback_starts_and_stops
    load_score('simple-score.xml', 4)

    click_on 'Écouter'
    assert_text '⏹ Stop'
    # The label follows isPlaying, so it only says the engine started. The
    # cursor being shown says it is actually running on the score.
    assert_selector 'img#cursorImg-0'

    click_on 'Stop'
    assert_text '▶ Écouter'
    assert_no_selector 'img#cursorImg-0', visible: :visible
  end

  # Feedback 50e2418d: listening got the sub-bar strict mode already had — the
  # transport, the tempo to hear the piece at, and the bar to hear it from.
  #
  # From the catalog rather than an upload: the tempo is remembered per score,
  # and a score without a URL has nowhere to remember it.
  def test_playback_band_carries_the_transport_the_tempo_and_the_starting_bar
    visit '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)

    # No band until there is something to listen to.
    assert_no_text 'Cliquez sur une mesure pour écouter'

    # The clock is parked for the one stretch where the piece could run out
    # from under the assertions; past ⏸ there is no timer left pending.
    with_clock_control do
      trigger_click_on('▶ Écouter')
      # Alpine puts an x-show element back on screen from a setTimeout of its
      # own — hiding is immediate, showing is deferred a tick. That tick is
      # virtual time like any other, so a parked clock leaves the band at
      # display:none however long Capybara waits on the wall clock, and the
      # placeholder text in the markup is what it then finds "including
      # non-visible text". 50ms is far short of the first bar, so the piece is
      # still where the assertions below expect it.
      advance_clock(50)
      assert_text 'Cliquez sur une mesure pour écouter à partir de là.'
      trigger_click_on('⏸ Pause')
    end

    # ⏸ holds the piece rather than ending it: the band stays up and the
    # modebar still offers ⏹, not a fresh start.
    assert_text '▶ Reprendre'
    assert_text '⏹ Stop'
    assert_text 'En pause à la mesure 1'

    # A bar clicked while paused is where ▶ will pick the piece up.
    click_measure(2)
    assert_text 'En pause à la mesure 2'

    # The tempo is the player's, set without leaving the listening. The field
    # is debounced, so the tempo being filed under the score is what says the
    # keystrokes reached the app.
    fill_in 'playback-bpm', with: '20'
    wait_for_stored_tempo('/test-fixtures/two-measures.xml', '20')

    with_clock_control do
      trigger_click_on('▶ Reprendre')
      assert_text '⏸ Pause'
      trigger_click_on('⏹ Stop')
    end
    assert_text '▶ Écouter'
    assert_no_text 'Cliquez sur une mesure pour écouter'
  end

  # The listening ends with the mode being played in, and the rule has to sit on
  # the mode rather than on the tab that usually changes it: 🎯 Renforcer moves
  # into training mode without going through the tabs at all, and left the piece
  # playing on under the new mode — the very state the rule exists to prevent.
  def test_starting_reinforcement_ends_the_listening
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # A fumbled bar, so there is something to reinforce.
    play_note('D4')
    play_note('C4')
    assert_text 'Renforcer 1 mesure'

    # Held at its first bar before reinforcement is asked for: nothing is left
    # scheduled, so the listening can only end for the reason under test rather
    # than because the piece ran out while the assertions were being made.
    with_clock_control do
      trigger_click_on('▶ Écouter')
      advance_clock(50) # Alpine shows an x-show element a tick later
      assert_text 'Cliquez sur une mesure pour écouter à partir de là.'
      trigger_click_on('⏸ Pause')
    end
    assert_text 'En pause à la mesure 1'

    # The badge is a link, not a button, so click_on's button lookup misses it.
    find('.pt-reinforce-badge').click

    assert_text 'Mode Entraînement Actif'
    assert_no_text 'En pause à la mesure 1'
    assert_text '▶ Écouter'
  end
end
