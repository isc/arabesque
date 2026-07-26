import { initMidi } from './midi.js'
import { initMusicXML } from './musicxml.js'
import { initFingeringEditor } from './fingeringEditor.js'
import { initCassettes } from './cassettes.js'
import { initPracticeTracker } from './practiceTracker.js'
import { formatDuration, formatDate, applyStickyOffset, scorePageUrl } from './utils.js'
import { initStorage } from './storage.js'
import { loadMxlAsXml } from './mxlLoader.js'
import { injectFingerings } from './fingeringInjector.js'
import { initPlayback, getBPM } from './playback.js'
import { initStrictPlaythrough } from './strictPlaythrough.js'
import { headerMenu } from './headerMenu.js'
import { traced } from './perfTrace.js' // TEMP diagnostic
import { t, locale } from './i18n.js'

// Built once: the active locale is fixed for the page lifetime (switching
// language reloads), so these don't need rebuilding per call/point.
const PLAYTHROUGH_LIST_FORMATTER = new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' })
const CHART_DATE_FULL = new Intl.DateTimeFormat(locale())
const CHART_DATE_AXIS = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })

export function midiApp() {
  const midi = initMidi()
  const musicxml = initMusicXML()
  const fingeringEditor = initFingeringEditor({
    getOsmdInstance: musicxml.getOsmdInstance,
    getAllNotes: musicxml.getAllNotes,
    getNoteDataByKey: musicxml.getNoteDataByKey,
    svgNote: musicxml.svgNote,
    svgNotehead: musicxml.svgNotehead,
  })
  const cassettes = initCassettes()
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)
  const playback = initPlayback(midi.state)
  const strictPlaythrough = initStrictPlaythrough()

  return {
    ...headerMenu(),
    bluetoothConnected: false,
    midiDeviceName: null,
    osmdInstance: null,
    isRecording: false,
    isReplaying: false,
    replayEnded: false,
    isPlaying: false,
    isStrictPlaying: false,
    // Strict mode is now decoupled from playback: selecting the tab arms
    // strict mode, the ▶/⏸ control next to it starts/stops the engine.
    strictSelected: false,
    strictStartMeasure: 0,
    strictBpm: 120,
    strictResult: null,
    cassettes: [],
    selectedCassette: '',
    cassetteApiAvailable: false,
    trainingMode: false,

    // scoreUrl is set only for scores loaded from the library, not for
    // local file uploads — the practice tracker keys on it.
    scoreUrl: null,
    scoreTitle: null,
    scoreComposer: null,

    // Set when the loaded score is one part of a collection (e.g. un
    // exercice de Hanon) — drives the part navigator in the topbar.
    collection: null,
    collectionIndex: 0,

    rightHandActive: true,
    leftHandActive: true,

    showHistoryModal: false,
    scoreHistory: [],
    historyTotalMs: 0,
    historyHotMeasures: [],
    measuresToReinforce: [],
    reinforcementMode: false,
    showMidiHelpModal: false,

    // Single result modal for end-of-playthrough (free/training), end-of-
    // strict run, and end-of-reinforcement. Body switches on resultMode.
    showResultModal: false,
    resultMode: null,
    previousPlaythroughs: [],

    fingeringEnabled: false,
    showFingeringModal: false,
    selectedNoteKey: null,
    fingeringSequence: '',
    fingeringKeydownHandler: null,

    async init() {
      playback.setOnPlaybackEnd(() => { this.isPlaying = false })

      // The sticky-bar offset feeds both scrollToMeasure (JS) and
      // scroll-margin-top (CSS, via --pt-sticky-offset). Recompute on
      // resize and when the mode-context band toggles visibility.
      applyStickyOffset()
      window.addEventListener('resize', applyStickyOffset)
      // $nextTick (not queueMicrotask) — Alpine flips x-show display on
      // the next tick, so we'd otherwise measure 0 for the band that's
      // about to appear. osmdInstance is updated via afterScoreLoad()
      // directly because $watch would deep-compare via JSON.stringify and
      // OSMD has circular references (note ↔ voiceEntry).
      this.$watch('currentMode', () => this.$nextTick(applyStickyOffset))
      this.$watch('reinforcementMode', () => this.$nextTick(applyStickyOffset))
      this.$watch('strictBpm', (v) => {
        if (this.scoreUrl && Number.isFinite(v) && v > 0) {
          localStorage.setItem(`pt:strictBpm:${this.scoreUrl}`, String(v))
        }
      })

      // loadCassettesList hits a backend endpoint, storage.init opens
      // IndexedDB — independent and OK to run in parallel. practiceTracker
      // shares the storage instance so its init just hits the same cache.
      await Promise.all([this.loadCassettesList(), storage.init()])
      await practiceTracker.init()

      await midi.connectMIDI({ silent: true, autoSelectFirst: true })
      this.syncMidiState()

      const NAVIGATE_BACK_KEY = 108 // C8 - highest piano key (less jarring sound)

      midi.setCallbacks({
        onNotePlayed: (noteName, midiNote) => {
          if (midiNote === NAVIGATE_BACK_KEY) {
            // Go back rather than to the library so its filters (stored in
            // the URL) that led here are preserved. Fall back to the library
            // if there's no in-app history to return to. Relative path: the
            // app is served statically (GitHub Pages) under a project subpath,
            // so an absolute "/library" would resolve off the base and 404.
            if (window.history.length > 1) {
              window.history.back()
            } else {
              window.location.href = 'library.html'
            }
            return
          }
          if (strictPlaythrough.isPlaying) {
            strictPlaythrough.handleNoteOn(midiNote)
            return
          }
          musicxml.activateNote(midiNote)
        },
        onNoteReleased: (noteName, midiNote) => {
          if (strictPlaythrough.isPlaying) return
          musicxml.deactivateNote(midiNote)
        },
      })

      musicxml.setCallbacks({
        onScoreCompleted: async () => {
          practiceTracker.markScoreCompleted()
          await practiceTracker.endSession()

          const allPlaythroughs = this.scoreUrl ? await practiceTracker.getAllPlaythroughs(this.scoreUrl) : []
          window.scrollTo({ top: 0, behavior: 'smooth' })
          this.showScoreComplete(allPlaythroughs)

          // Start new session for next playthrough
          const metadata = musicxml.getScoreMetadata()
          practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'free', metadata.totalMeasures)

          // Refresh reinforcement suggestions from the just-completed session
          await this.refreshReinforcementSuggestions()
        },
        onTrainingComplete: async () => {
          this.openResultModal('training')
          await practiceTracker.endSession()
          // Start new session for next playthrough
          const metadata = musicxml.getScoreMetadata()
          practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'training', metadata.totalMeasures)
        },
        onMeasureStarted: (sourceMeasureIndex) => {
          practiceTracker.startMeasureAttempt(sourceMeasureIndex)
        },
        onMeasureCompleted: (data) => {
          // TEMP: fire-and-forget, so its IndexedDB work never showed up in the
          // traced() around activateNote.
          traced('endMeasureAttempt', () => practiceTracker.endMeasureAttempt(data.clean))
        },
        onWrongNote: () => {
          practiceTracker.recordWrongNote()
        },
        onPlaythroughRestart: () => {
          practiceTracker.restartPlaythrough()
        },
        onReinforcementComplete: async () => {
          this.reinforcementMode = false
          this.trainingMode = false
          musicxml.setTrainingMode(false)
          await practiceTracker.endSession()
          this.openResultModal('reinforcement')

          // Start new free session so subsequent play is tracked
          const metadata = musicxml.getScoreMetadata()
          practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'free', metadata.totalMeasures)
        },
        onMeasureClicked: (measureIndex) => {
          // While listening, a measure click seeks playback there instead of
          // forcing a listen-from-the-top.
          if (this.isPlaying) {
            playback.seekToMeasure(measureIndex)
            return true
          }
          if (!this.strictSelected) return false
          if (this.isStrictPlaying) strictPlaythrough.stop()
          this.strictStartMeasure = measureIndex
          musicxml.markStrictStartMeasure(measureIndex)
          return true
        },
      })

      cassettes.setCallbacks({
        onReplayStart: () => {
          this.isReplaying = true
          this.replayEnded = false
        },
        onReplayEnd: () => {
          this.isReplaying = false
          this.replayEnded = true
        },
      })

      const scoreUrl = new URLSearchParams(window.location.search).get('url')
      if (scoreUrl) await this.loadScoreFromURL(scoreUrl)

      window.addEventListener('beforeunload', () => practiceTracker.endSession())
    },

    syncMidiState() {
      this.bluetoothConnected = midi.state.midiConnected
      this.midiDeviceName = midi.state.midiInput?.name || null
    },

    async connectMIDI() {
      const result = await midi.connectMIDI()
      this.syncMidiState()
      if (result?.status === 'no_devices') {
        this.showMidiHelpModal = true
      }
    },

    detectedOS() {
      const ua = navigator.userAgent
      if (/Mac/.test(ua)) return 'mac'
      if (/Win/.test(ua)) return 'windows'
      return 'other'
    },

    startRecording() {
      midi.startRecording()
      this.isRecording = true
    },

    async stopRecording() {
      const result = await midi.stopRecording()
      this.isRecording = false

      if (result) {
        const saveResult = await cassettes.saveCassette(result.name, result.data)

        if (saveResult.success) {
          alert(t('score.cassetteSaved', { name: saveResult.name }))
          await this.loadCassettesList()
        } else {
          alert(t('score.cassetteError', { error: saveResult.error }))
        }
      }
    },

    async loadCassettesList() {
      const result = await cassettes.loadCassettesList()
      this.cassetteApiAvailable = result.success
      this.cassettes = result.cassettes
    },

    async replayCassette() {
      if (!this.selectedCassette) return
      await cassettes.replayCassette(this.selectedCassette, midi.parseMidiMessage)
    },

    async loadMusicXMLFromFile(file) {
      if (!file) return
      this.fingeringEnabled = false
      this.scoreUrl = null
      await musicxml.loadMusicXML(file)
      await this.afterScoreLoad()
      this.captureScoreMetadata()
    },

    async loadScoreFromURL(url) {
      this.scoreUrl = url
      this.fingeringEnabled = true
      this.loadCollectionInfo(url) // fire-and-forget: the navigator appears when ready

      await this.renderScoreWithFingerings()
      this.captureScoreMetadata()

      const metadata = musicxml.getScoreMetadata()
      practiceTracker.startSession(url, metadata.title, metadata.composer, 'free', metadata.totalMeasures)

      // Load reinforcement suggestions from last completed playthrough
      await this.refreshReinforcementSuggestions()
    },

    // If the loaded file is one part of a collection in the catalog, expose
    // the sibling parts so the topbar can offer prev/next navigation.
    async loadCollectionInfo(url) {
      try {
        const response = await fetch('data/scores.json')
        const data = await response.json()
        for (const score of data.scores) {
          if (!Array.isArray(score.parts)) continue
          const index = score.parts.findIndex((p) => data.baseUrl + p.file === url)
          if (index === -1) continue
          this.collection = {
            title: score.title,
            parts: score.parts.map((p) => ({ ...p, url: data.baseUrl + p.file })),
          }
          this.collectionIndex = index
          return
        }
      } catch (error) {
        console.warn('Collection lookup failed:', error)
      }
    },

    gotoPart(index) {
      const part = this.collection?.parts[index]
      if (!part) return
      window.location.href = scorePageUrl(part.url)
    },

    captureScoreMetadata() {
      if (!this.osmdInstance) return
      const metadata = musicxml.getScoreMetadata()
      this.scoreTitle = metadata.title || null
      this.scoreComposer = metadata.composer || null
      if (metadata.title) {
        document.title = `${metadata.title}${metadata.composer ? ' — ' + metadata.composer : ''} · ${t('score.pageTitle')}`
      }
    },

    async renderScoreWithFingerings() {
      const { fingerings } = await storage.getFingerings(this.scoreUrl)
      const xml = await loadMxlAsXml(this.scoreUrl)
      const modified = injectFingerings(xml, fingerings)
      await musicxml.renderMusicXML(modified)
      await this.afterScoreLoad()
      this.setupFingeringHandlers()
    },

    async afterScoreLoad() {
      this.osmdInstance = musicxml.getOsmdInstance()
      // Wait for Alpine to update DOM (show #score container), then render
      await this.$nextTick()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      musicxml.renderScore()
      fingeringEditor.alignFingeringLabelsToNoteheads()
      document.getElementById('score').dataset.renderComplete = Date.now()
      const savedBpm = this.scoreUrl ? Number(localStorage.getItem(`pt:strictBpm:${this.scoreUrl}`)) : NaN
      this.strictBpm = Number.isFinite(savedBpm) && savedBpm > 0 ? savedBpm : Math.round(getBPM(this.osmdInstance))
      // Modebar / context band become visible only after the score loads, so
      // recompute the sticky offset now (cf. note in init()).
      applyStickyOffset()
      await this.requestWakeLock()
    },

    async requestWakeLock() {
      if ('wakeLock' in navigator) {
        try {
          await navigator.wakeLock.request('screen')
        } catch (err) {
          console.warn('Wake lock non disponible:', err)
        }
      }
    },

    async togglePlayback() {
      if (this.isStrictPlaying) this.toggleStrictPlaythrough()
      await playback.togglePlayback(musicxml.getAllNotes(), musicxml.getOsmdInstance())
      this.isPlaying = playback.isPlaying
    },

    toggleStrictPlaythrough() {
      if (this.isStrictPlaying) {
        strictPlaythrough.stop()
        return
      }

      if (this.isPlaying) playback.stop()
      this.isPlaying = false

      strictPlaythrough.setActiveHands({ right: this.rightHandActive, left: this.leftHandActive })
      this.isStrictPlaying = true

      strictPlaythrough.start({
        bpm: this.strictBpm,
        allNotes: musicxml.getAllNotes(),
        osmdInstance: musicxml.getOsmdInstance(),
        startMeasureIndex: this.strictStartMeasure,
        onComplete: (result) => {
          this.isStrictPlaying = false
          this.strictResult = result
          if (!result.aborted) {
            // A clean finish resets the start point so the next ▶ replays
            // from the top; aborted runs keep it for retry from the same spot.
            this.strictStartMeasure = 0
            musicxml.markStrictStartMeasure(null)
            this.openResultModal('strict')
          }
        },
      })
    },

    // Reinforcement is a flavor of training, so currentMode reports
    // 'training' for it — the segmented control stays on the training tab.
    get currentMode() {
      if (this.strictSelected) return 'strict'
      if (this.trainingMode) return 'training'
      return 'free'
    },

    setMode(name) {
      if (this.currentMode === name) return
      if (this.isStrictPlaying) strictPlaythrough.stop()
      if (this.strictSelected) {
        this.strictSelected = false
        this.strictStartMeasure = 0
        musicxml.markStrictStartMeasure(null)
      }
      if (this.trainingMode) this.toggleTrainingMode()

      if (name === 'training') this.toggleTrainingMode()
      else if (name === 'strict') this.strictSelected = true
    },

    strictAccuracyPercent() {
      if (!this.strictResult || !this.strictResult.total) return 0
      return Math.round((this.strictResult.hit / this.strictResult.total) * 100)
    },

    strictOffTempoTotal() {
      const r = this.strictResult
      if (!r) return 0
      return (r.offTempoEarly ?? 0) + (r.offTempoLate ?? 0)
    },

    async toggleTrainingMode() {
      this.trainingMode = !this.trainingMode

      const mode = this.trainingMode ? 'training' : 'free'
      await practiceTracker.toggleMode(mode)
      musicxml.setTrainingMode(this.trainingMode)
    },

    showScoreComplete(allPlaythroughs) {
      const mostRecent = [...allPlaythroughs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0]
      // Ranked fastest-first, current playthrough flagged so the modal
      // can highlight it.
      this.previousPlaythroughs = allPlaythroughs
        .map((pt) => ({ ...pt, isCurrent: pt === mostRecent }))
        .sort((a, b) => a.durationMs - b.durationMs)
      this.openResultModal('free')
    },

    get currentPlaythroughDuration() {
      return this.previousPlaythroughs.find((p) => p.isCurrent)?.durationMs ?? null
    },

    // Flat list of every completed playthrough across days. Used by the
    // history modal as the chart's data source.
    get historyPlaythroughs() {
      return this.scoreHistory.flatMap((d) => d.fullPlaythroughs)
    },

    openResultModal(mode) {
      this.resultMode = mode
      this.showResultModal = true
    },

    closeResultModal() {
      this.showResultModal = false
      this.resultMode = null
    },

    // Close whichever modal is currently open when Escape is pressed.
    // The fingering modal manages its own keyboard handling (digits /
    // backspace / enter / escape), so it is intentionally not handled here.
    handleEscape() {
      if (this.menuOpen) return this.closeMenu()
      if (this.showChangelogModal) return (this.showChangelogModal = false)
      if (this.showFeedbackModal) return (this.showFeedbackModal = false)
      if (this.showResultModal) return this.closeResultModal()
      if (this.showHistoryModal) return (this.showHistoryModal = false)
      if (this.showMidiHelpModal) return (this.showMidiHelpModal = false)
      const noMidi = document.getElementById('noMidiModal')
      if (noMidi?.open) noMidi.close()
    },

    resultTitle() {
      switch (this.resultMode) {
        case 'strict':         return t('score.resultTitleStrict')
        case 'training':       return t('score.resultTitleTraining')
        case 'reinforcement':  return t('score.resultTitleReinforcement')
        default:               return t('score.resultTitleScore')
      }
    },

    async refreshReinforcementSuggestions() {
      if (!this.scoreUrl) {
        this.measuresToReinforce = []
        return
      }
      const lastSession = await practiceTracker.getLastCompletedSession(this.scoreUrl)
      this.measuresToReinforce = practiceTracker.analyzeMeasuresFromSession(lastSession)
    },

    startReinforcementMode() {
      this.reinforcementMode = true
      this.trainingMode = true

      // Start new training session before activating reinforcement mode
      const metadata = musicxml.getScoreMetadata()
      practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'training', metadata.totalMeasures)

      musicxml.setReinforcementMode(this.measuresToReinforce)
    },

    updateActiveHands() {
      const hands = { right: this.rightHandActive, left: this.leftHandActive }
      musicxml.setActiveHands(hands)
      strictPlaythrough.setActiveHands(hands)
    },

    async openScoreHistory() {
      if (!this.scoreUrl) return
      this.scoreHistory = await practiceTracker.getScoreHistory(this.scoreUrl)
      this.historyTotalMs = this.scoreHistory.reduce((sum, d) => sum + (d.totalPracticeTimeMs || 0), 0)
      this.historyHotMeasures = await this.computeHotMeasures()
      this.showHistoryModal = true
    },

    // Top measures with the highest error rate, surfaced inside the
    // history modal so practiced measures with persistent trouble are
    // visible without diving into the data.
    async computeHotMeasures() {
      const agg = await storage.getAggregate(this.scoreUrl)
      if (!agg || !agg.measures) return []
      const entries = Object.entries(agg.measures)
        .map(([idx, m]) => ({
          index: Number(idx),
          attempts: m.totalAttempts || 0,
          errorRate: m.errorRate || 0,
        }))
        .filter((m) => m.attempts >= 2 && m.errorRate > 0)
        .sort((a, b) => b.errorRate - a.errorRate)
      return entries.slice(0, 5)
    },

    // Attaches the current score to the shared feedback submission (see
    // headerMenu), so a report from the score page says what was open.
    feedbackContext() {
      return { score: this.scoreTitle || null }
    },

    formatDate,
    formatDuration,

    formatPlaythroughs(playthroughs) {
      // Reverse to show chronological order (oldest first)
      const durations = [...playthroughs].reverse().map((pt) => formatDuration(pt.durationMs))
      return t('score.playthroughsSummary', { n: playthroughs.length, list: PLAYTHROUGH_LIST_FORMATTER.format(durations) })
    },

    // Built as a string (not <template x-for>) because Alpine's templates
    // render in HTML namespace and won't show up inside <svg>. Returns ''
    // when fewer than 2 points — the calling x-if then skips the section.
    playthroughChartSvg(playthroughs) {
      if (playthroughs.length < 2) return ''
      const all = playthroughs

      const sorted = [...all].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      const durs = sorted.map((p) => p.durationMs)
      const dMin = Math.min(...durs)
      const dMax = Math.max(...durs)
      const yMin = Math.max(0, dMin - (dMax - dMin) * 0.1)
      const yMax = (dMax + (dMax - dMin) * 0.1) || dMax * 1.1

      const W = 600
      const H = 200
      const PAD = { top: 12, right: 12, bottom: 28, left: 56 }
      const innerW = W - PAD.left - PAD.right
      const innerH = H - PAD.top - PAD.bottom
      // Evenly spaced by playthrough index: gaps between dates aren't shown.
      const n = sorted.length
      const xScale = (i) =>
        PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
      const yScale = (d) =>
        PAD.top + innerH - ((d - yMin) / (yMax - yMin || 1)) * innerH

      const points = sorted.map((p, i) => ({
        x: xScale(i),
        y: yScale(p.durationMs),
        duration: formatDuration(p.durationMs),
        date: CHART_DATE_FULL.format(new Date(p.startedAt)),
      }))
      const fmtAxis = (iso) => CHART_DATE_AXIS.format(new Date(iso))

      const axisY = PAD.top + innerH
      const xMin = PAD.left
      const xMax = PAD.left + innerW

      const yLabels = [
        `<text x="${xMin - 8}" y="${yScale(yMax) + 4}" text-anchor="end" class="chart-label">${formatDuration(yMax)}</text>`,
        `<text x="${xMin - 8}" y="${yScale(yMin) + 4}" text-anchor="end" class="chart-label">${formatDuration(yMin)}</text>`,
      ].join('')
      const xLabels = [
        `<text x="${xMin}" y="${H - 8}" text-anchor="start" class="chart-label">${fmtAxis(sorted[0].startedAt)}</text>`,
        `<text x="${xMax}" y="${H - 8}" text-anchor="end" class="chart-label">${fmtAxis(sorted[n - 1].startedAt)}</text>`,
      ].join('')
      const circles = points
        .map(
          (p) =>
            `<circle cx="${p.x}" cy="${p.y}" r="4" class="chart-point"><title>${p.date} — ${p.duration}</title></circle>`,
        )
        .join('')

      return `<svg viewBox="0 0 ${W} ${H}" class="playthrough-chart" role="img" aria-label="${t('score.chartAria')}">
        <line x1="${xMin}" x2="${xMax}" y1="${axisY}" y2="${axisY}" class="chart-axis" />
        ${yLabels}
        ${xLabels}
        ${circles}
      </svg>`
    },

    // Fingering annotation methods
    setupFingeringHandlers() {
      if (!this.fingeringEnabled) return
      fingeringEditor.setupFingeringClickHandlers({
        onNoteClick: (noteData) => this.openFingeringModal(noteData),
      })
    },

    openFingeringModal(noteData) {
      this.selectedNoteKey = noteData.fingeringKey
      this.fingeringSequence = ''
      this.showFingeringModal = true

      this.fingeringKeydownHandler = (e) => {
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
      document.addEventListener('keydown', this.fingeringKeydownHandler)
    },

    appendFinger(digit) {
      this.fingeringSequence += digit
    },

    closeFingeringModal() {
      this.showFingeringModal = false
      document.removeEventListener('keydown', this.fingeringKeydownHandler)
    },

    async validateFingering() {
      if (!this.fingeringSequence) return
      await this.selectFingering(parseInt(this.fingeringSequence, 10))
    },

    async selectFingering(finger) {
      await storage.setFingering(this.scoreUrl, this.selectedNoteKey, finger)
      this.closeFingeringModal()

      // Try to update SVG directly if fingering already exists (instant update)
      if (!fingeringEditor.updateFingeringSVG(this.selectedNoteKey, finger)) {
        // No existing SVG: inject into OSMD's data model and do a light re-render
        // (skips XML fetch/parse/load — just layout recalc + SVG redraw)
        fingeringEditor.addFingeringToDataModel(this.selectedNoteKey, finger)
        this.rerenderScore()
      }
    },

    async removeFingering() {
      await storage.removeFingering(this.scoreUrl, this.selectedNoteKey)
      this.closeFingeringModal()
      fingeringEditor.removeFingeringFromDataModel(this.selectedNoteKey)
      this.rerenderScore()
    },

    rerenderScore() {
      const scrollY = window.scrollY
      const { currentMeasureIndex } = musicxml.getTrainingState()
      const playedSourceMeasures = musicxml.getPlayedSourceMeasures()

      // Capture played/active state per playback position (not per fingeringKey):
      // a repeated measure appears twice in the sequence and both occurrences share
      // a fingeringKey, so a key-based snapshot would bleed the first pass's "played"
      // state onto the repeat and make the matcher skip it. The re-extracted sequence
      // has the same structure, so positional [measureIndex][noteIndex] restores cleanly.
      const noteStates = musicxml.getAllNotes().map(({ notes }) =>
        notes.map(({ played, active }) => ({ played, active })))

      musicxml.renderScore()
      fingeringEditor.alignFingeringLabelsToNoteheads()
      this.setupFingeringHandlers()
      fingeringEditor.restoreNoteStates(noteStates, currentMeasureIndex)
      musicxml.setCurrentMeasureIndex(currentMeasureIndex)
      musicxml.setPlayedSourceMeasures(playedSourceMeasures)
      window.scrollTo(0, scrollY)
    },
  }
}
