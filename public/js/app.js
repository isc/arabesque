import { initMidi } from './midi.js'
import { initMusicXML } from './musicxml.js'
import { initFingeringEditor } from './fingeringEditor.js'
import { initCassettes } from './cassettes.js'
import { initPracticeTracker } from './practiceTracker.js'
import { playthroughGroups, TWO_HANDS } from './hands.js'
import { formatDuration, formatDate, applyStickyOffset, scorePageUrl, onIdle, onForeground, withHands } from './utils.js'
import { initStorage } from './storage.js'
import { loadMxlAsXml } from './mxlLoader.js'
import { injectFingerings } from './fingeringInjector.js'
import { initPlayback, getBPM } from './playback.js'
import { initStrictPlaythrough } from './strictPlaythrough.js'
import { headerMenu } from './headerMenu.js'
import { initAutoSync, triggerSync } from './autoSync.js'
import { traced, mark } from './perfTrace.js' // TEMP diagnostic
import { t, locale } from './i18n.js'

// Built once: the active locale is fixed for the page lifetime (switching
// language reloads), so these don't need rebuilding per call/point.
const PLAYTHROUGH_LIST_FORMATTER = new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' })
const CHART_DATE_FULL = new Intl.DateTimeFormat(locale())
const CHART_DATE_AXIS = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })

// Redrawing a full score costs ~200ms, and dragging a window edge fires resize
// continuously — wait for the drag to settle before paying for it once.
const RESIZE_RELAYOUT_DEBOUNCE_MS = 250

// Resolves once the browser has had a frame to itself. Two rAFs, not one: the
// first only gets us into the frame that is already being prepared, so work
// resumed there still lands before that frame is painted.
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

// What the failure card says, per kind of failure.
const SCORE_LOAD_ERRORS = {
  offline: { title: 'score.offlineTitle', body: 'score.offlineBody', retry: false },
  failed: { title: 'score.failedTitle', body: 'score.failedBody', retry: true },
}

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
  // The browser drops this on its own whenever the page is hidden; kept so the
  // page can tell whether it still holds one (see requestWakeLock).
  let wakeLock = null
  // Settles when the MIDI handshake is done; awaited by markScoreReady().
  let midiReady = Promise.resolve()
  // Orders the reinforcement refreshes fired at every measure boundary (see
  // refreshReinforcementSuggestions).
  let reinforcementRefreshSeq = 0
  // The end of a session is the moment its data becomes worth pushing: runSync
  // only takes sessions that have ended, so a playthrough finished here would
  // otherwise sit on this device until the data page is opened.
  async function endSessionAndSync() {
    await practiceTracker.endSession()
    triggerSync('session ended')
  }

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

    // Read off the flag score.html's head script raised during parsing, so
    // Alpine agrees with the CSS about whether a score is on its way. Without
    // it x-show would put the onboarding card back on screen the moment Alpine
    // booted — osmdInstance is still null for the rest of the load — in front of
    // a score that was already coming.
    scoreLoading: document.documentElement.hasAttribute('data-loading-score'),
    // null | 'offline' (no copy here, and no network to get one) | 'failed'.
    scoreLoadError: null,
    get scoreLoadMessage() {
      const message = SCORE_LOAD_ERRORS[this.scoreLoadError]
      // Resolved here rather than in the template: the keys stay greppable, and
      // switching language reloads the page, so nothing can go stale.
      return {
        title: message ? t(message.title) : '',
        body: message ? t(message.body) : '',
        // Retrying an absent score with no network lands on this same card; the
        // library is the only move that can go anywhere.
        retry: Boolean(message?.retry),
      }
    },

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
    get activeHands() {
      return { right: this.rightHandActive, left: this.leftHandActive }
    },

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

    // Container width the score is currently laid out for, so a height-only
    // resize doesn't pay for a redraw (see handleViewportResize).
    lastRelayoutWidth: null,

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
      let relayoutTimer = null
      window.addEventListener('resize', () => {
        applyStickyOffset()
        clearTimeout(relayoutTimer)
        relayoutTimer = setTimeout(() => this.handleViewportResize(), RESIZE_RELAYOUT_DEBOUNCE_MS)
      })
      // $nextTick (not queueMicrotask) — Alpine flips x-show display on
      // the next tick, so we'd otherwise measure 0 for the band that's
      // about to appear. osmdInstance is updated via afterScoreLoad()
      // directly because $watch would deep-compare via JSON.stringify and
      // OSMD has circular references (note ↔ voiceEntry).
      this.$watch('currentMode', () => this.$nextTick(applyStickyOffset))
      this.$watch('reinforcementMode', () => this.$nextTick(applyStickyOffset))
      this.$watch('strictBpm', (v) => {
        if (this.scoreUrl && Number.isFinite(v) && v > 0) {
          localStorage.setItem(`arabesque:strictBpm:${this.scoreUrl}`, String(v))
        }
      })

      // Startup errands, none of which has to finish before a score can be
      // drawn — they used to run one after another in front of the load. What
      // the render actually needs is the database open, to read the fingerings;
      // practiceTracker.init() goes on to flush a stashed session and scan for
      // stranded ones, which is housekeeping that grows with the user's history
      // and is only depended on when a new session starts (see loadScoreFromURL).
      // The MIDI handshake and the cassette endpoint — a round trip that 404s
      // outright on static hosting — are nobody's prerequisite at all.
      const dbReady = storage.init()
      const trackerReady = dbReady.then(() => practiceTracker.init())
      midiReady = midi.connectMIDI({ silent: true, autoSelectFirst: true })
        .then(() => this.syncMidiState())
      onIdle(() => this.loadCassettesList())

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
          await endSessionAndSync()

          const allPlaythroughs = this.scoreUrl ? await practiceTracker.getAllPlaythroughs(this.scoreUrl) : []
          window.scrollTo({ top: 0, behavior: 'smooth' })
          this.showScoreComplete(allPlaythroughs)

          // Start new session for next playthrough
          const metadata = musicxml.getScoreMetadata()
          practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'free', metadata.totalMeasures)

          await this.refreshReinforcementSuggestions()
        },
        onTrainingComplete: async () => {
          this.openResultModal('training')
          await endSessionAndSync()
          // Start new session for next playthrough
          const metadata = musicxml.getScoreMetadata()
          practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'training', metadata.totalMeasures)
        },
        onMeasureStarted: (sourceMeasureIndex, startsPlaythrough) => {
          practiceTracker.startMeasureAttempt(sourceMeasureIndex, startsPlaythrough, this.activeHands)
        },
        onMeasureCompleted: (data) => {
          // TEMP: fire-and-forget, so its IndexedDB work never showed up in the
          // traced() around activateNote.
          traced('endMeasureAttempt', () => practiceTracker.endMeasureAttempt(data.clean))
          this.refreshReinforcementSuggestions()
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
          await endSessionAndSync()
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

      await dbReady
      const scoreUrl = new URLSearchParams(window.location.search).get('url')
      if (scoreUrl) await this.loadScoreFromURL(scoreUrl, trackerReady)

      // endSession() is the clean close, but its IndexedDB writes need the page
      // to stay alive long enough to commit — leaving mid-piece regularly
      // stranded a session. pagehide additionally drops a synchronous snapshot
      // that the next page load turns into a proper close.
      window.addEventListener('beforeunload', () => practiceTracker.endSession())
      window.addEventListener('pagehide', () => practiceTracker.stashPendingSession())
      // Restored from the back/forward cache: the page was never destroyed and
      // the session is still live, so the snapshot must not be replayed.
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) practiceTracker.clearPendingSession()
      })
      // Coming back to the page: take the wake lock again, since being hidden
      // released it. Only with a score up — that's when the screen is watched
      // rather than touched.
      onForeground(() => {
        const held = wakeLock && !wakeLock.released
        if (this.osmdInstance && !held) this.requestWakeLock()
      })
      // This page never pulls — not on open, not on tab-back. A pull can
      // trigger rebuildAggregates(), which clears every aggregate and replays
      // every stored session one by one; doing that with a score on screen and
      // MIDI coming in is how you freeze mid-piece. It has nothing to gain
      // either: it displays no synced data, and what it has to contribute goes
      // up through its own end-of-session trigger.
      initAutoSync({ storage, practiceTracker }, { syncOnReturn: false })
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
      await this.markScoreReady()
    },

    // `trackerReady` is the practice tracker's own init, which the render does
    // not wait on (see init) — only the session started below does.
    async loadScoreFromURL(url, trackerReady = Promise.resolve()) {
      this.scoreUrl = url
      this.fingeringEnabled = true
      this.loadCollectionInfo(url) // fire-and-forget: the navigator appears when ready

      try {
        await this.renderScoreWithFingerings()
      } catch (error) {
        this.reportScoreLoadFailure(error)
        return
      }

      const metadata = musicxml.getScoreMetadata()
      await trackerReady
      practiceTracker.startSession(url, metadata.title, metadata.composer, 'free', metadata.totalMeasures)

      // Suggestions from the score's recent history, before a note is played
      await this.refreshReinforcementSuggestions()
      await this.markScoreReady()
    },

    // Marks the score page as ready to be driven: OSMD has painted, metadata
    // is captured, the practice session is started and the handlers are wired.
    // Set at the end of the load path rather than as soon as OSMD paints,
    // because "pixels are on screen" and "the page will answer input" are not
    // the same instant — tests that treated them as one had to bridge the gap
    // with a sleep.
    async markScoreReady() {
      // The keyboard is half of "will answer input", and it is connected in
      // parallel with the load rather than in front of it.
      await midiReady
      document.getElementById('score').dataset.renderComplete = Date.now()
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
      // Independent: one is IndexedDB, the other the score bytes (already in
      // flight since the head script, so this is where its await belongs).
      const [{ fingerings }, xml] = await Promise.all([
        storage.getFingerings(this.scoreUrl),
        loadMxlAsXml(this.scoreUrl),
      ])
      const modified = injectFingerings(xml, fingerings)
      await musicxml.renderMusicXML(modified)
      await this.afterScoreLoad()
      this.setupFingeringHandlers()
    },

    // The score never arrived. A request that never reached a server (mxlLoader
    // tags it) means there is no copy here: sw.js caches a score as it is
    // opened, not the whole catalog, so one never opened on this device is
    // simply absent — an ordinary outcome offline rather than a fault, and the
    // only one a network fixes. Anything else is a real error.
    reportScoreLoadFailure(error) {
      console.error('Erreur lors du chargement de la partition:', error)
      this.hideScoreSpinner()
      this.scoreLoadError = error?.unreachable ? 'offline' : 'failed'
    },

    async retryScoreLoad() {
      this.scoreLoadError = null
      this.scoreLoading = true
      document.documentElement.dataset.loadingScore = '1'
      await this.loadScoreFromURL(this.scoreUrl)
    },

    // The spinner is raised while the document is parsed, so only the page can
    // lower it — on the render that replaces it, or on a failure that never
    // will. Missing the second case left the page loading for good.
    hideScoreSpinner() {
      this.scoreLoading = false
      delete document.documentElement.dataset.loadingScore
    },

    async afterScoreLoad() {
      this.osmdInstance = musicxml.getOsmdInstance()
      // As soon as OSMD has parsed the sheet — the title and composer are read
      // straight off it, and waiting for the render meant the topbar sat on its
      // "Partition" placeholder for the whole of it.
      this.captureScoreMetadata()
      // Wait for Alpine to update DOM (show #score container), then render
      await this.$nextTick()
      await nextPaint()
      await musicxml.renderScore({
        // Between OSMD's draw and its indexing pass: drop the spinner in the
        // same frame the score lands in (leave it up and its 70vh would push the
        // score below the fold), then hand the frame back so the score is
        // actually painted before indexing blocks the thread again.
        afterDraw: async () => {
          this.hideScoreSpinner()
          await nextPaint()
        },
      })
      fingeringEditor.alignFingeringLabelsToNoteheads()
      this.lastRelayoutWidth = document.getElementById('score').clientWidth
      const savedBpm = this.scoreUrl ? Number(localStorage.getItem(`arabesque:strictBpm:${this.scoreUrl}`)) : NaN
      this.strictBpm = Number.isFinite(savedBpm) && savedBpm > 0 ? savedBpm : Math.round(getBPM(this.osmdInstance))
      // Modebar / context band become visible only after the score loads, so
      // recompute the sticky offset now (cf. note in init()).
      applyStickyOffset()
      await this.requestWakeLock()
    },

    // A screen wake lock is released as soon as the document is hidden — tab
    // switch, app backgrounded, screen off — and is never restored on the way
    // back, so it has to be taken again. Asking once when the score loaded left
    // the screen free to sleep for the rest of the session.
    async requestWakeLock() {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
      try {
        wakeLock = await navigator.wakeLock.request('screen')
      } catch (err) {
        // Refused rather than absent: WebKit grants this in Safari proper only,
        // so the iOS wrapper keeps the screen awake natively instead.
        console.warn('Wake lock non disponible:', err)
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

      strictPlaythrough.setActiveHands(this.activeHands)
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
      // Ranked fastest-first, current playthrough flagged so the modal can
      // highlight it. Only runs played with the same hands are in the running:
      // a right-hand run beats every two-hand time on the clock without being
      // the better performance.
      this.previousPlaythroughs = allPlaythroughs
        .filter((pt) => pt.hands === (mostRecent?.hands ?? TWO_HANDS))
        .map((pt) => ({ ...pt, isCurrent: pt === mostRecent }))
        .sort((a, b) => a.durationMs - b.durationMs)
      this.openResultModal('free')
    },

    // The hands every run in the ranking was played with, named in the title
    // when they aren't both.
    get resultHands() {
      return this.previousPlaythroughs[0]?.hands ?? TWO_HANDS
    },

    get currentPlaythroughDuration() {
      return this.previousPlaythroughs.find((p) => p.isCurrent)?.durationMs ?? null
    },

    // One evolution chart per hand selection, oldest measure of progress
    // first. Built here rather than in the template so each SVG is generated
    // once, and so a selection with too few runs to plot simply drops out.
    get playthroughCharts() {
      const playthroughs = this.scoreHistory.flatMap((d) => d.fullPlaythroughs)
      return playthroughGroups(playthroughs)
        .map((group) => ({ ...group, svg: this.playthroughChartSvg(group.playthroughs) }))
        .filter((group) => group.svg)
    },

    openResultModal(mode) {
      mark(`modale résultat (${mode})`) // TEMP: to date the 🔁 resize against
      this.resultMode = mode
      this.showResultModal = true
      // The ranking is fastest-first and scrolls in its own column, so the run
      // that just ended can sit well below the fold. Bring it into view.
      this.$nextTick(() => {
        document.querySelector('.pt-playthrough-table tr.is-current')?.scrollIntoView({ block: 'center' })
      })
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
        default:               return withHands(t('score.resultTitleScore'), this.resultHands)
      }
    },

    // Refreshed at every measure boundary, so the badge shows up as soon as a
    // passage has been fumbled rather than at the end of a playthrough. Reads
    // are ordered by sequence number: at that rate a slow one could otherwise
    // land on top of a fresher result.
    async refreshReinforcementSuggestions() {
      const seq = ++reinforcementRefreshSeq
      const measures = await practiceTracker.getMeasuresToReinforce(this.scoreUrl)
      if (seq === reinforcementRefreshSeq) this.measuresToReinforce = measures
    },

    async startReinforcementMode() {
      // Pinned before the await below, which leaves room for a measure
      // boundary to refresh the suggestions under us.
      const measures = this.measuresToReinforce
      this.reinforcementMode = true
      this.trainingMode = true

      // Close the session under way first: reinforcement can now be started
      // mid-piece, and simply starting the training session on top of a free
      // one would strand it with no endedAt (see endSession).
      await endSessionAndSync()
      const metadata = musicxml.getScoreMetadata()
      practiceTracker.startSession(this.scoreUrl, metadata.title, metadata.composer, 'training', metadata.totalMeasures)

      musicxml.setReinforcementMode(measures)
    },

    updateActiveHands() {
      musicxml.setActiveHands(this.activeHands)
      strictPlaythrough.setActiveHands(this.activeHands)
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

    playthroughGroups,

    formatPlaythroughs(group) {
      // Reverse to show chronological order (oldest first)
      const durations = [...group.playthroughs].reverse().map((pt) => formatDuration(pt.durationMs))
      const summary = t('score.playthroughsSummary', { n: group.playthroughs.length, list: PLAYTHROUGH_LIST_FORMATTER.format(durations) })
      return withHands(summary, group.hands)
    },

    chartTitle(hands) {
      return withHands(t('score.playtimeEvolution'), hands)
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

    // Every redraw replaces the SVG, taking with it everything painted on it:
    // note colours, fingering handlers, the training cursor, the strict marker.
    // `savedStates` is only needed when the redraw rebuilt the note model.
    repaintScore(savedStates = null) {
      const { currentMeasureIndex } = musicxml.getTrainingState()
      fingeringEditor.alignFingeringLabelsToNoteheads()
      this.setupFingeringHandlers()
      fingeringEditor.restoreNoteStates(savedStates, currentMeasureIndex)
      musicxml.updateMeasureCursor()
      // The click rectangles are rebuilt by the redraw, so the marker went with them.
      if (this.strictSelected) musicxml.markStrictStartMeasure(this.strictStartMeasure)
    },

    // renderScore() rebuilds the note model, which clears the played/active flags
    // and the playback position — hence the snapshot around it.
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

      // Before repaintScore, which reads the cursor position back out.
      musicxml.setCurrentMeasureIndex(currentMeasureIndex)
      musicxml.setPlayedSourceMeasures(playedSourceMeasures)
      this.repaintScore(noteStates)
      window.scrollTo(0, scrollY)
    },

    // OSMD's own autoResize is off (see renderMusicXML): it re-rendered behind our
    // back and every played note went black.
    handleViewportResize() {
      if (!this.osmdInstance) return
      // strictPlaythrough caches a notehead element per event, and playback caches
      // the score SVG plus the cursor's iterator position; a redraw would strand
      // both on detached nodes. Leave the layout as it is until the run is over
      // rather than break it mid-performance.
      if (this.isStrictPlaying || this.isPlaying) return
      // OSMD lays out against the container width alone, so a height-only change
      // would redraw to a pixel-identical score. Worth skipping: on mobile the URL
      // bar collapsing fires resize, and free mode scrolls the score as you play.
      const width = document.getElementById('score')?.clientWidth
      if (width === this.lastRelayoutWidth) return
      this.lastRelayoutWidth = width

      const scrollY = window.scrollY
      // relayoutScore, not renderScore: re-extracting the note model would reset the
      // training and reinforcement state, and clear the very flags we'd then have to
      // snapshot to put back.
      musicxml.relayoutScore()
      this.repaintScore()
      window.scrollTo(0, scrollY)
    },
  }
}
