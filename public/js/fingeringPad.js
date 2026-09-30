// The fingering pad: a click on a note opens it, digits pressed or typed build
// the fingering, ✓ files it and × clears the note's. A mixin the score page's
// component spreads (app.js), as it does headerMenu(): the component provides
// `scoreUrl`, `fingeringEnabled` and `rerenderScore()`.
import { noteLabel } from './noteExtraction.js'

export function fingeringPad({ storage, fingeringEditor }) {
  // The pad's own keys while it is open. Kept here rather than on the
  // component, which would make a listener reactive state.
  let onKeydown = null

  return {
    showFingeringModal: false,
    selectedNoteKey: null,
    selectedNoteLabel: '',
    fingeringSequence: '',

    setupFingeringHandlers() {
      if (!this.fingeringEnabled) return
      fingeringEditor.setupFingeringClickHandlers({
        onNoteClick: (noteData) => this.openFingeringModal(noteData),
      })
    },

    openFingeringModal(noteData) {
      this.selectedNoteKey = noteData.fingeringKey
      // A click resolves to one notehead, chord or not, so the pad's title names
      // a single note.
      this.selectedNoteLabel = noteLabel(noteData)
      this.fingeringSequence = ''
      this.showFingeringModal = true

      onKeydown = (e) => {
        if (e.key >= '1' && e.key <= '5') {
          e.preventDefault()
          this.appendFinger(parseInt(e.key, 10))
        } else if (e.key === 'Backspace') {
          e.preventDefault()
          this.fingeringSequence = this.fingeringSequence.slice(0, -1)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          this.validateFingering()
        } else if (e.key === 'Escape') {
          this.closeFingeringModal()
        }
      }
      document.addEventListener('keydown', onKeydown)
    },

    appendFinger(digit) {
      this.fingeringSequence += digit
    },

    closeFingeringModal() {
      this.showFingeringModal = false
      document.removeEventListener('keydown', onKeydown)
    },

    async validateFingering() {
      if (!this.fingeringSequence) return
      await this.selectFingering(parseInt(this.fingeringSequence, 10))
    },

    // The pad closes last, once the fingering is stored and drawn: its closing
    // is what says the entry is done (the browser tests wait on it).
    async selectFingering(finger) {
      await storage.setFingering(this.scoreUrl, this.selectedNoteKey, finger)

      // Try to update SVG directly if fingering already exists (instant update)
      if (!fingeringEditor.updateFingeringSVG(this.selectedNoteKey, finger)) {
        // No existing SVG: inject into OSMD's data model and do a light re-render
        // (skips XML fetch/parse/load — just layout recalc + SVG redraw)
        fingeringEditor.addFingeringToDataModel(this.selectedNoteKey, finger)
        this.rerenderScore()
      }
      this.closeFingeringModal()
    },

    async removeFingering() {
      await storage.removeFingering(this.scoreUrl, this.selectedNoteKey)
      fingeringEditor.removeFingeringFromDataModel(this.selectedNoteKey)
      this.rerenderScore()
      this.closeFingeringModal()
    },
  }
}
