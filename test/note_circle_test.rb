require_relative 'test_helper'

# A note to watch, circled from the fingering pad with a few words to remember
# it by (noteCircles.js). It is kept by its note and drawn from it at every
# redraw, so each test checks the ring against the notehead it stands on, as
# drawn now, rather than against where it was drawn first.
class NoteCircleTest < CapybaraTestBase
  SCORE_URL = '/test-fixtures/simple-score.xml'
  # Two staves, their first beat a chord of G4 and C5 over an E4, fingered 5, 3
  # and 1 above the treble staff; C3 under the bass staff, fingered below it.
  STACKED_URL = '/test-fixtures/two-voice-fingerings.xml'
  REMINDER = 'Un rappel (facultatif)'

  def test_a_circled_note_keeps_its_reminder_through_a_reload
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render(4)

    circle_note(1, 'fa, pas fa♯')
    assert_circle_on 1, 'fa, pas fa♯'

    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render(4)
    assert_circle_on 1, 'fa, pas fa♯'
  end

  # Reopened on a circled note, the pad shows its reminder to rewrite, keeps
  # what was written however it closes — the ✕ included, which is where an
  # iPad's keyboard leaves the player's finger — and takes the circle off.
  def test_the_reminder_is_rewritten_emptied_and_the_circle_taken_off
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render(4)
    circle_note(0, 'lent')

    open_fingering_pad(0)
    assert_field REMINDER, with: 'lent'
    find_field(REMINDER).set('plus lent')
    click_on 'Close'
    assert_no_selector 'dialog#fingeringModal[open]'
    assert_circle_on 0, 'plus lent'

    open_fingering_pad(0)
    clear_field(REMINDER)
    click_button '✓ Valider'
    assert_no_selector 'dialog#fingeringModal[open]'
    assert_circle_on 0, nil

    open_fingering_pad(0)
    click_button 'Retirer le cercle'
    assert_no_selector 'dialog#fingeringModal[open]'
    assert_no_selector 'svg g.pt-circle'

    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render(4)
    assert_no_selector 'svg g.pt-circle'
    open_fingering_pad(0)
    assert_button '⭕ Entourer'
  end

  # A fingering entered where there was none redraws the whole score, and a
  # window resized lays it out again: the ring follows its note through both.
  def test_a_circle_follows_its_note_through_a_redraw_and_a_relayout
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_score_render(4)
    circle_note(2, 'fa')

    enter_fingering(3, 4)
    assert_selector 'svg g.vf-text', text: '4'
    assert_circle_on 2, 'fa'

    first_x = notehead_box(2)['x']
    page.current_window.resize_to(500, 900)
    wait_until('the score to be laid out again') { notehead_box(2)['x'] != first_x }
    assert_circle_on 2, 'fa'
  end

  # A reminder goes beside its staff clear of the fingerings there, its own
  # note's included, and the training dots go over it.
  def test_a_reminder_clears_the_fingerings_and_the_training_dots_clear_it
    visit "/score.html?url=#{STACKED_URL}"
    wait_for_score_render
    circle_note(first_beat_notehead(0, -1), 'attention : fa naturel')
    circle_note(first_beat_notehead(1, 0), 'pouce')
    assert_selector 'svg g.pt-circle text', count: 2

    reminders = boxes('svg g.pt-circle text')
    boxes('svg g.vf-text text').each do |fingering|
      reminders.each { |reminder| refute overlap?(reminder, fingering), "a reminder covers a fingering: #{reminder} #{fingering}" }
    end

    # Measured again: the training band comes in over the score and moves it down.
    enter_training_mode
    dots = boxes('#repeat-indicators').first
    top_reminder = boxes('svg g.pt-circle text').min_by { |box| box['y'] }
    assert_operator dots['x'], :<, top_reminder['x'] + top_reminder['width'], 'the dots are over the reminder'
    assert_operator dots['x'] + dots['width'], :>, top_reminder['x'], 'the dots are over the reminder'
    assert_operator dots['y'] + dots['height'], :<=, top_reminder['y']
  end

  private

  # Circles `notehead` from the pad, with `reminder` written in, and returns
  # once the pad has closed: by then the circle is stored and drawn.
  def circle_note(notehead, reminder)
    open_fingering_pad(notehead)
    click_button '⭕ Entourer'
    assert_selector 'svg g.pt-circle'
    find_field(REMINDER).set(reminder)
    click_button '✓ Valider'
    assert_no_selector 'dialog#fingeringModal[open]'
  end

  # One circle on the score, ringing the notehead at `index` as it is drawn
  # now, and carrying `reminder` (nil for none).
  def assert_circle_on(index, reminder)
    assert_selector 'svg g.pt-circle ellipse', count: 1
    if reminder
      assert_selector 'svg g.pt-circle text', exact_text: reminder
    else
      assert_no_selector 'svg g.pt-circle text'
    end
    head = notehead_box(index)
    ring = boxes('svg g.pt-circle ellipse').first
    assert_operator ring['x'], :<, head['x']
    assert_operator ring['y'], :<, head['y']
    assert_operator ring['x'] + ring['width'], :>, head['x'] + head['width']
    assert_operator ring['y'] + ring['height'], :>, head['y'] + head['height']
  end

  def notehead_box(index)
    boxes('svg g.vf-notehead')[index]
  end

  # The boxes the page draws `selector` in, in viewport pixels.
  def boxes(selector)
    page.evaluate_script(<<~JS)
      [...document.querySelectorAll(#{selector.to_json})].map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      })
    JS
  end

  def overlap?(a, b)
    a['x'] < b['x'] + b['width'] && b['x'] < a['x'] + a['width'] &&
      a['y'] < b['y'] + b['height'] && b['y'] < a['y'] + a['height']
  end
end
