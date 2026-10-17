require_relative 'test_helper'

# Every key played is logged with what the score made of it (noteLog.js), and
# written with the session it belongs to when that session is filed.
# two-measures.xml is a whole note per bar, C4 then D4.
class NoteLogTest < CapybaraTestBase
  def test_a_run_logs_each_key_with_the_note_it_took_or_was_owed
    open_two_measures
    send_midi([176, 64, 127]) # the sustain pedal down
    play_note('C4')
    play_note('E4') # D4 is owed
    play_note('D4') # the run is over, and filed with its notes
    assert_selector 'dialog[open]'

    # Pedal, C4 down and up, E4 wrong for the D4 of bar 2 and up, D4 down.
    wait_for_records('noteLogs', where: <<~JS.strip)
      record.e === 'pduwud'
        && record.p.join() === '127,60,60,64,64,62'
        && record.v.join() === '0,80,0,80,0,80'
        && record.b.join() === '-1,0,-1,1,-1,1'
        && record.keys.length === 2
        && record.n[3] === record.n[5] && record.n[1] !== record.n[3]
    JS
  end
end
