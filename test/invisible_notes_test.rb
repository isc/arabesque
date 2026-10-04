require_relative 'test_helper'

# What becomes of the notes a score hides with print-object="no", once OSMD has drawn
# them transparent and the app has had its say (fixUpInvisibleNotes in musicxml.js).
class InvisibleNotesTest < CapybaraTestBase
  def setup
    visit '/score.html'
  end

  def test_a_hidden_note_sharing_its_head_with_a_unison_lets_the_visible_head_serve_both
    load_score('hidden-unison-notehead.xml', 4)

    # Four notes, three heads with ink: the hidden quaver's head sits on the minim's,
    # transparent, and the triplet's beam starts from the minim's head.
    assert_selector 'svg g.vf-notehead path:not([fill="#00000000"])', count: 3
    assert_selector 'svg g.vf-notehead path[fill="#00000000"]', count: 1

    # The single keypress that validates the pitch colours the head both voices share.
    play_note('F#3')
    assert_selector 'svg g.vf-notehead.played-note path:not([fill="#00000000"])', count: 1
  end

  def test_a_hidden_note_whose_head_is_merged_with_its_unison_stays_invisible
    load_score('hidden-unison-merged-notehead.xml', 7)

    # Eight notes, seven heads with ink: VexFlow put the hidden quaver's head right on the
    # dotted minim's, and inking it would fill the minim's open head.
    assert_selector 'svg g.vf-notehead path:not([fill="#00000000"])', count: 7
    assert_selector 'svg g.vf-notehead path[fill="#00000000"]', count: 1
  end

  def test_a_hidden_note_with_no_unison_to_stand_in_for_it_stays_invisible
    # The Pathétique's gruppetto: the turn's realized notes are written as hidden notes
    # in a second voice, and nothing visible sounds with them. They must stay unseen --
    # the app expands the turn symbol itself, so drawing them would double the ornament.
    load_score('turn-with-hidden-realization.xml', 7)

    assert_selector 'svg g.vf-notehead path[fill="#00000000"]', count: 5
  end
end
