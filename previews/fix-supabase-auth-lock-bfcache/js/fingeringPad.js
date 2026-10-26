// The fingering pad: a click on a note opens it, digits pressed or typed build
// the fingering, ✓ files it and × clears the note's. It also circles the note
// (noteCircles.js), with a few words to remember it by, or takes the circle
// off. A mixin the score page's component spreads (app.js), as it does
// headerMenu(): the component provides `scoreUrl` — a score opened from disk
// has none, and takes no fingerings — `rerenderScore()` and `repaintScore()`,
// and calls setupFingeringHandlers() after every redraw.
import { noteLabel } from './noteExtraction.js'

export function fingeringPad({ storage, fingeringEditor, noteCircles }) {
  // The pad's own keys while it is open, null once it is closing. Kept here
  // rather than on the component, which would make a listener reactive state.
  let onKeydown = null

  return {
    showFingeringModal: false,
    selectedNoteKey: null,
    selectedNoteLabel: '',
    fingeringSequence: '',
    // The selected note's reminder as stored, null while it is not circled,
    // and as the field shows it.
    selectedCircle: null,
    circleText: '',

    setupFingeringHandlers() {
      if (!this.scoreUrl) return
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
      this.selectedCircle = noteCircles.get(this.selectedNoteKey)
      this.circleText = this.selectedCircle ?? ''
      this.showFingeringModal = true

      onKeydown = (e) => {
        // The reminder's field types its own keys, Enter and Escape included
        // (bound on the field and the dialog).
        if (e.target.closest?.('input')) return
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

    // However it closes, the pad keeps the reminder as the field last showed
    // it: written on an iPad, it would otherwise go with a tap on the ✕. Once
    // only: Escape reaches both the dialog and the pad's keys.
    async closeFingeringModal() {
      if (!onKeydown) return
      document.removeEventListener('keydown', onKeydown)
      onKeydown = null
      await this.saveCircleText()
      this.showFingeringModal = false
    },

    // ✓ files the fingering typed, if any, and closes the pad either way.
    async validateFingering() {
      if (!this.fingeringSequence) return this.closeFingeringModal()
      await this.selectFingering(parseInt(this.fingeringSequence, 10))
    },

    // The pad closes last, once the fingering is stored and drawn: its closing
    // is what says the entry is done (the browser tests wait on it).
    async selectFingering(finger) {
      await storage.fingerings.set(this.scoreUrl, this.selectedNoteKey, finger)

      fingeringEditor.setFingeringInDataModel(this.selectedNoteKey, finger)
      // Rewrite the label in place when the note has one, or redraw (which skips
      // the XML fetch/parse/load)
      if (!fingeringEditor.updateFingeringSVG(this.selectedNoteKey, finger)) this.rerenderScore()
      await this.closeFingeringModal()
    },

    async removeFingering() {
      await storage.fingerings.remove(this.scoreUrl, this.selectedNoteKey)
      fingeringEditor.removeFingeringFromDataModel(this.selectedNoteKey)
      this.rerenderScore()
      await this.closeFingeringModal()
    },

    // Circled at once, with no reminder yet: the ring shows on the score, and
    // the field for the reminder takes the place of the button.
    async circleNote() {
      await this.storeCircle('')
      await this.$nextTick()
      this.$refs.circleText?.focus()
    },

    async saveCircleText() {
      const text = this.circleText.trim()
      if (this.selectedCircle !== null && text !== this.selectedCircle) await this.storeCircle(text)
    },

    async storeCircle(text) {
      await storage.circles.set(this.scoreUrl, this.selectedNoteKey, text)
      noteCircles.set(this.selectedNoteKey, text)
      this.selectedCircle = text
      this.repaintScore()
    },

    async removeCircle() {
      await storage.circles.remove(this.scoreUrl, this.selectedNoteKey)
      noteCircles.remove(this.selectedNoteKey)
      this.selectedCircle = null
      this.repaintScore()
      await this.closeFingeringModal()
    },
  }
}
