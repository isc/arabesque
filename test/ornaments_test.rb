require_relative 'test_helper'

class OrnamentsTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
  end

  def test_grace_notes_played_sequentially_before_main_note
    # Grace notes (ornaments) are played quickly before the main note.
    # They should be validated sequentially, NOT held together with the main note.
    # Score has: E4 (grace) -> F4 (grace) -> G4 (main)
    load_score('grace-note.xml', 3)

    # Play grace note E4 first
    play_note('E4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1

    # Play grace note F4 second
    play_note('F4')
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    # Play main note G4 last
    play_note('G4')
    assert_selector 'svg g.vf-notehead.played-note', count: 3

    # Score should be completed
    assert_text 'Partition terminée'
  end

  def test_turn_ornament_notes_expanded_sequentially
    # Tests two turns in Eb major:
    # 1. C5 with accidentals (Db above, B natural below): C5, Db5, C5, B4, C5
    #    → Verifies accidentals override diatonic intervals
    # 2. Eb5 without accidentals: F5, Eb5, D5, Eb5
    #    → Verifies diatonic intervals respect key signature (Nocturne bug fix)
    #    → D5 is 1 semitone below Eb, NOT Db which would be 2 semitones
    load_score('turn-ornament.xml', 3)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Delayed turn on C5 with accidentals: main, upper (Db), main, lower (B), main
    play_note("C5")
    play_note("Db5")
    play_note("C5")
    play_note("B4")
    play_note("C5")

    # Regular turn on Eb5 without accidentals: upper (F), main, lower (D), main
    play_note("F5")
    play_note("Eb5")
    play_note("D5")   # Diatonic lower, NOT Db!
    play_note("Eb5")

    # Final note G5
    play_note("G5")

    # Should have 1 filled repeat indicator (clean repetition)
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_delayed_turn_lets_left_hand_interleave
    # A delayed turn holds its principal on the beat and plays the turn proper into
    # the final sixteenth of the note (the Pathétique-style realization). The inner
    # left-hand sixteenths therefore fall BETWEEN the held principal and the turn and
    # must be playable in between -- not after the whole gruppetto.
    #
    # RH: C5 quarter (delayed turn -> D5, C5, B4, C5), then G5 quarter.
    # LH: four C3 sixteenths, then a C3 quarter.
    load_score('delayed-turn-accompaniment.xml', 7)

    # Beat 1, sixteenth 1: the principal C5 is struck on the beat with the 1st LH note.
    play_chord(['C5', 'C3'])

    # Beat 1, sixteenths 2 and 3: the principal is held while the left hand continues.
    # Before the delayed-turn timing fix the engine demanded the whole turn here, so
    # these left-hand notes would have been rejected and the score never completed.
    play_note('C3')
    play_note('C3')

    # Beat 1, sixteenth 4: the turn begins, together with the 4th LH note...
    play_chord(['D5', 'C3'])
    # ...then the rest of the turn.
    play_note('C5')
    play_note('B4')
    play_note('C5')

    # Beat 2.
    play_chord(['G5', 'C3'])

    assert_text 'Partition terminée'
  end

  def test_mordent_notes_expanded_sequentially
    # Tests both regular and inverted mordents in the same measure:
    # - Regular mordent on C5: C5, B4, C5 (3 notes - diatonic lower note)
    # - Inverted mordent on E5: E5, F5, E5 (3 notes - diatonic upper note)
    # - Final note: G5
    # Visual notes: 3 (C5, E5, G5), but validation expects 7 notes total
    #
    # Mordents use diatonic intervals (follow the scale), not fixed semitone offsets.
    # In C major: C→B is 1 semitone, E→F is 1 semitone.
    #
    # In training mode, playing the correct sequences should result in a
    # clean repetition (filled circle).
    load_score('mordent-ornament.xml', 3)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Regular mordent on C5: main, lower (diatonic = B4), main
    play_note("C5")
    play_note("B4")
    play_note("C5")

    # Inverted mordent on E5: main, upper (diatonic = F5), main
    play_note("E5")
    play_note("F5")
    play_note("E5")

    # Final note G5
    play_note("G5")

    # Should have 1 filled repeat indicator (clean repetition)
    # This proves both mordent types were expanded and validated correctly
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_mordent_takes_an_accidental_earlier_in_the_measure
    # C minor: E natural, then a mordent on F with nothing on the sign. The
    # natural holds to the end of the measure, so the mordent dips to E natural
    # -- not to the E flat of the key (Bach's C minor prelude, bar 34).
    load_score('mordent-after-accidental.xml', 3)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    play_note("E4")
    play_note("F4")
    play_note("E4")   # E natural, NOT Eb
    play_note("F4")
    play_note("G4")

    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_trill_wrong_note_marks_dirty_then_clean_rep_fills_circle
    # Trill on Ab4 in Eb major: minimum sequence is Ab4, Bb4, Ab4 (+ sentinel)
    # The upper note is Bb4 (not B natural) because B is flatted in Eb major.
    # Playing the next real note (Eb5) ends the trill and advances.
    # Score has: Ab4 (trill) -> Eb5, so 2 visual notes
    load_score('trill-ornament.xml', 2)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # First repetition: trill with a wrong note
    play_note("Ab4")
    play_note("Bb4")  # Diatonic upper in Eb major, NOT B natural
    play_note("Ab4")
    play_note("G4")   # Wrong note (not trill note, not Eb5)
    play_note("Eb5")  # Finish the measure

    # First repetition complete but dirty (wrong note played) → no filled circle
    assert_no_selector 'svg circle.repeat-indicator.filled'

    # Wait for measure reset (played-note classes removed for next repetition)
    assert_no_selector 'svg g.vf-notehead.played-note'

    # Second repetition: clean trill
    play_note("Ab4")
    play_note("Bb4")
    play_note("Ab4")
    play_note("Eb5")

    # Dirty rep unfilled, clean rep filled → only 1 filled circle
    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_trill_extended_sequence_then_next_note
    # Same trill (Ab4 in Eb major), but the player trills longer before moving on.
    load_score('trill-ornament.xml', 2)

    click_on 'Mode Entraînement'
    assert_text 'Mode Entraînement Actif'

    # Extended trill: Ab4, Bb4, Ab4, Bb4, Ab4, Bb4, Ab4
    play_note("Ab4")
    play_note("Bb4")
    play_note("Ab4")
    play_note("Bb4")
    play_note("Ab4")
    play_note("Bb4")
    play_note("Ab4")

    # End the trill with the next real note
    play_note("Eb5")

    assert_selector 'svg circle.repeat-indicator.filled', count: 1
  end

  def test_turn_with_hidden_realization_is_not_doubled
    # Beethoven's "Pathetique" encodes its turns as a <turn/> symbol AND the turn's
    # realized notes written as invisible (print-object="no") notes in a second voice.
    # The app already expands the <turn/> symbol into playable notes, so the hidden
    # copy must be ignored. Otherwise the gruppetto is doubled: the player has to play
    # it twice, and the hidden noteheads only appear (green) on the second pass.
    attach_file('musicxml-upload', File.expand_path('fixtures/turn-with-hidden-realization.xml', __dir__))
    assert_selector '#score[data-render-complete]'

    # Regular turn on C5 in C major expands to D5, C5, B4, C5. Play it ONCE, then G5.
    play_note('D5')
    play_note('C5')
    play_note('B4')
    play_note('C5')
    play_note('G5')

    # A single pass completes the score: the hidden realization was ignored, not
    # required a second time.
    assert_text 'Partition terminée'
  end
end
