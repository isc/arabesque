import { t } from './i18n.js'

let state = {
  cassettes: [],
  selectedCassette: '',
  isReplaying: false,
}

let callbacks = {
  onReplayStart: null,
  onReplayEnd: null,
}

export function initCassettes() {
  return {
    loadCassettesList,
    saveCassette,
    replayCassette,
    setCallbacks,
    getState: () => state,
  }
}

function setCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs }
}

async function loadCassettesList() {
  try {
    const response = await fetch('/api/cassettes')
    if (!response.ok) {
      state.cassettes = []
      return { success: false, cassettes: [] }
    }
    state.cassettes = await response.json()
    return { success: true, cassettes: state.cassettes }
  } catch (error) {
    console.error('Erreur lors du chargement des cassettes:', error)
    state.cassettes = []
    return { success: false, cassettes: [] }
  }
}

async function saveCassette(name, recordingData) {
  try {
    const response = await fetch('/api/cassettes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        data: recordingData,
      }),
    })

    if (response.ok) {
      await loadCassettesList()
      return { success: true, name }
    } else {
      const error = await response.json()
      return { success: false, error: error.error }
    }
  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error)
    return {
      success: false,
      error: t('errors.cassetteSave'),
    }
  }
}

async function replayCassette(cassetteFile, midiParser) {
  if (!cassetteFile) return

  state.isReplaying = true
  if (callbacks.onReplayStart) {
    callbacks.onReplayStart()
  }

  try {
    const response = await fetch(`/${cassetteFile}`)
    const cassette = await response.json()

    // Replay each MIDI message with proper timing
    for (let i = 0; i < cassette.data.length; i++) {
      const message = cassette.data[i]

      if (i > 0) {
        const delay = message.timestamp - cassette.data[i - 1].timestamp
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }

      const uint8Array = new Uint8Array(message.data)
      midiParser(uint8Array, true)
    }
  } catch (error) {
    console.error('Erreur lors du rejeu:', error)
  }

  state.isReplaying = false
  if (callbacks.onReplayEnd) {
    callbacks.onReplayEnd()
  }
}
