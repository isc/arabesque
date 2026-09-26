require_relative 'test_helper'

# 🎯 Renforcer: the measures fumbled in a run, offered back as a training drill.
class ReinforcementTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_reinforcement_is_offered_before_the_score_has_been_played_through
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # Measure 1 only: a wrong note, then the right one. Three measures still
    # lie ahead — nothing here is a playthrough.
    play_note('D4')
    play_note('C4')

    assert_text 'Renforcer 1 mesure'
    assert_no_text 'Partition terminée'

    click_on 'Renforcer 1 mesure'
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.measure-click-area.selected'

    # The free session interrupted mid-piece is closed rather than stranded
    # with a null endedAt.
    wait_for_records('sessions', where: 'record.endedAt')
  end

  def test_reinforcement_follows_the_hands_ticked
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # Measure 1 fumbled with the right hand alone: offered for the right hand,
    # and saying so, since it is not the piece played in full.
    uncheck 'Main gauche'
    play_note('D4')
    play_note('C4')
    assert_selector '.pt-reinforce-badge', text: 'Renforcer 1 mesure · MD'
    assert_selector '.pt-reinforce-badge[aria-label="🎯 Renforcer 1 mesure · main droite"]'

    # Both hands back: nothing was fumbled two-handed (feedback 0868d96f).
    check 'Main gauche'
    assert_no_selector '.pt-reinforce-badge'

    uncheck 'Main gauche'
    assert_selector '.pt-reinforce-badge', text: 'Renforcer 1 mesure · MD'
  end

  def test_reinforcement_mode_after_playthrough_with_mistakes
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # Play with mistakes on measure 1
    # Sequence: C4 -> D4 -> E4 -> C4 -> D4 -> F4

    # Measure 1 (first pass) - play wrong note then correct
    play_note("D4")  # Wrong note (expected C4)
    play_note("C4")  # Correct

    # Measure 2 (first pass) - clean
    play_note("D4")

    # Measure 3 (volta 1) - triggers repeat
    play_note("E4")

    # Measure 1 (second pass) - clean
    play_note("C4")

    # Measure 2 (second pass) - clean
    play_note("D4")

    # Measure 4 (volta 2) - completes score
    play_note("F4")

    assert_text 'Partition terminée'

    # Close the completion modal
    click_on 'Close'

    # Verify reinforcement link is visible at the top
    assert_text 'Renforcer 1 mesure'

    # Start reinforcement mode
    click_on 'Renforcer 1 mesure'

    # Verify we're in training mode on measure 1
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.measure-click-area.selected'

    # Play measure 1 three times cleanly
    3.times do
      play_note("C4")
      assert_no_selector 'svg g.vf-notehead.played-note'  # Wait for measure reset
    end

    # Reinforcement should be complete (only 1 measure to reinforce)
    assert_text 'Renforcement terminé'
    assert_no_selector 'svg rect.measure-click-area.selected'
    assert_no_selector 'svg circle.repeat-indicator'
  end

  # The run above again, with the one thing it cannot make happen on purpose:
  # the badge clicked inside the beat the finished run holds the sheet for
  # (afterTheBeat). Held rather than raced, because the two orders are a few
  # tens of milliseconds apart — CI found the losing one once, and the clear
  # landing on the drill just armed over it left plain training mode on measure
  # 1 for good.
  def test_reinforcement_survives_the_clearing_of_the_run_that_offered_it
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # A fumble in measure 1, then the rest of the piece: the run that puts one
    # measure on the reinforcement list.
    %w[D4 C4 D4 E4 C4 D4].each { |note| play_note(note) }

    with_timers_held do
      play_note('F4') # finishes the score, and arms the clearing of the sheet

      # Through the completion modal rather than after it — closing it is not
      # what this is about, and a dispatched click does not care what is drawn
      # over the badge.
      find('.pt-reinforce-badge').trigger('click')
      assert_selector 'svg rect.measure-click-area.selected'
    end

    3.times do
      play_note('C4')
      assert_no_selector 'svg g.vf-notehead.played-note'
    end

    assert_text 'Renforcement terminé'
  end
end
