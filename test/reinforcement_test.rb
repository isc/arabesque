require_relative 'test_helper'

# 🎯 Renforcer: the spots fumbled in a run, offered back as a training drill of
# the beat they fell in and the beat before (fragments.js). repeat-endings.xml
# has one note a bar, a whole note, so the beat before a bar's downbeat holds
# no note: the fragment reaches back to the last one played, and a wrong note
# owed on bar 2 is drilled as the notes of bars 1 and 2.
class ReinforcementTest < CapybaraTestBase
  def test_reinforcement_is_offered_before_the_score_has_been_played_through
    # Two measures in: the rest of the piece still lies ahead — nothing here
    # is a playthrough.
    open_with_the_second_bar_fumbled

    assert_text 'Renforcer 1 passage'
    assert_no_text 'Partition terminée'

    click_on 'Renforcer 1 passage'
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.fragment-range', count: 2

    # The free session interrupted mid-piece is closed rather than stranded
    # with a null endedAt.
    wait_for_records('sessions', where: 'record.endedAt')
  end

  def test_reinforcement_follows_the_hands_ticked
    visit '/score.html?url=/test-fixtures/repeat-endings.xml'
    wait_for_score_render(4)

    # Measure 2 fumbled with the right hand alone: offered for the right hand,
    # and saying so, since it is not the piece played in full.
    uncheck 'Main gauche'
    play_notes(%w[C4 E4 D4])
    assert_selector '.pt-reinforce-badge', text: 'Renforcer 1 passage · MD'
    assert_selector '.pt-reinforce-badge[aria-label="🎯 Renforcer 1 passage · main droite"]'

    # Both hands back: nothing was fumbled two-handed (feedback 0868d96f).
    check 'Main gauche'
    assert_no_selector '.pt-reinforce-badge'

    uncheck 'Main gauche'
    assert_selector '.pt-reinforce-badge', text: 'Renforcer 1 passage · MD'
  end

  def test_reinforcement_mode_after_playthrough_with_mistakes
    # Sequence: C4 -> D4 -> E4 -> C4 -> D4 -> F4, with a wrong note (E4) before
    # the first D4.
    open_with_the_second_bar_fumbled

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
    assert_text 'Renforcer 1 passage'

    # Start reinforcement mode
    click_on 'Renforcer 1 passage'

    # In training on the way into bar 2: the notes of bars 1 and 2
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.fragment-range', count: 2

    drill_the_join

    # Reinforcement should be complete (only the join to reinforce)
    assert_text 'Renforcement terminé'
    assert_no_selector 'svg rect.fragment-range'
    assert_no_selector 'svg circle.repeat-indicator'
  end

  # Offered under the strict tab too, the drill takes the page out of it. The
  # page used to stay on strict while the engine drilled the measure — and a
  # strict run played there was filed as training.
  def test_a_reinforcement_started_from_the_strict_tab_leaves_it
    open_with_the_second_bar_fumbled
    click_on '⏱ Mode strict'
    click_on 'Renforcer 1 passage'

    assert_selector 'button[data-mode="training"][aria-pressed="true"]'
    assert_no_selector '.pt-context--strict', visible: true
    drill_the_join
    assert_text 'Renforcement terminé'
  end

  # A drill left through the free tab is over: training is the plain one
  # again, band and bar picking included. Both stayed gone for the rest of the
  # page, the drill never having been told it had ended.
  def test_training_after_a_drill_left_by_hand
    open_with_the_second_bar_fumbled
    click_on 'Renforcer 1 passage'
    assert_text 'Mode Entraînement Actif'

    click_on 'Libre'
    enter_training_mode

    assert_selector '.pt-context--training', visible: true
    click_measure(3)
    wait_for_training_cursor(3)
  end

  # The run above again, with the one thing it cannot make happen on purpose:
  # the badge clicked inside the beat the finished run holds the sheet for
  # (afterTheBeat). Held rather than raced, because the two orders are a few
  # tens of milliseconds apart — CI found the losing one once, and the clear
  # landing on the drill just armed over it left plain training mode on measure
  # 1 for good.
  def test_reinforcement_survives_the_clearing_of_the_run_that_offered_it
    # A fumble in measure 2, then the rest of the piece: the run that puts one
    # measure on the reinforcement list.
    open_with_the_second_bar_fumbled
    %w[E4 C4 D4].each { |note| play_note(note) }

    with_timers_held do
      play_note('F4') # finishes the score, and arms the clearing of the sheet

      # Through the completion modal rather than after it — closing it is not
      # what this is about, and a dispatched click does not care what is drawn
      # over the badge.
      find('.pt-reinforce-badge').trigger('click')
      assert_selector 'svg rect.fragment-range', count: 2
    end

    drill_the_join

    assert_text 'Renforcement terminé'
  end

  # The dots hang over a passage's first notes, where a hand changes shape and
  # a fingering is most often written: they clear it rather than cover it
  # (feedback 65537b34). Bar 19 of the C minor prelude: the right hand's first
  # notes low under a beam, their fingerings over the staff. The passage is
  # handed to the page as it would offer it, sparing eighteen bars of playing.
  def test_the_dots_clear_the_fingerings_over_a_passage
    url = '/scores/Prelude_No._2_BWV_847_in_C_Minor.mxl'
    visit "/score.html?url=#{url}"
    wait_for_score_render
    seed_store('fingerings', [{ scoreUrl: url, fingerings: { 'm18:0:0:0' => 1, 'm18:0:0:1' => 3 }, updatedAt: 1 }])
    visit "/score.html?url=#{url}"
    wait_for_score_render

    execute_script(<<~JS)
      Alpine.$data(document.querySelector('[x-data]'))
        .setMode('reinforcement', [{ from: { bar: 18, position: 0 }, until: { bar: 18, position: 0.25 }, hands: 'both', faults: 1 }])
    JS
    assert_selector 'svg circle.repeat-indicator', count: 3
    clearance = evaluate_script(<<~JS)
      (() => {
        const dot = document.querySelector('svg circle.repeat-indicator')
        const bottom = Number(dot.getAttribute('cy')) + Number(dot.getAttribute('r'))
        const fingerings = [...document.querySelectorAll('#score svg text')]
          .filter((t) => ['1', '3'].includes(t.textContent.trim()))
          .map((t) => t.getBBox())
          .filter((box) => Math.abs(box.x - Number(dot.getAttribute('cx'))) < 60)
        return fingerings.length === 2 ? Math.min(...fingerings.map((box) => box.y)) - bottom : null
      })()
    JS
    assert_operator clearance, :>=, 0
  end

  private

  # The three clean repetitions of bars 1 and 2 that finish a drill of the
  # join, each waited out until the passage is cleared for the next.
  def drill_the_join
    3.times do
      play_note('C4')
      assert_selector 'svg g.vf-notehead.played-note', count: 1
      play_note('D4')
      assert_no_selector 'svg g.vf-notehead.played-note'
    end
  end
end
