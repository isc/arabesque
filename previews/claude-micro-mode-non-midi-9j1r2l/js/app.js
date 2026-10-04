import { initMidi, nativePairingAvailable, openNativePairing } from './midi.js'
import { initMusicXML } from './musicxml.js'
import { initFingeringEditor } from './fingeringEditor.js'
import { fingeringPad } from './fingeringPad.js'
import { initPracticeTracker } from './practiceTracker.js'
import { TWO_HANDS, handsKey } from './hands.js'
import { formatDuration, formatDate, applyStickyOffset, scorePageUrl, onForeground, withHands, passage, pickPassageMeasure, passageText } from './utils.js'
import { initStorage } from './storage.js'
import { loadMxlAsXml } from './mxlLoader.js'
import { injectFingerings } from './fingeringInjector.js'
import { migrateFingeringRecord } from './fingeringKeys.js'
import { initPlayback, getBPM } from './playback.js'
import { initStrictPlaythrough } from './strictPlaythrough.js'
import { initKeyboardHint, C8 } from './keyboardHint.js'
import { createTempoPlan, createTempoTrainer, GRADUATED, BPM_STEP, STREAK } from './tempoTrainer.js'
import { BPM_DEFAULT } from './bpmStepper.js'
import { bpmField } from './bpmField.js'
import { resultModal } from './resultModal.js'
import { headerMenu } from './headerMenu.js'
import { initAutoSync, triggerSync } from './autoSync.js'
import { scopedKey } from './profiles.js'
import { t, tn } from './i18n.js'
import { recordError } from './errorLog.js'
import { loadCatalog, fileUrl, isCollection } from './catalog.js'
import { playthroughCharts, withRunLines, hotMeasures } from './playthroughHistory.js'

// What the strict and training bands say once a passage's first bar is picked
// and its last is awaited: to click that bar, while a click would reach the
// band (see barClickOwner), and otherwise only where the passage starts. One
// copy for both: with one each, the training band missed the listening rule.
function armedRangeText(from, clickIsTheBands) {
  return t(clickIsTheBands ? 'score.loopHintEnd' : 'score.startAt', { n: from })
}

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
    getNoteDataByKey: musicxml.getNoteDataByKey,
    svgNote: musicxml.svgNote,
    graphicalMeasureForNote: musicxml.graphicalMeasureForNote,
  })
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)
  const playback = initPlayback(midi.state)
  const strictPlaythrough = initStrictPlaythrough()
  // The on-screen keyboard; built in init(), where the page's state it reads is.
  let keyHint = null
  // The browser drops this on its own whenever the page is hidden; kept so the
  // page can tell whether it still holds one (see requestWakeLock).
  let wakeLock = null
  // Settles when the MIDI handshake is done; awaited by markScoreReady().
  let midiReady = Promise.resolve()
  // The name the catalog gives the score under way (lookUpListing): null until
  // it has answered, and for a score it does not list.
  let listedName = null
  // Orders the reinforcement refreshes fired at every measure boundary (see
  // refreshReinforcementSuggestions).
  let reinforcementRefreshSeq = 0
  // The tempo trainer's loop while one is running (see tempoTrainer.js).
  let trainer = null
  // The last strict run being filed. Awaited by anything that would otherwise
  // end the same session underneath it (see setMode): closing a session twice
  // credits its practice time twice.
  let strictRunRecorded = Promise.resolve()
  // Files the session under way and opens the next one under `mode`: at the
  // end of a playthrough, whose session carries only that one, and at a change
  // of mode, whose practice is filed under the mode it was practised in. One
  // after the other, whoever asks: two closing the same session at once — a
  // tab tapped while a finished piece is being filed — counted its practice
  // twice. Caught, since a chain left rejected skips every link after it.
  //
  // What was filed is worth pushing at once: runSync only takes sessions that
  // have ended, so a playthrough finished here would otherwise sit on this
  // device until the data page is opened. `sync: false` leaves it to a caller
  // that syncs later (the tempo trainer, at the end of its loop).
  let sessionRolled = Promise.resolve()
  function rollSession(mode, { sync = true } = {}) {
    sessionRolled = sessionRolled
      .then(async () => {
        if ((await practiceTracker.toggleMode(mode)) && sync) triggerSync('session ended')
      })
      .catch((error) => recordError(error, 'Session could not be filed'))
    return sessionRolled
  }

  // Opens the first session on a score just loaded, with its title and
  // measure count from the sheet; rollSession hands them on from there.
  function startFreshSession(scoreUrl, mode) {
    const metadata = musicxml.getScoreMetadata()
    practiceTracker.startSession(scoreUrl, metadata.title, metadata.composer, mode, metadata.totalMeasures)
  }

  // Both tempi — the one strict runs are played at and the one the piece is
  // listened to at — are the player's choice for that score, and are kept per
  // score so it survives a reload. An empty or half-typed field is not a
  // choice, so it is not remembered.
  //
  // Wrapped, like every other localStorage call here: a browser in private mode
  // throws on setItem, and a forgotten tempo is not worth losing the page over.
  // Per profile: one player's 60 BPM is not another's (profiles.js).
  const bpmKey = (name, scoreUrl) => scopedKey(`arabesque:${name}:${scoreUrl}`)

  function rememberBpm(name, scoreUrl, bpm) {
    if (!scoreUrl || !Number.isFinite(bpm) || bpm <= 0) return
    try {
      localStorage.setItem(bpmKey(name, scoreUrl), String(bpm))
    } catch { /* storage unavailable */ }
  }

  function savedBpm(name, scoreUrl, fallback) {
    if (!scoreUrl) return fallback
    let stored = NaN
    try {
      stored = Number(localStorage.getItem(bpmKey(name, scoreUrl)))
    } catch { /* storage unavailable */ }
    return Number.isFinite(stored) && stored > 0 ? stored : fallback
  }

  return {
    ...headerMenu(),
    ...fingeringPad({ storage, fingeringEditor }),
    ...bpmField(),
    // The next run starts as the piece did (feedback b7682019).
    ...resultModal({ onOpen: () => keyHint.restart() }),
    bluetoothConnected: false,
    midiDeviceName: null,
    micActive: false,
    osmdInstance: null,
    // Which beat of the count-in bar is sounding (0 = not counting), and how
    // many the bar holds — the engine works that out from the time signature.
    countInBeat: 0,
    countInBeats: 0,
    // The engine's transport, mirrored: 'stopped' | 'playing' | 'paused'. ⏸
    // holds the piece without ending it, so the playback band has to outlive the
    // playing — "listening" below covers both, and is what the band and the ⏹ in
    // the modebar go by.
    playbackTransport: 'stopped',
    // Null until a score is loaded: the tempo it is heard at is the player's
    // for that score, and afterScoreLoad resolves it. Assigning it there is
    // also what pushes it to the engine (see the watch in init), so a default
    // here would be a second answer to a question the score has already been
    // asked.
    playbackBpm: null,
    playbackMeasure: 0,
    isStrictPlaying: false,
    // 'free', 'training', 'reinforcement' (training on a list the app picked)
    // or 'strict', moved by setMode alone. It was three booleans, written from
    // four places, which could disagree: the strict tab over a reinforcement,
    // or a training band gone for good after a reinforcement left by hand.
    // Strict mode is armed by its tab; the ▶/⏸ in its band runs the engine.
    mode: 'free',
    // The passage strict runs play: where a run starts — null while nobody
    // has picked a measure, which tells the marker on the score apart from a
    // run from the top, which needs none; a run reads it as `?? 0` — and where
    // it ends, null for the end of the score. See `passage` (utils.js).
    strictPassage: passage(null),
    strictBpm: BPM_DEFAULT,
    // The tempo trainer: strict runs of the passage in a loop, the tempo moving
    // between runs (see tempoTrainer.js). Armed by the loop button
    // (strictPassage.loop) in place of a single run.
    trainerMode: GRADUATED,
    // What the band says about the loop under way.
    trainerStatus: null,
    // Training mode works a passage: one measure by default — the measure
    // clicked, the work moving on down the score once its three dots are
    // filled (`end` null) — or a range picked with 🔁, whose measures are then
    // drilled as one, joins and slurs between them included.
    trainingPassage: passage(0),

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
    historyCharts: [],
    measuresToReinforce: [],
    showMidiHelpModal: false,

    // Container width the score is currently laid out for, so a height-only
    // resize doesn't pay for a redraw (see handleViewportResize).
    lastRelayoutWidth: null,

    // The on-screen keyboard (keyboardHint.js): whether it has come up, and the
    // notes it is showing, by name.
    keyHintVisible: false,
    keyHintCaption: [],
    // Where the player is asked for notes at their own pace — the only place
    // the keyboard has a use. Not under a run's results, where keys do not
    // count: training opens them from inside its last note, before the
    // keyboard has had that key, which would otherwise start the next wait.
    get keyHintContext() {
      return (
        !!this.osmdInstance &&
        this.mode !== 'strict' &&
        !this.isListening &&
        !this.showResultModal
      )
    },
    get keyHintShown() {
      return this.keyHintVisible && this.keyHintContext
    },

    async init() {
      // The engine says when the transport moves — ⏸, ▶, a seek, a tempo
      // change rebuilding the schedule, the last note — and the page mirrors it
      // from here, once, rather than from every control that can move it.
      playback.setOnTransportChange(() => this.syncPlaybackState())
      this.followStickyBars()
      keyHint = initKeyboardHint({
        owedGroup: musicxml.getOwedGroup,
        eligible: () => this.keyHintContext && document.visibilityState === 'visible',
        onVisibleChange: (visible) => { this.keyHintVisible = visible },
        onCaptionChange: (caption) => { this.keyHintCaption = caption },
      })
      this.$watch('strictBpm', () => { if (!this.bpmHold) this.commitBpm('strictBpm') })
      this.$watch('playbackBpm', () => { if (!this.bpmHold) this.commitBpm('playbackBpm') })

      // Startup errands, none of which has to finish before a score can be
      // drawn — they used to run one after another in front of the load.
      // practiceTracker.init() opens the database on its way, which is all the
      // render needs of it and it reads that itself (see
      // renderScoreWithFingerings); the rest — flushing a stashed session,
      // scanning for stranded ones, replaying the sessions once after a change
      // of rules — is housekeeping that grows with the user's history and is
      // only depended on when a new session starts (see loadScoreFromURL). The
      // MIDI handshake is nobody's prerequisite at all.
      const trackerReady = practiceTracker.init()
      midiReady = midi.connectMIDI({ silent: true, autoSelectFirst: true })
        .then(() => this.syncMidiState())

      this.wireKeyboard()
      this.wireScoreEngine()

      // Nothing is awaited in front of the load: the spinner the head script
      // raised is lowered only by the render or by reportScoreLoadFailure, so
      // whatever is waited on here can leave the page loading with nothing to
      // say. The database open sat here and did exactly that.
      const scoreUrl = new URLSearchParams(window.location.search).get('url')
      if (scoreUrl) await this.loadScoreFromURL(scoreUrl, trackerReady)

      this.followPageLifecycle()
    },

    // The sticky bars' height feeds both scrollToMeasure (JS) and
    // scroll-margin-top (CSS, via --pt-sticky-offset), and a narrower window
    // lays the score out again.
    followStickyBars() {
      // Recomputed on resize and when a band toggles visibility.
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
      // Each mode has its own band, or none, above the score.
      this.$watch('mode', () => this.$nextTick(applyStickyOffset))
      // The playback band appears and disappears with the listening, and it is
      // as tall as the strict one — so the sticky offset has to follow it too.
      this.$watch('isListening', () => this.$nextTick(applyStickyOffset))
    },

    // The notes the keyboard sends, to whichever engine the mode gives them.
    wireKeyboard() {
      const NAVIGATE_BACK_KEY = C8 // the highest piano key: the least jarring sound

      midi.setCallbacks({
        onNotePlayed: (midiNote) => {
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
          // The strict engine takes no key before ▶ — and neither does anything
          // else: the free engine used to, and a piece played through under the
          // strict tab opened the free results and filed a free session.
          if (this.mode === 'strict') {
            strictPlaythrough.handleNoteOn(midiNote)
            return
          }
          musicxml.activateNote(midiNote)
          keyHint.keyDown(midiNote)
        },
        onNoteReleased: (midiNote) => {
          if (this.mode === 'strict') return
          musicxml.deactivateNote(midiNote)
          keyHint.keyUp(midiNote)
        },
        // Without this the notes came through while the header still offered
        // to connect, and only pressing that button again refreshed it.
        onConnectionChange: () => this.syncMidiState(),
      })
    },

    // What the score engine reports as the player goes: runs, measures, wrong
    // notes, the end of a drill, a bar clicked.
    wireScoreEngine() {
      musicxml.setCallbacks({
        onScoreCompleted: async () => {
          practiceTracker.markScoreCompleted()
          await rollSession(this.currentMode)

          const allPlaythroughs = this.scoreUrl ? await practiceTracker.getAllPlaythroughs(this.scoreUrl) : []
          window.scrollTo({ top: 0, behavior: 'smooth' })
          this.showScoreComplete(allPlaythroughs)

          await this.refreshReinforcementSuggestions()
        },
        onTrainingComplete: async () => {
          this.showTrainingDone(this.trainingPassage, musicxml.getTrainingState().targetRepeatCount)
          await rollSession(this.currentMode)
        },
        onMeasureStarted: (sourceMeasureIndex, startsPlaythrough) => {
          practiceTracker.startMeasureAttempt(sourceMeasureIndex, startsPlaythrough, this.activeHands)
        },
        onMeasureCompleted: () => {
          practiceTracker.endMeasureAttempt()
          this.refreshReinforcementSuggestions()
        },
        onWrongNote: (midiNote) => {
          practiceTracker.recordWrongNote()
          keyHint.wrongNote(midiNote)
        },
        onPlaythroughRestart: () => {
          practiceTracker.restartPlaythrough()
        },
        // A run that reached the end is over, results or not (one started from
        // a bar further on has none): the next starts as the piece did.
        onBackToTop: () => keyHint.restart(),
        onReinforcementComplete: async () => {
          await this.setMode('free')
          this.openResultModal('reinforcement')
        },
        onMeasureClicked: (measureIndex) => {
          // A bar clicked while listening seeks playback there instead of
          // forcing a listen-from-the-top — live it jumps at once, paused it
          // picks where ▶ will start.
          if (this.barClickOwner === 'playback') {
            playback.seekToMeasure(measureIndex)
            return true
          }
          if (this.barClickOwner === 'strict') {
            this.pickStrictMeasure(measureIndex)
            return true
          }
          if (this.barClickOwner === 'training') {
            this.pickTrainingMeasure(measureIndex)
            return true
          }
          return false
        },
      })
    },

    // Once the score is up: the session's close as the page goes, the wake
    // lock as it comes back, and the sync.
    followPageLifecycle() {
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
        if (this.osmdInstance) this.requestWakeLock()
      })
      // This page syncs only when a session ends (rollSession), between runs:
      // not on open, not on tab-back. What it has to contribute goes up then,
      // and it displays no synced data to refresh. A pull rebuilds every
      // aggregate, which is no work for a moment with MIDI coming in.
      initAutoSync({ storage, practiceTracker }, { syncOnReturn: false })
    },

    syncMidiState() {
      this.bluetoothConnected = midi.state.midiConnected
      this.midiDeviceName = midi.state.midiInput?.name || null
      // The help modal is the "no keyboard found" screen. Once one is found it
      // has nothing left to say, and its retry button would be asking for a
      // connection that already happened.
      if (this.bluetoothConnected) this.showMidiHelpModal = false
      // A keyboard switched on while the mic listens would have every note
      // counted twice: once from its keys, once from its speakers.
      if (this.bluetoothConnected && this.micActive) this.stopMic()
    },

    async connectMIDI() {
      const result = await midi.connectMIDI()
      this.syncMidiState()
      // No keyboard found: say how to connect one. In the wrapper that is not
      // instructions but a system sheet (see midi.js).
      if (result?.status !== 'no_devices') return
      if (nativePairingAvailable()) openNativePairing()
      else this.showMidiHelpModal = true
    },

    // Mic mode (non-MIDI): detected notes are turned into synthetic MIDI
    // messages and fed through parseMidiMessage, as a keyboard's would be.
    // Loaded on demand — pitch detection is dead weight on every page that
    // has a keyboard.
    async toggleMic() {
      if (this.micActive) return this.stopMic()
      const mic = await import('./micInput.js')
      this.micActive = await mic.start({
        onMessage: midi.parseMidiMessage,
        onEnded: () => (this.micActive = false),
        // No MIDI output is the only case mic mode is offered in, so ▶ Écouter
        // plays through the speakers, into the microphone.
        isPageSounding: () => this.isPlaying,
      })
    },

    async stopMic() {
      const mic = await import('./micInput.js')
      mic.stop()
      this.micActive = false
    },

    detectedOS() {
      // Asked first, because the user agent lies where it matters most: the
      // iPad wrapper sends a Macintosh one, and used to get macOS instructions
      // for a keyboard iOS pairs from a sheet of its own.
      if (nativePairingAvailable()) return 'ios'
      const ua = navigator.userAgent
      if (/Mac/.test(ua)) return 'mac'
      if (/Win/.test(ua)) return 'windows'
      return 'other'
    },

    async loadMusicXMLFromFile(file) {
      if (!file) return
      try {
        await musicxml.loadMusicXML(file)
        this.scoreUrl = null
        await this.afterScoreLoad()
        await this.markScoreReady()
      } catch (error) {
        // A file that is not a score is the player's mistake, not a fault.
        if (!error.notMusicXml) recordError(error, 'MusicXML file could not be loaded')
        alert(t(error.notMusicXml ? 'errors.invalidMusicXml' : 'errors.musicXmlLoad'))
      }
    },

    // `trackerReady` is the practice tracker's own init, which the render does
    // not wait on (see init) — only the session started below does.
    async loadScoreFromURL(url, trackerReady = Promise.resolve()) {
      this.scoreUrl = url
      this.lookUpListing(url) // fire-and-forget: the sheet never waits on it

      try {
        await this.renderScoreWithFingerings()
      } catch (error) {
        this.reportScoreLoadFailure(error)
        return
      }

      await trackerReady
      startFreshSession(url, 'free')

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

    // What the catalog says of the score at `url`: a part of a collection
    // brings its siblings, for the topbar's prev/next navigation, and a listed
    // score the name the page shows (captureScoreMetadata).
    async lookUpListing(url) {
      let catalog
      try {
        catalog = await loadCatalog()
      } catch (error) {
        recordError(error, 'The score catalog could not be read')
        return
      }
      const listed = catalog.byUrl.get(url)
      if (!listed) return
      if (isCollection(listed.score)) {
        this.collection = {
          title: listed.score.title,
          parts: listed.score.parts.map((part) => ({ ...part, url: fileUrl(catalog, part.file) })),
        }
        this.collectionIndex = listed.index
      }
      listedName = listed.name
      // The catalog usually answers before the sheet is parsed, and this does
      // nothing: afterScoreLoad names it then, ahead of its first draw.
      // Answering after, it names the bar at once and the sheet at its next
      // draw.
      this.captureScoreMetadata()
    },

    gotoPart(index) {
      const part = this.collection?.parts[index]
      if (!part) return
      window.location.href = scorePageUrl(part.url)
    },

    // The name the page shows, in its bar and at the head of the sheet: the
    // catalog's for a score it lists, as the library and the journal show it,
    // and the sheet's own for any other. The session opened on the score
    // takes it from the sheet too (startFreshSession).
    captureScoreMetadata() {
      if (!this.osmdInstance) return
      if (listedName) musicxml.nameSheet(listedName)
      const { title, composer } = musicxml.getScoreMetadata()
      this.scoreTitle = title || null
      this.scoreComposer = composer || null
      if (title) {
        document.title = `${title}${composer ? ' — ' + composer : ''} · ${t('score.pageTitle')}`
      }
    },

    async renderScoreWithFingerings() {
      // Independent: one is IndexedDB, the other the score bytes (already in
      // flight since the head script, so this is where its await belongs).
      const [fingeringRecord, xml] = await Promise.all([
        storage.getFingerings(this.scoreUrl),
        loadMxlAsXml(this.scoreUrl),
      ])
      const modified = injectFingerings(xml, fingeringRecord.fingerings)
      await musicxml.renderMusicXML(modified)
      await this.afterScoreLoad()
      this.setupFingeringHandlers()
      await this.migrateFingeringKeys(fingeringRecord)
    },

    // A fingering used to be stored under the measure number the file printed,
    // which is a label and not an identity -- Satie's Gnossienne prints "0" on
    // all eleven of its measures, so one fingering was drawn on eleven notes.
    // Records written then are rewritten here, once, the first time the player
    // opens the score on this device: the key each note is filed under now, and
    // the key it was filed under then, both come out of the same walk over the
    // sheet, so the translation is exact rather than guessed at.
    //
    // After the load rather than before it, which costs a re-render, because
    // the old names cannot be read off the file. They were the *editor's*
    // spelling of the measure number -- OSMD's MeasureNumberXML, which is null
    // for the "X1" of a second ending -- where the injection reads the same
    // attribute with parseInt and gets NaN. Deriving them from the raw document
    // would mean reimplementing OSMD's parse of that attribute, which is the
    // second derivation this whole change exists to remove. So what the
    // injection could not place is added to OSMD's data model instead and drawn
    // by the light re-render a newly entered fingering takes -- no second parse
    // of the score.
    //
    // The record carries no "already migrated" mark: an old key is recognised
    // by its shape, so this heals whatever it is handed. The cost is that a
    // device still on the old build can push its legacy record back and have
    // the copies made again, including ones the player has since deleted. That
    // lasts as long as the old build does, and a stored flag would travel no
    // better than the keys themselves.
    //
    // The record keeps its updatedAt, and the version its last sync left is
    // translated along with it (migrateFingeringRecord). The rewrite is a
    // translation, not an edit: every device makes the same one from the same
    // record, so it has nothing to send the others -- and a device still on
    // the old build, which reads only the old names, would be sent a record
    // it shows nothing of. The cloud keeps the old names until the next real
    // edit, and each device translates them on its own first open. Written
    // only over the record as it was read at render time: a fingering entered
    // since stays, and the next open translates again.
    async migrateFingeringKeys(record) {
      const migrated = migrateFingeringRecord(record, musicxml.getLegacyFingeringKeyMap())
      if (!migrated) return
      await storage.putFingeringRecordsIfUnchanged([{ record: migrated.record, read: record.updatedAt ?? 0 }])
      for (const key of migrated.added) {
        fingeringEditor.addFingeringToDataModel(key, migrated.record.fingerings[key])
      }
      if (migrated.added.length) this.rerenderScore()
    },

    // The score never arrived. A request that never reached a server (mxlLoader
    // tags it) means there is no copy here: sw.js caches a score as it is
    // opened, not the whole catalog, so one never opened on this device is
    // simply absent — an ordinary outcome offline rather than a fault, and the
    // only one a network fixes. Anything else is a real error.
    reportScoreLoadFailure(error) {
      recordError(error, 'Score could not be loaded')
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
      // A verdict is a verdict on the piece it was played on. Another score
      // dropped in is another piece, and the notes the marks were keyed to are
      // not in it — so they go before the module can be asked to paint them
      // back onto it.
      strictPlaythrough.clearMarks()
      // As soon as OSMD has parsed the sheet — waiting for the render meant the
      // topbar sat on its "Partition" placeholder for the whole of it.
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
      keyHint.mount(
        document.getElementById('key-hint-keys'),
        musicxml.getAllNotes().flatMap((m) => m.notes.map((n) => n.midiNumber)),
      )
      this.lastRelayoutWidth = document.getElementById('score').clientWidth
      // The tempo the piece is written at is where both fields start, until the
      // player has said otherwise for this score.
      const written = Math.round(getBPM(this.osmdInstance))
      this.strictBpm = savedBpm('strictBpm', this.scoreUrl, written)
      this.playbackBpm = savedBpm('playbackBpm', this.scoreUrl, written)
      // Modebar / context band become visible only after the score loads, so
      // recompute the sticky offset now (cf. note in init()).
      applyStickyOffset()
      await this.requestWakeLock()
    },

    // A screen wake lock is released as soon as the document is hidden — tab
    // switch, app backgrounded, screen off — and is never restored on the way
    // back, so it has to be taken again. Asking once when the score loaded left
    // the screen free to sleep for the rest of the session. Asking while one is
    // still held, on the other hand, only piles up sentinels: a score reloaded
    // in place (another file dropped, a retry) comes back through here.
    async requestWakeLock() {
      if (wakeLock && !wakeLock.released) return
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
      try {
        wakeLock = await navigator.wakeLock.request('screen')
      } catch (err) {
        // Refused rather than absent: WebKit grants this in Safari proper
        // only. The iOS wrapper shims the API and keeps the screen awake
        // natively for as long as this page holds the lock.
        console.warn('Wake lock non disponible:', err)
      }
    },

    get isPlaying() {
      return this.playbackTransport === 'playing'
    },

    // Playing or held at a bar by ⏸ — either way the piece is on the stand and
    // the playback band is up. Only ⏹ (or the last note) puts it away.
    get isListening() {
      return this.playbackTransport !== 'stopped'
    },

    // The engine owns the transport; the page only mirrors what it says,
    // whenever it says it has moved (see the registration in init).
    syncPlaybackState() {
      this.playbackTransport = playback.transport
      this.playbackMeasure = playback.currentMeasureIndex
    },

    // A click on a bar belongs to one of the three things that can want it.
    // Listening wins: the piece being heard is steered bar by bar, and strict
    // mode's or training's passage can be picked once it is over. The bands
    // ask this, so only the one that would get the click offers it.
    get barClickOwner() {
      if (this.isListening) return 'playback'
      // Reinforcement drills a list the app chose; a bar clicked there is not
      // the player picking a passage, so it stays the plain jump it has been.
      if (this.mode === 'strict' || this.mode === 'training') return this.mode
      return null
    },

    // Puts the piece on the stand, from the top or from where ⏸ left it. Both
    // ▶ Écouter and the band's own ▶ come through here.
    startListening() {
      return playback.play(musicxml.getAllNotes(), musicxml.getOsmdInstance())
    },

    // Puts the piece away. The one way the listening ends by hand, so ⏹, a mode
    // change and the start of a strict run all say it the same way.
    stopListening() {
      if (!this.isListening) return
      playback.stop()
    },

    async togglePlayback() {
      if (this.isListening) {
        this.stopListening()
        return
      }
      if (this.isStrictPlaying) this.toggleStrictPlaythrough()
      await this.startListening()
    },

    // ⏸ / ▶ in the playback band: holds the piece at the bar it has reached,
    // and picks it up from that same bar.
    async togglePlaybackPause() {
      if (this.isPlaying) playback.pause()
      else await this.startListening()
    },

    // Where a tempo is written down, whoever moved it. Skipped while a button
    // is held (see the watches in init): setTempo reschedules every remaining
    // note of the piece, which is not something to do eleven times a second on
    // a thumb's behalf, and the tempi passed through on the way are nobody's
    // choice. The release commits the one the press landed on.
    commitBpm(field) {
      rememberBpm(field, this.scoreUrl, this[field])
      if (field === 'playbackBpm') playback.setTempo(this[field])
    },

    // What the playback band says: where the piece is held, or how to move it.
    playbackBandText() {
      if (this.playbackTransport === 'paused') return t('score.playbackPausedAt', { n: this.playbackMeasure + 1 })
      return t('score.playbackHint')
    },

    toggleStrictPlaythrough() {
      if (this.isStrictPlaying) {
        // Mid-run the engine's aborted result ends the loop; between runs the
        // loop has to be told itself.
        trainer?.stop()
        strictPlaythrough.stop()
        return
      }

      this.stopListening()

      strictPlaythrough.setActiveHands(this.activeHands)
      this.isStrictPlaying = true
      this.paintStrictRange()

      if (this.strictPassage.loop) this.startTempoTrainer()
      else this.startStrictRun(this.strictBpm).then((result) => this.finishSingleRun(result))
    },

    // One strict run of the selected passage at `bpm`, resolving with the
    // engine's result once it is over — and filed in the journal on the way.
    // `settle` is what follows a filing but can wait for the end of a loop:
    // the cloud sync and the reinforcement suggestions, which read the
    // score's whole history back.
    startStrictRun(bpm, { settle = true } = {}) {
      return new Promise((resolve) => {
        strictPlaythrough.start({
          bpm,
          allNotes: musicxml.getAllNotes(),
          osmdInstance: musicxml.getOsmdInstance(),
          // No pick means from the top — and index 0 is also what tells the
          // engine the run covers the whole score, so the journal sees it.
          startMeasureIndex: this.strictPassage.start ?? 0,
          endMeasureIndex: this.strictPassage.end,
          onCountIn: ({ beat, beats }) => {
            this.countInBeat = beat
            this.countInBeats = beats
          },
          onComplete: (result) => {
            this.countInBeat = 0
            // Not awaited here: the result modal is not going to wait on
            // IndexedDB, and the run is already fully described by `result`.
            // Chained, so that one await covers every run a loop has filed —
            // and caught, since a chain left rejected skips every link after
            // it: one run that failed to file would silently drop all the
            // others on the page, and throw from setMode's await.
            strictRunRecorded = strictRunRecorded
              .then(() => this.recordStrictRun(result, { settle }))
              .catch((error) => recordError(error, 'Strict run could not be recorded'))
            resolve(result)
          },
        })
      })
    },

    finishSingleRun(result) {
      this.isStrictPlaying = false
      this.paintStrictRange()
      if (result.aborted) return
      // A clean finish resets the start point so the next ▶ replays from
      // the top; aborted runs keep it for retry from the same spot.
      this.resetStrictRange()
      this.showStrictResult(result.verdict)
    },

    // Runs the passage in a loop until ⏸, the plan moving the tempo between
    // runs, then sums the session up in the result modal.
    async startTempoTrainer() {
      const plan = createTempoPlan({ mode: this.trainerMode, bpm: this.strictBpm })
      trainer = createTempoTrainer({
        plan,
        runOnce: (bpm) => {
          this.trainerStatus = { bpm, run: plan.runs.length + 1, cleanStreak: plan.cleanStreak }
          return this.startStrictRun(bpm, { settle: false })
        },
        // The streak moves as soon as the run is judged, not a pause later.
        onRun: () => (this.trainerStatus = { ...this.trainerStatus, cleanStreak: plan.cleanStreak }),
      })
      const summary = await trainer.start()
      trainer = null
      this.isStrictPlaying = false
      this.paintStrictRange()
      this.trainerStatus = null
      this.showTrainerSummary({ ...summary, runs: plan.runs })
      await strictRunRecorded
      await this.settleStrictRuns()
    },

    toggleLoop() {
      if (this.isStrictPlaying) this.toggleStrictPlaythrough()
      this.strictPassage.loop = !this.strictPassage.loop
      // The end of the passage is the loop's: a single run goes to the end.
      this.selectStrictPassage(this.strictPassage.start, null)
    },

    // A click sets where a run starts. With the loop on, the next click
    // further along sets where the passage ends; the one after starts over.
    pickStrictMeasure(measureIndex) {
      if (this.isStrictPlaying) this.toggleStrictPlaythrough()
      const { start, end, armed } = pickPassageMeasure(measureIndex, this.strictPassage)
      this.selectStrictPassage(start, end, armed)
    },

    // A passage the player picks, as opposed to the plumbing below. The last
    // run's marks are a verdict on the passage that was selected when it was
    // played, so picking another one takes them off: a note marked wrong in a
    // bar the new loop leaves out stays lit over work nobody is doing
    // (feedback b9d60a2b). Not in setStrictRange — a run that finishes resets
    // the start point through it, and that one has just earned its marks.
    selectStrictPassage(start, end, armed) {
      strictPlaythrough.clearMarks()
      this.setStrictRange(start, end, armed)
    },

    // `armed` belongs to the selection, so the setter writes it — a caller that
    // set it afterwards would be overwriting what this line had just said.
    setStrictRange(start, end, armed = false) {
      Object.assign(this.strictPassage, { start, end, armed })
      this.paintStrictRange()
    },

    // Back to a run from the top, with no marker on the score.
    resetStrictRange() {
      this.setStrictRange(null, null)
    },

    // The marker says where the *next* run starts. Once one is under way the
    // cursor says where the music is, and a square still sitting on a measure
    // the player passed bars ago only misleads (feedback 945d80b4) — so it
    // comes off for the length of the run and comes back, with the start point
    // a run stopped short keeps.
    //
    // Called at every move of the three values it reads. Clicking a measure
    // mid-run therefore paints twice: setStrictRange runs while the stop it
    // asked for is still on its way down, so the marker only lands on the
    // repaint that the end of the run triggers.
    paintStrictRange() {
      const show = this.mode === 'strict' && !this.isStrictPlaying
      musicxml.markStrictRange(show ? this.strictPassage.start : null, this.strictPassage.end)
    },

    // 🔁 in the training band, strict mode's loop button in its own: it arms
    // the second click that closes a passage. Either way round, toggling it
    // puts the work back on a single measure at the top of what was selected —
    // the passage's first bar, or the one the work has walked to on its own.
    toggleTrainingLoop() {
      this.trainingPassage.loop = !this.trainingPassage.loop
      const start = this.trainingPassage.end == null
        ? musicxml.getTrainingState().currentMeasureIndex
        : this.trainingPassage.start
      this.setTrainingRange(start, null)
    },

    // A click says which measure to work. With 🔁 on, the next click at or
    // after it closes the passage; the one after that starts the pick over.
    pickTrainingMeasure(measureIndex) {
      const { start, end, armed } = pickPassageMeasure(measureIndex, this.trainingPassage)
      this.setTrainingRange(start, end, armed)
    },

    // The engine normalises what it is given — a passage whose first bar the
    // ticked hand rests through starts where that hand actually plays — so what
    // it hands back is the passage being worked, and that is what the page
    // shows. Storing the raw click indices instead would let the band name a
    // passage other than the one under the cursor.
    setTrainingRange(start, end, armed = false) {
      const range = musicxml.setTrainingRange(start, end)
      Object.assign(this.trainingPassage, { start: range.start, end: range.end, armed })
    },

    // The page's side of the passage only. The engine clears its own whenever
    // it is handed a mode — entering training, or being given a reinforcement
    // list — so pushing this one back at it would only jump the cursor around.
    //
    // 🔁 goes off with it, where leaving strict mode keeps strict's armed: there
    // it switches single runs for the tempo trainer, a way of playing kept
    // across modes, while here it only says the next click closes a passage.
    resetTrainingRange() {
      Object.assign(this.trainingPassage, passage(0))
    },

    // What the training band says: what has to come out clean, and — while a
    // passage is being picked — which bar to click next. How many clean runs
    // that takes is the engine's number, not a literal in forty locale strings.
    trainingBandText() {
      const from = this.trainingPassage.start + 1
      const times = musicxml.getTrainingState().targetRepeatCount
      // Which bar to click is only said while the click is training's:
      // listening takes it over (see barClickOwner).
      const clickIsTraining = this.barClickOwner === 'training'
      if (this.trainingPassage.armed) return armedRangeText(from, clickIsTraining)
      // A passage of one bar is allowed, and "bars 5 to 5" is not a sentence.
      if (this.trainingPassage.end != null) return passageText('score.trainingPassage', this.trainingPassage, { times })
      if (this.trainingPassage.loop && clickIsTraining) return t('score.loopHint')
      return t('score.trainingHint', { times })
    },

    trainerModeLabel(mode) {
      return mode === GRADUATED
        ? t('score.trainerGraduated', { step: BPM_STEP, streak: STREAK })
        : t('score.trainerRandom')
    },

    // What the strict band says before a run, or during a loop.
    strictBandText() {
      if (this.trainerStatus) {
        const { bpm, run, cleanStreak } = this.trainerStatus
        const parts = [`${bpm} ${t('score.bpm')}`, t('score.loopRun', { n: run })]
        if (this.trainerMode === GRADUATED) parts.push(t('score.loopStreak', { n: cleanStreak, streak: STREAK }))
        return parts.join(' · ')
      }
      const from = (this.strictPassage.start ?? 0) + 1
      // What clicking a bar does is only worth saying while the click is
      // strict mode's: listening takes it over, and the playback band says so
      // for itself. Where the passage stands is still worth saying either way.
      const clickIsStrict = this.barClickOwner === 'strict'
      if (!this.strictPassage.loop) {
        if (from > 1) return t('score.startAt', { n: from })
        return clickIsStrict ? t('score.strictHint') : ''
      }
      if (this.strictPassage.armed) return armedRangeText(from, clickIsStrict)
      if (this.strictPassage.end != null) {
        return passageText('score.loopRange', { start: this.strictPassage.start ?? 0, end: this.strictPassage.end })
      }
      if (from > 1) return t('score.loopRangeOpen', { from })
      return clickIsStrict ? t('score.loopHint') : ''
    },

    // A strict run is practice like any other, and until it was filed here it
    // left no trace at all: its notes go to the strict engine instead of the
    // score's cursor, so none of the measure callbacks that feed the tracker in
    // free mode ever fire. The engine hands back the run measure by measure,
    // already timed at the tempo it was played at, and says whether it counts
    // as the piece played in full. A run nobody played to (the metronome
    // ticking on an empty keyboard) is not practice and is not recorded.
    async recordStrictRun(result, { settle = true } = {}) {
      if (!this.scoreUrl || !result.measures.length) return
      const { hit, offTempoEarly, offTempoLate, wrongNotes } = result.verdict
      if (hit + offTempoEarly + offTempoLate + wrongNotes === 0) return

      practiceTracker.recordStrictRun(result)
      // One session per run: a session carries at most one playthrough, and
      // ending it here is what credits the practice time to the journal.
      await rollSession('strict', { sync: false })
      if (settle) await this.settleStrictRuns()
    },

    // What follows the filing of a run, or of a loop's worth of them.
    settleStrictRuns() {
      triggerSync('session ended')
      return this.refreshReinforcementSuggestions()
    },

    // Reinforcement is a flavor of training, so currentMode reports
    // 'training' for it — the segmented control stays on the training tab.
    get currentMode() {
      return this.mode === 'reinforcement' ? 'training' : this.mode
    },

    // The one way the page changes mode: its tabs, the reinforcement badge and
    // the end of a reinforcement all come through here. What the mode being
    // left had running or lit is put away, and the session follows.
    async setMode(name, measuresToReinforce = []) {
      // The tab already pressed changes nothing — the training one included,
      // which a reinforcement keeps pressed.
      if (name === this.mode || name === this.currentMode) return
      // A piece playing itself competes with the player's hands.
      this.stopListening()
      if (this.isStrictPlaying) {
        // The tempo trainer's loop with it, which a run stopped between two
        // runs would not end.
        this.toggleStrictPlaythrough()
        // The run stopped by the switch closes the session it was played in;
        // the mode being switched to opens the next one. Sequenced, or the two
        // ends race and the session is credited twice.
        await strictRunRecorded
      }
      if (this.mode === 'strict') this.resetStrictRange()
      // A mode is entered on the whole piece: a passage picked in a previous
      // stint of training is not what the player asked for by tapping a tab.
      this.resetTrainingRange()
      // A mode switch starts on a clean score: whatever is lit on it — a
      // strict run's verdict, the notes a free or training run played —
      // belongs to the run that lit it, and that run is over. The two halves
      // are cleared by their own module, the second as the engine takes up
      // the new mode.
      strictPlaythrough.clearMarks()
      this.mode = name
      // Before the engine moves: a reinforcement starts its first measure at
      // once, and a measure started on the session being closed goes with it.
      await rollSession(this.currentMode)
      if (name === 'reinforcement') musicxml.setReinforcementMode(measuresToReinforce)
      else musicxml.setTrainingMode(name === 'training')
      // A new mode is a new start: a wait only counts again from the next key.
      keyHint.rest()
    },

    dismissKeyHint() {
      keyHint.dismiss()
    },

    // Close whichever modal is currently open when Escape is pressed, the
    // menu's layers first (closeMenuLayer). The fingering modal manages its own
    // keyboard handling (digits / backspace / enter / escape), so it is
    // intentionally not handled here.
    handleEscape() {
      if (this.closeMenuLayer()) return
      if (this.showResultModal) return this.closeResultModal()
      if (this.showHistoryModal) return (this.showHistoryModal = false)
      if (this.showMidiHelpModal) return (this.showMidiHelpModal = false)
      const noMidi = document.getElementById('noMidiModal')
      if (noMidi?.open) noMidi.close()
    },

    // Refreshed at every measure boundary, so the badge shows up as soon as a
    // passage has been fumbled rather than at the end of a playthrough. Reads
    // are ordered by sequence number: at that rate a slow one could otherwise
    // land on top of a fresher result.
    //
    // The list belongs to the hands ticked (feedback 0868d96f): what was
    // fumbled with the left hand alone is offered when the left hand alone is
    // on, and the label says so whenever it is not both.
    async refreshReinforcementSuggestions() {
      const seq = ++reinforcementRefreshSeq
      const measures = await practiceTracker.getMeasuresToReinforce(this.scoreUrl, handsKey(this.activeHands))
      if (seq === reinforcementRefreshSeq) this.measuresToReinforce = measures
    },

    // Shown only over a list, all of whose measures share the hands it was read
    // for. `words` as withHands takes it: the visible label says MD, the name
    // read aloud says the hand in full.
    reinforceLabel(words) {
      const measures = this.measuresToReinforce
      return withHands(tn('score.reinforce', measures.length), measures[0]?.hands ?? TWO_HANDS, words)
    },

    // From free play or from the strict tab, mid-piece or not: setMode puts
    // away what was under way, the strict run included.
    startReinforcementMode() {
      return this.setMode('reinforcement', this.measuresToReinforce)
    },

    // `changed` is the hand just ticked or unticked. No hand at all plays
    // nothing, so unticking the only hand ticked swaps to the other: from MD
    // alone, one click gives MG alone (feedback 65538ec6).
    updateActiveHands(changed) {
      if (!this.rightHandActive && !this.leftHandActive) {
        if (changed === 'right') this.leftHandActive = true
        else this.rightHandActive = true
      }
      musicxml.setActiveHands(this.activeHands)
      strictPlaythrough.setActiveHands(this.activeHands)
      practiceTracker.setActiveHands(this.activeHands)
      this.refreshReinforcementSuggestions()
    },

    // Everything the modal shows is made here, once, as it opens.
    async openScoreHistory() {
      if (!this.scoreUrl) return
      const [history, aggregate] = await Promise.all([
        practiceTracker.getScoreHistory(this.scoreUrl),
        storage.getAggregate(this.scoreUrl),
      ])
      this.scoreHistory = history.map(withRunLines)
      this.historyTotalMs = history.reduce((sum, d) => sum + (d.totalPracticeTimeMs || 0), 0)
      this.historyCharts = playthroughCharts(history.flatMap((d) => d.fullPlaythroughs))
      this.historyHotMeasures = hotMeasures(aggregate)
      this.showHistoryModal = true
    },

    // Attaches the current score to the shared feedback submission (see
    // headerMenu), so a report from the score page says what was open.
    feedbackContext() {
      return { score: this.scoreTitle || null }
    },

    formatDate,
    formatDuration,

    // Every redraw replaces the SVG, taking with it everything painted on it:
    // note colours, fingering handlers, the training cursor, the strict marker,
    // the marks a strict run left.
    // What the redraw cannot take is the session behind those marks — renderScore
    // keeps it across a rebuild of the note model — so this only paints it back.
    repaintScore() {
      fingeringEditor.alignFingeringLabelsToNoteheads()
      this.setupFingeringHandlers()
      musicxml.repaintNoteMarks()
      // After the free and training marks: a strict hit wears the same class,
      // and the two paint it from stores of their own.
      strictPlaythrough.repaintMarks()
      musicxml.updateMeasureCursor()
      // The click rectangles are rebuilt by the redraw, so the marker went with them.
      this.paintStrictRange()
    },

    // A full redraw: the note model is rebuilt from OSMD's sheet, which is how a
    // fingering just injected into it reaches the page.
    rerenderScore() {
      const scrollY = window.scrollY
      musicxml.renderScore()
      this.repaintScore()
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
      if (this.isStrictPlaying || this.isListening) return
      // OSMD lays out against the container width alone, so a height-only change
      // would redraw to a pixel-identical score. Worth skipping: on mobile the URL
      // bar collapsing fires resize, and free mode scrolls the score as you play.
      const width = document.getElementById('score')?.clientWidth
      if (width === this.lastRelayoutWidth) return
      this.lastRelayoutWidth = width

      const scrollY = window.scrollY
      // relayoutScore, not renderScore: the sheet has not changed, only the width
      // it is drawn to, so there is nothing to re-extract.
      musicxml.relayoutScore()
      this.repaintScore()
      window.scrollTo(0, scrollY)
    },
  }
}
