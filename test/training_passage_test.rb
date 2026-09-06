require_relative 'test_helper'

# Training mode works a *passage*: one measure by default — the historical
# behaviour, covered in arabesque_test.rb — or a range picked with 🔁, whose
# measures are then drilled as one so the joins between them are part of what
# has to come out clean.
#
# two-measures.xml is one whole note per bar (C4 then D4), which makes a
# traversal of the passage exactly two keypresses.
class TrainingPassageTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_a_picked_passage_is_drilled_as_one_and_says_so
    open_two_measures
    enter_training_mode
    pick_passage(1, 2)

    assert_text 'Mesures 1 à 2 : le passage entier doit être joué 3× sans erreur.'
    # The whole passage is shaded, the measure under the cursor more strongly.
    assert_selector 'svg rect.measure-click-area.training-range', count: 2
    assert_selector 'svg rect.measure-click-area.selected', count: 1

    # Two clean traversals bank two dots — one each, not one per measure, which
    # is what makes the passage the unit of work.
    play_passage
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
    play_passage
    assert_selector 'svg circle.repeat-indicator.filled', count: 2

    play_note('C4')
    wait_for_training_cursor(2)
    play_note('D4')
    assert_text 'Vous avez enchaîné les mesures 1 à 2 3× sans erreur.'
  end

  def test_a_wrong_note_in_the_second_measure_spoils_the_whole_passage
    open_two_measures
    enter_training_mode
    pick_passage(1, 2)

    play_note('C4')
    wait_for_training_cursor(2)
    # The first bar came out clean; fumbling the second one still costs the
    # repetition, because the repetition is the passage.
    play_note('E4')
    assert_selector 'svg circle.repeat-indicator.spoiled', count: 1

    play_note('D4')
    wait_for_training_cursor(1)
    assert_no_selector 'svg circle.repeat-indicator.filled'
  end

  # The passage changes what a repetition is; it does not change what the
  # journal stores. Each measure is still filed on its own merits, or the
  # measures the app offers to reinforce would follow the passage rather than
  # the playing.
  def test_each_measure_of_a_passage_is_filed_on_its_own_merits
    visit '/score.html?url=/test-fixtures/two-measures.xml'
    wait_for_score_render(2)
    enter_training_mode
    pick_passage(1, 2)

    play_note('C4')
    wait_for_training_cursor(2)
    play_note('E4')
    play_note('D4')
    wait_for_training_cursor(1)

    wait_for_records('sessions', where: <<~JS.strip)
      record.measures.some((m) => m.sourceMeasureIndex === 0 && m.attempts.some((a) => a.clean === true))
      && record.measures.some((m) => m.sourceMeasureIndex === 1 && m.attempts.some((a) => a.clean === false && a.wrongNotes === 1))
    JS
  end

  def test_turning_the_passage_off_puts_the_work_back_on_one_measure
    open_two_measures
    enter_training_mode
    pick_passage(1, 2)
    assert_selector 'svg rect.measure-click-area.training-range', count: 2

    click_on '🔁 Boucle'
    assert_text 'Chaque mesure doit être jouée 3× sans erreur.'
    # Nothing is shaded once the passage is off: the work is back on the single
    # measure under the cursor, and `selected` is what says where that is.
    assert_no_selector 'svg rect.measure-click-area.training-range'
    assert_selector 'svg rect.measure-click-area.selected', count: 1
  end

  private

  # Uploaded rather than opened by URL: only the test that reads the journal
  # back needs a score id.
  def open_two_measures
    visit '/score.html'
    load_score('two-measures.xml', 2)
  end

  def enter_training_mode
    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'
    assert_selector 'svg rect.measure-click-area.selected'
  end

  # The gesture: 🔁, then the first bar of the passage and its last.
  def pick_passage(first, last)
    click_on '🔁 Boucle'
    assert_text 'Cliquez sur la première puis la dernière mesure du passage à travailler.'
    click_measure(first)
    assert_text 'cliquez sur la dernière mesure du passage'
    click_measure(last)
  end

  # The cursor moves a beat after the measure is finished (the engine pauses so
  # the dot can be seen filling), so the next note has to wait for it — playing
  # into a measure the cursor has not reached yet would count as a wrong note.
  def wait_for_training_cursor(measure_number)
    assert_selector %(svg rect.measure-click-area.selected[data-measure-index="#{measure_number - 1}"])
  end

  def play_passage
    play_note('C4')
    wait_for_training_cursor(2)
    play_note('D4')
    wait_for_training_cursor(1)
  end
end
