require_relative 'test_helper'

class FingeringAnnotationTest < CapybaraTestBase
  SCORE_URL = '/test-fixtures/simple-score.xml'
  PICKUP_SCORE_URL = '/test-fixtures/pickup-measure-score.xml'
  CHORD_SCORE_URL = '/test-fixtures/chord.xml'
  TWO_VOICE_SCORE_URL = '/test-fixtures/two-voice-fingerings.xml'
  CHOPIN_WALTZ_URL = 'scores/Waltz_in_A_MinorChopin.mxl'

  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_clicking_chord_notes_opens_fingering_modal
    visit "/score.html?url=#{CHORD_SCORE_URL}"
    wait_for_render
    noteheads = all('svg g.vf-notehead', minimum: 3)

    # Verify clicking each notehead in the chord opens the fingering modal
    noteheads.each do |notehead|
      notehead.click
      assert_selector 'dialog#fingeringModal[open]'
      click_on 'Close'
    end
  end

  def test_add_fingering_and_persist_after_reload
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_render
    find('svg g.vf-notehead', match: :first).click
    click_button '3'
    assert_selector 'dialog#fingeringModal[open]'
    click_button '✓ Valider'
    wait_for_render
    assert_fingering '3'

    # Reload and verify persistence
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_render
    assert_fingering '3'
  end

  def test_multi_fingering
    visit "/score.html?url=#{SCORE_URL}"
    wait_for_render
    find('svg g.vf-notehead', match: :first).click
    click_button '3'
    click_button '1'
    assert_selector '[data-testid="fingering-display"]', text: '31'
    click_button '✓ Valider'
    wait_for_render
    assert_fingering '31'
  end

  def test_add_fingering_to_grace_note_appears_immediately
    visit "/score.html?url=#{CHOPIN_WALTZ_URL}"
    wait_for_render

    # Click the grace note notehead in measure 13 (SVG group #12)

    first('[id="12"] .vf-modifiers .vf-notehead').click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '3'
    click_button '✓ Valider'
    assert_no_selector 'dialog#fingeringModal[open]'

    assert_equal '3', first('[id="12"] .vf-modifiers text').text
  end

  def test_adding_fingering_does_not_break_note_validation
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    wait_for_render

    # Play C4 to complete measure 1, advancing to measure 2
    play_note('C4')

    # Now at measure 2 (D4). Add a fingering to the D4 note (no existing fingering).
    # This triggers rerenderScore() which resets currentMeasureIndex to 0.
    first('.vf-notehead').click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '3'
    click_button '✓ Valider'
    wait_for_render

    # Play D4 — should validate since we're still at measure 2
    play_note('D4')
    assert_selector '.vf-notehead.played-note', count: 2
  end

  def test_score_completion_after_adding_fingering_mid_play
    visit "/score.html?url=/test-fixtures/two-measures.xml"
    wait_for_render

    # Play C4 to complete measure 1
    play_note('C4')

    # Add a fingering to the D4 note in measure 2 — triggers rerenderScore()
    # which previously cleared playedSourceMeasures, breaking the completion check.
    all('.vf-notehead')[1].click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '3'
    click_button '✓ Valider'
    wait_for_render

    # Play D4 to finish — completion modal should appear
    play_note('D4')
    assert_text 'Partition terminée'
  end

  def test_fingering_on_pickup_measure_persists_correctly
    visit "/score.html?url=#{PICKUP_SCORE_URL}"
    wait_for_render

    # Click on the first note (in the pickup measure)
    find('svg g.vf-notehead', match: :first).click
    click_button '2'
    click_button '✓ Valider'
    wait_for_render
    assert_fingering '2'

    # Reload and verify the fingering is still on the pickup measure note
    visit "/score.html?url=#{PICKUP_SCORE_URL}"
    wait_for_render
    assert_fingering '2'

    # Verify fingering is positioned near the pickup measure (first notehead)
    first_note_x, = find('svg g.vf-notehead', match: :first).native.node.find_position
    fingering_x, = find('svg g.vf-text', text: '2').native.node.find_position

    # Fingering should be within 50px of the first note (not shifted to next measure)
    assert (fingering_x - first_note_x).abs < 50,
           "Fingering should be near the pickup measure note (x=#{first_note_x}), not shifted (fingering x=#{fingering_x})"
  end

  # The upper staff's first beat stacks fingerings coming from two voices: a chord in
  # voice 1 (G4 = 3, C5 = 5) plus a lower note in voice 2 (E4 = 1). OSMD stacks them in
  # the pitch order of their notes, so they read 5/3/1 top to bottom, while collecting
  # them voice by voice yields 3, 5, 1. Editing one rewrites its label in place (no
  # re-render), so the two orders have to agree or the digit lands on another note.
  def test_editing_a_fingering_in_a_two_voice_stack_rewrites_its_own_label
    visit "/score.html?url=#{TWO_VOICE_SCORE_URL}"
    wait_for_render
    assert_equal %w[5 3 1], first_beat_fingerings

    tag_middle_notehead_of_first_beat
    find('[data-testid="middle-notehead"]').click
    assert_selector 'dialog#fingeringModal[open]'
    click_button '2'
    click_button '✓ Valider'
    assert_no_selector 'dialog#fingeringModal[open]'

    # The 3 belongs to G4, the middle note, so only the middle label may change.
    assert_equal %w[5 2 1], first_beat_fingerings
  end

  private

  def wait_for_render
    assert_selector '#score[data-render-complete]'
  end

  def assert_fingering(text)
    assert_selector 'svg g.vf-text', text: text
  end

  # The fingering labels over the first beat of the upper staff, top to bottom
  # as they are actually rendered.
  def first_beat_fingerings
    page.evaluate_script(<<~JS)
      (() => {
        const entries = osmdInstance.graphic.MeasureList[0][0].staffEntries[0].FingeringEntries
        return entries
          .map((entry) => entry.SVGNode.querySelector('text'))
          .map((text) => ({ value: text.textContent.trim(), y: text.getBoundingClientRect().y }))
          .sort((a, b) => a.y - b.y)
          .map((label) => label.value)
      })()
    JS
  end

  # Mark the middle note by pitch (G4) so Capybara can click its notehead.
  def tag_middle_notehead_of_first_beat
    page.execute_script(<<~JS)
      (() => {
        const staffEntry = osmdInstance.graphic.MeasureList[0][0].staffEntries[0]
        const notes = staffEntry.graphicalVoiceEntries
          .flatMap((voiceEntry) => voiceEntry.notes)
          .map((graphicalNote) => graphicalNote.sourceNote)
          .sort((a, b) => a.Pitch.getHalfTone() - b.Pitch.getHalfTone())
        osmdInstance.rules
          .GNote(notes[1])
          .getSVGGElement()
          .querySelector('.vf-notehead')
          .setAttribute('data-testid', 'middle-notehead')
      })()
    JS
  end
end
