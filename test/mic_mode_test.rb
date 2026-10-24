require_relative 'test_helper'

# Mic mode: a pitch heard through the microphone plays the score as a key
# press would. The microphone is an oscillator here, so what this exercises is
# the wiring — getUserMedia, pitch detection, the note engine — and not the
# quality of the detection, which test/js/pitchDetection.test.js covers.
class MicModeTest < CapybaraTestBase
  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/score.html'
    # getUserMedia answered by a sine wave the test tunes, silent until then.
    page.execute_script(<<~JS)
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext()
        const tone = context.createOscillator()
        const level = context.createGain()
        level.gain.value = 0
        const destination = context.createMediaStreamDestination()
        tone.connect(level).connect(destination)
        tone.start()
        window.__sing = (hz) => { tone.frequency.value = hz; level.gain.value = 0.5 }
        return destination.stream
      }
    JS
  end

  def test_notes_sung_into_the_microphone_play_the_score
    load_score('simple-score.xml', 4)
    # The test environment connects the mock keyboard, which hides the mic
    # button: take it away as a keyboard switched off would.
    page.execute_script('Alpine.$data(document.documentElement).bluetoothConnected = false')
    click_on '🎤 Mode micro'
    assert_button '🎤 Micro actif'

    sing('C4')
    assert_selector 'svg g.vf-notehead.played-note', count: 1
    sing('E4') # legato: the new pitch takes over, releasing the old one
    assert_selector 'svg g.vf-notehead.played-note', count: 2

    click_on '🎤 Micro actif'
    assert_button '🎤 Mode micro'
  end

  private

  def sing(note)
    _, midi_note, = parse_midi_notation("ON #{note}")
    page.execute_script("window.__sing(#{440 * 2**((midi_note - 69) / 12.0)})")
  end
end
