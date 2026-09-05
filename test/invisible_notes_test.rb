require_relative 'test_helper'

# What becomes of the notes a score hides with print-object="no", once OSMD has drawn
# them transparent and the app has had its say (fixUpInvisibleNotes in musicxml.js).
class InvisibleNotesTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_a_hidden_note_sharing_its_head_with_a_unison_keeps_its_notehead
    load_score('hidden-unison-notehead.xml', 4)

    # Four notes, four heads with ink in them: the hidden quaver's head is drawn too,
    # since VexFlow could not merge it into the minim's and its beam needs a head.
    assert_selector 'svg g.vf-notehead path:not([fill="#00000000"])', count: 4

    # Its ink lives in the minim's notehead group, so the single keypress that validates
    # the pitch colours both heads at once.
    play_note('F#3')
    assert_selector 'svg g.vf-notehead.played-note path', count: 2
  end

  def test_a_hidden_note_with_no_unison_to_stand_in_for_it_stays_invisible
    # The Pathétique's gruppetto: the turn's realized notes are written as hidden notes
    # in a second voice, and nothing visible sounds with them. They must stay unseen --
    # the app expands the turn symbol itself, so drawing them would double the ornament.
    load_score('turn-with-hidden-realization.xml', 7)

    assert_selector 'svg g.vf-notehead path[fill="#00000000"]', count: 5
  end
end
