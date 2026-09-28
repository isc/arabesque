// Mock for Web MIDI API used in tests

// What the mock calls itself: the truth in a test. scripts/demo/capture.sh
// rewrites this line in its throwaway copy of the site, so a store screenshot
// names a real keyboard; test/js/demoCapture.test.js keeps the two in step.
export const MOCK_DEVICE_NAME = 'Mock MIDI Keyboard'

const mockMIDI = {
  // A Uint8Array, as the Web MIDI API hands over a message.
  connect: (callback) => window.addEventListener('mock-midi-input', (e) => callback(new Uint8Array(e.detail.data))),
}

export default mockMIDI
