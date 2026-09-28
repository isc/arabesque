// Mock for Web MIDI API used in tests
let messageCallback = null

// What the mock calls itself: the truth in a test. scripts/demo/capture.sh
// rewrites this line in its throwaway copy of the site, so a store screenshot
// names a real keyboard; test/js/demoCapture.test.js keeps the two in step.
export const MOCK_DEVICE_NAME = 'Mock MIDI Keyboard'

const mockMIDI = {
  connect: (callback) => {
    messageCallback = callback

    // Listen for mock MIDI input events
    window.addEventListener('mock-midi-input', (e) => {
      const dataArray = e.detail.data
      if (messageCallback) {
        // Convert to Uint8Array for consistency with Web MIDI API
        const uint8Array = new Uint8Array(dataArray)
        messageCallback(uint8Array)
      }
    })

    return Promise.resolve()
  },

  disconnect: () => {
    messageCallback = null
  },
}

export default mockMIDI
