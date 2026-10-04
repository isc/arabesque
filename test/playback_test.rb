require_relative 'test_helper'

# ▶ Écouter: the app playing the score to the player, with the band that
# carries its transport, its tempo and the bar it starts from.
class PlaybackTest < CapybaraTestBase
  def setup
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
    open_two_measures

    # No band until there is something to listen to.
    assert_no_text 'Cliquez sur une mesure pour écouter'

    listen_then_pause { assert_text 'Cliquez sur une mesure pour écouter à partir de là.' }

    # ⏸ holds the piece rather than ending it: the band stays up and the
    # modebar still offers ⏹, not a fresh start.
    assert_text '▶ Reprendre'
    assert_text '⏹ Stop'

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
    # A fumbled bar, so there is something to reinforce.
    open_with_the_second_bar_fumbled
    assert_text 'Renforcer 1 mesure'

    # Held at its first bar before reinforcement is asked for: nothing is left
    # scheduled, so the listening can only end for the reason under test rather
    # than because the piece ran out while the assertions were being made.
    listen_then_pause

    # The badge is a link, not a button, so click_on's button lookup misses it.
    find('.pt-reinforce-badge').click

    assert_text 'Mode Entraînement Actif'
    assert_no_text 'En pause à la mesure 1'
    assert_text '▶ Écouter'
  end
end
