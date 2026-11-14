require_relative 'test_helper'

# The ladder a reinforcement takes each passage up (ladder.js): a hand alone,
# the other, the two together, then at the pace of the runs — the hands set by
# the drill, step by step, and given back as it ends.
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
    assert_text 'Passage 1 sur 1 · Main droite seule'
    assert_hands right: true, left: false
    assert_selector '.pt-hand-left-out', visible: :all

    play_notes(RIGHT)
    assert_on_step 'Main gauche', done: 1
    assert_text 'Main gauche seule'
    assert_hands right: false, left: true

    # Each hand alone fills no dot: the passage as written does.
    play_notes(LEFT)
    assert_on_step 'Deux mains', done: 2
    assert_text 'Les deux mains, à votre rythme'
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
    assert_on_step 'Deux mains', done: 2

    play_notes(LEFT)
    assert_hands right: true, left: true
    assert_text 'Les deux mains, à votre rythme'
    play_both_hands
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  # Once built, the passage is asked for the pace of the runs: a clean
  # repetition under it fills no dot and is told how far off it was — until the
  # third, which passes whatever its pace. Three bars of whole notes for one
  # hand, asked for at 2 s a whole note: ♩ = 120.
  def test_a_passage_built_is_asked_for_the_pace_of_the_runs
    open_score('repeat-endings', 4)
    reinforce_bars(1..3, pace: 2_000)
    assert_steps 'Sans tempo', 'Au tempo', 'À froid'
    assert_text 'Passage 1 sur 1 · À votre rythme'

    with_clock_control do
      play_repetition(gap: 3_000)
      assert_selector 'svg circle.repeat-indicator.filled', count: 1
      assert_text 'Au tempo de vos jeux complets (♩ = 120)'

      play_repetition(gap: 3_000)
      assert_text 'Propre, mais à ♩ = 80 : visez ♩ = 120.'
      assert_selector 'svg circle.repeat-indicator.filled', count: 1

      play_repetition(gap: 1_500)
      assert_selector 'svg circle.repeat-indicator.filled', count: 2
      assert_text 'Une dernière fois, à froid, au tempo (♩ = 120).'

      2.times { play_repetition(gap: 3_000) }
      assert_selector 'svg circle.repeat-indicator.filled', count: 2
      play_repetition(gap: 3_000)
    end
    assert_text 'Renforcement terminé'
  end

  # A turn that starts with one hand is no try at the passage: only those
  # played cold as the drill asks for it say whether it is learnt. Two
  # passages, bars 1 and 3: the second and third turn of each.
  def test_only_a_turn_played_cold_counts_as_a_first_try
    open_score('one-hand-rest-measure')
    reinforce_bars(1, 3)

    [%w[E5 C3], %w[G5 E3]].each_with_index do |(right, left), i|
      assert_text "Passage #{i + 1} sur 2 · Main droite seule"
      assert_hands right: true, left: false
      play_note(right)
      assert_hands right: false, left: true
      play_note(left)
      assert_hands right: true, left: true
      play_chord([right, left])
    end
    ['Encore une fois', 'Une dernière fois'].each do |asked|
      [%w[E5 C3], %w[G5 E3]].each_with_index do |chord, i|
        assert_text "Passage #{i + 1} sur 2 · #{asked}"
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

  # The row of steps the band shows. Counted first, which waits for the row to
  # be up: Alpine fills it at once and reveals it a timer later, and a step
  # read in between is not yet visible, so the list came back a step short.
  def assert_steps(*names)
    assert_selector '.pt-ladder__step', count: names.size
    assert_equal names, all('.pt-ladder__step').map(&:text)
  end

  # The step under way in the row the band shows, `done` of them behind it.
  def assert_on_step(name, done:)
    assert_selector '.pt-ladder__step.is-now', text: name, count: 1
    assert_selector '.pt-ladder__step.is-done', count: done
  end

  # The three bars with both hands.
  def play_both_hands
    play_chord(%w[E5 C3])
    assert_selector 'svg .vf-notehead.played-note', count: 2
    play_note('D3')
    play_chord(%w[G5 E3])
  end

  # Bars 1 to 3 of repeat-endings.xml, a whole note each `gap` ms after the
  # one before, then the beat that takes the passage back to its top.
  def play_repetition(gap:)
    play_evenly(%w[C4 D4 E4], gap: gap)
    advance_clock(300)
  end
end
