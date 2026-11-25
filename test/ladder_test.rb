require_relative 'test_helper'

# The ladder a reinforcement takes each passage up (ladder.js): a hand alone,
# the other, the two together, then to the click, slow and at the tempo — the
# hands set by the drill, step by step, and given back as it ends.
#
# one-hand-rest-measure.xml is three bars of whole notes on two staves: E5 over
# C3, a rest over D3, G5 over E3.
class LadderTest < CapybaraTestBase
  RIGHT = %w[E5 G5].freeze
  LEFT = %w[C3 D3 E3].freeze

  def test_a_passage_for_two_hands_is_built_a_hand_at_a_time
    open_score('one-hand-rest-measure')
    reinforce_bars(1..3)

    assert_steps 'Main droite', 'Main gauche', 'Deux mains', 'Encore', 'À froid'
    assert_on_step 'Main droite', done: 0
    assert_selector '[data-testid=board-passage]', text: /Passage 1 sur 1/i
    assert_text 'Main droite seule'
    assert_hands right: true, left: false
    assert_selector '.pt-hand-left-out', visible: :all

    play_notes(RIGHT)
    assert_on_step 'Main gauche', done: 1
    assert_text 'Main gauche seule'
    assert_hands right: false, left: true

    # Each hand alone fills no dot: the passage as written does.
    play_notes(LEFT)
    assert_on_step 'Deux mains', done: 2
    assert_text 'Deux mains, à votre rythme'
    assert_hands right: true, left: true
    assert_no_selector 'svg circle.repeat-indicator.filled'

    play_both_hands
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
    assert_on_step 'Encore', done: 3
    assert_text 'Encore une fois'
    assert_no_selector 'svg .vf-notehead.played-note'

    play_both_hands
    assert_on_step 'À froid', done: 4
    assert_text 'Une dernière fois, à froid'
    assert_no_selector 'svg .vf-notehead.played-note'

    play_both_hands
    assert_text 'Renforcement terminé'
    assert_hands right: true, left: true, set_by_the_drill: false
    assert_no_selector '.pt-ladder__step'
  end

  # A step for two hands spoiled three times over, the wrong notes all the
  # left hand's: it is taken alone for a clean repetition, then the two again.
  # The wrong key falls where each hand owes a note, and is the left hand's
  # for being next to its note: the note owed first is the right hand's.
  def test_a_hand_that_keeps_missing_is_taken_alone
    open_score('one-hand-rest-measure')
    reinforce_bars(1..3)
    play_notes(RIGHT)
    assert_hands right: false, left: true
    play_notes(LEFT)
    assert_hands right: true, left: true

    3.times do
      play_note('B2')
      assert_selector 'svg circle.repeat-indicator.spoiled', count: 1
      play_both_hands
      assert_no_selector 'svg .vf-notehead.played-note'
    end
    assert_text 'La main gauche accroche'
    assert_hands right: false, left: true
    assert_on_step 'Deux mains', done: 2, playing: 'Main gauche'

    play_notes(LEFT)
    assert_hands right: true, left: true
    assert_text 'Deux mains, à votre rythme'
    play_both_hands
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  # Once built, the passage is played to the click, by strict mode's engine:
  # at 70 % of the tempo, then at the tempo — the pace of the runs here, 2 s a
  # whole note, ♩ = 120. With a single passage the turn comes straight back to
  # it, and the loop goes on to the next run by itself. Three bars of whole
  # notes for one hand.
  def test_a_passage_built_is_played_to_the_click
    open_score('repeat-endings', 4)
    reinforce_bars(1..3, pace: 2_000)
    assert_steps 'Sans tempo', 'Clic lent', 'Au clic'
    play_notes(BARS)
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
    assert_on_step 'Clic lent', done: 1, playing: 'Clic lent · ♩ = 84'
    assert_text 'Au clic lent : ▶ lance le décompte.'
    # Before ▶ the keys go nowhere: the click has not started.
    play_note('C4')
    assert_no_selector 'svg .vf-notehead.played-note'

    with_clock_control do
      trigger_click_on('▶ Démarrer')
      # ♩ = 84: a count-in bar, then a whole note a bar, 2857 ms each.
      play_at(BARS.zip([2857, 5714, 8571]))
      # Judged 750 ms after the last note: its window, then the engine's tail.
      at(9330)
      assert_selector 'svg circle.repeat-indicator.filled', count: 2, wait: 2
      assert_selector '[data-testid=board-verdict].is-clean', text: 'Propre'
      assert_on_step 'Au clic', done: 2, playing: 'Au clic · ♩ = 120'

      # A second's gap, then the count-in at ♩ = 120: 2 s a bar.
      play_at(BARS.zip([12_321, 14_321, 16_321]))
      at(17_080)
    end
    assert_text 'Renforcement terminé'
  end

  # A step to the click spoiled three times over with no note pointing at a
  # hand — nothing played at all — slows the click for a clean run, the loop
  # going on to it by itself.
  def test_a_click_too_fast_is_slowed_down
    open_score('repeat-endings', 4)
    reinforce_bars(1..3, pace: 2_000)
    play_notes(BARS)
    assert_on_step 'Clic lent', done: 1, playing: 'Clic lent · ♩ = 84'

    with_clock_control do
      trigger_click_on('▶ Démarrer')
      # Three silent runs at ♩ = 84, 9321 ms each, a second's gap between.
      at(9330)
      assert_selector '[data-testid=board-verdict].is-failed', text: '3 notes manquées', wait: 2
      at(29_970)
      assert_on_step 'Clic lent', done: 1, playing: 'Plus lent · ♩ = 59'
      assert_text 'Le clic va trop vite pour l’instant : une fois à ♩ = 59, puis on remonte.'
      trigger_click_on('⏸ Pause')
    end
    assert_text '▶ Reprendre'
    assert_no_selector 'svg circle.repeat-indicator.filled', count: 2
  end

  # A fragment is drilled to the click as it is without: from where it starts
  # inside its first bar to where it ends inside its last. The notes outside
  # it are not asked for, so not missed, and a player going on past its end is
  # playing no wrong note. The count-in leads straight into it.
  # steady-quavers.xml at ♩ = 120, the slow click 84: the second half of bar 1
  # and the first of bar 2, a quaver 357 ms.
  def test_a_fragment_is_played_to_the_click_from_inside_its_bar
    open_score('steady-quavers', 16)
    reinforce([{ from: { bar: 0, position: 0.5 }, until: { bar: 1, position: 0.5 }, hands: 'both', pace: 2_000 }])
    fragment = %w[G4 A4 B4 C5 C5 B4 A4 G4]
    play_notes(fragment)
    assert_on_step 'Clic lent', done: 1, playing: 'Clic lent · ♩ = 84'

    with_clock_control do
      trigger_click_on('▶ Démarrer')
      # A count-in bar, and in straight away — not on through the first half of
      # bar 1, the click still counting (feedback ee14d941) — then a quaver
      # each, and F4 after.
      play_at((fragment + %w[F4]).each_with_index.map { |note, i| [note, (2857 + (i * 357.14)).round] })
      at(6_120)
      assert_selector 'svg circle.repeat-indicator.filled', count: 2, wait: 2
      assert_selector '[data-testid=board-verdict].is-clean', text: 'Propre'
      assert_no_selector 'svg .vf-notehead.missed-note'
      trigger_click_on('⏸ Pause')
    end
  end

  # A turn that starts with one hand is no try at the passage: only those
  # played cold as the drill asks for it say whether it is learnt. Two
  # passages, bars 1 and 3: the second and third turn of each.
  def test_only_a_turn_played_cold_counts_as_a_first_try
    open_score('one-hand-rest-measure')
    reinforce_bars(1, 3)

    [%w[E5 C3], %w[G5 E3]].each_with_index do |(right, left), i|
      assert_selector '[data-testid=board-passage]', text: /Passage #{i + 1} sur 2/i
      assert_text 'Main droite seule'
      assert_hands right: true, left: false
      play_note(right)
      assert_hands right: false, left: true
      play_note(left)
      assert_hands right: true, left: true
      play_chord([right, left])
    end
    ['Encore une fois', 'Une dernière fois'].each do |asked|
      [%w[E5 C3], %w[G5 E3]].each_with_index do |chord, i|
        assert_selector '[data-testid=board-passage]', text: /Passage #{i + 1} sur 2/i
        assert_text asked
        play_chord(chord)
      end
    end

    assert_text 'Renforcement terminé'
    assert_selector '.pt-modal-stat strong', text: '4 sur 4'
  end

  # Left on a step for one hand, the drill gives the other back.
  def test_a_drill_left_on_one_hand_gives_the_other_back
    open_score('one-hand-rest-measure')
    reinforce_bars(1..3)
    assert_hands right: true, left: false

    click_on 'Libre'
    assert_hands right: true, left: true, set_by_the_drill: false
    assert_no_selector '.pt-ladder__step'
    assert_no_selector '.pt-hand-left-out', visible: :all
  end

  private

  # The hands ticked, which a drill sets itself: the boxes are then no longer
  # the player's to change.
  def assert_hands(right:, left:, set_by_the_drill: true)
    assert_field 'Main droite', checked: right, disabled: set_by_the_drill
    assert_field 'Main gauche', checked: left, disabled: set_by_the_drill
  end

  # The row of steps the band shows, a pip each named by its title. Counted
  # first, which waits for the row to be up: Alpine fills it at once and
  # reveals it a timer later, and a step read in between is not yet visible,
  # so the list came back a step short.
  def assert_steps(*names)
    assert_selector '.pt-ladder__step', count: names.size
    assert_equal names, all('.pt-ladder__step').map { |step| step[:title] }
  end

  # The step under way, lit in the row, `done` of them behind it, and what the
  # board names as being played: the step, or the hand it stepped down to.
  def assert_on_step(name, done:, playing: name)
    assert_selector '[data-testid=board-step] .pt-tile__value', exact_text: playing
    assert_selector ".pt-ladder__step.is-now[title='#{name}']", count: 1
    assert_selector '.pt-ladder__step.is-done', count: done
  end

  # The three bars with both hands.
  def play_both_hands
    play_chord(%w[E5 C3])
    assert_selector 'svg .vf-notehead.played-note', count: 2
    play_note('D3')
    play_chord(%w[G5 E3])
  end

  # Bars 1 to 3 of repeat-endings.xml, a whole note each.
  BARS = %w[C4 D4 E4].freeze

  # The parked clock taken to `ms` since the first call of the test.
  def at(ms)
    @elapsed ||= 0
    advance_clock(ms - @elapsed)
    @elapsed = ms
  end

  # Each note played at its instant, [[note, ms]…], on that same clock.
  def play_at(timeline)
    timeline.each do |note, ms|
      at(ms)
      play_note(note)
    end
  end
end
