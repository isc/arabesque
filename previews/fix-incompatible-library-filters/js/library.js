import { initMidi } from './midi.js'
import { initPracticeTracker, STATUS_THRESHOLDS, hasMinimumPractice } from './practiceTracker.js'
import { initStorage } from './storage.js'
import { formatDuration, formatDate, formatRelativeDate, statusLabel, scorePageUrl } from './utils.js'
import { journalEntryHelpers } from './journalEntries.js'
import { PERIODS, periodLabel, getPeriodForComposer } from './musicalPeriods.js'
import { headerMenu } from './headerMenu.js'
import { listProfiles, currentProfile, profileName, switchProfile } from './profiles.js'
import { initAutoSync } from './autoSync.js'
import { onDayChange } from './dayRollover.js'
import { t, tn, locale } from './i18n.js'

const MIN_MATCH = 5
const STATUS_ORDER = ['dechiffrage', 'perfectionnement', 'repertoire']
const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]))
// Two weeks of journal: eight days dropped a Tuesday/Wednesday pair out of
// sight after a single weekend, which reads as a hole in the history rather
// than as the edge of the window.
const DAYS_TO_SHOW = 14
const STALE_DAYS = 7
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000
// The focus chips, in the order they are offered — the library's own list, so
// they read like STATUS_ORDER/statusLabel and PERIODS/periodLabel next door.
const FOCUS_LABEL_KEYS = {
  reinforce: 'focus.reinforce',
  'near-mastery': 'focus.nearMastery',
  stale: 'focus.stale',
}
const FOCUS_VALUES = Object.keys(FOCUS_LABEL_KEYS)
const focusLabel = (value) => t(FOCUS_LABEL_KEYS[value], { n: STALE_DAYS })
// The dropdown/pill filters, as opposed to the search box: what each one keeps.
// One entry wires up everything they share — narrowing the list, the badge on
// the narrow-screen "Filtrer" button, the URL, which values are worth offering
// at all (see offered), and the count each option carries (see facetOptions).
const FILTER_MATCHERS = {
  statusFilter:   (app, score, value) => app.getStatusFor(score) === value,
  composerFilter: (app, score, value) => score.composer === value,
  periodFilter:   (app, score, value) => getPeriodForComposer(score.composer) === value,
  focusFilter:    (app, score, value) => app.matchesFocus(score, value),
}
const FILTER_KEYS = Object.keys(FILTER_MATCHERS)

// Synthesized collection aggregates, keyed by the catalog entry. Cleared
// whenever the practice data behind them is reloaded — see refreshPracticeData.
const collectionAggregates = new Map()

// The ways to release some of `keys`, fewest first — [a], [b], [a, b] — so a
// pick gives up as little as it can. At most three filters are ever in play
// besides the one being picked, so this is at most seven combinations.
function releaseCombinations(keys) {
  return Array.from({ length: 1 << keys.length }, (_, mask) => keys.filter((_, i) => mask & (1 << i)))
    .filter((combo) => combo.length > 0)
    .sort((a, b) => a.length - b.length)
}
// `statusFilter` travels as ?status=, and so on: the query string is read by
// people, and shared.
const urlParam = (key) => key.replace(/Filter$/, '')

export function libraryApp() {
  const midi = initMidi()
  const storage = initStorage()
  const practiceTracker = initPracticeTracker(storage)

  let fingerprints = []
  let matchPointers = {}
  let searchResetTimer = null
  let sessionCountByFile = {}

  return {
    ...headerMenu(),

    // --- Profiles ---
    // Who is playing, shown as the chip in the header and changed from the
    // chooser it opens. Read once: the current profile cannot change within a
    // page, switching navigates.
    profiles: listProfiles(),
    currentProfile: currentProfile(),
    profileName,
    showProfilesModal: false,
    switchToProfile(id) {
      if (id === this.currentProfile.id) {
        this.showProfilesModal = false
        return
      }
      switchProfile(id)
      // A fresh start on that profile's data, from the library. Every module
      // derived its storage names from the profile at import time, so a
      // navigation is the only honest way to change it (profiles.js). Not a
      // reload: assign() drops the query string, so the filters mirrored there
      // do not carry over to the profile being switched to.
      window.location.assign('library.html')
    },

    scores: [],
    searchQuery: '',
    statusFilter: '',
    composerFilter: '',
    periodFilter: '',    // '' | 'baroque' | 'classique' | 'romantique' | 'moderne' | 'contemporain' | 'traditionnel'
    focusFilter: '',     // '' | 'reinforce' | 'near-mastery' | 'stale'
    sortBy: 'lastPlayed', // 'title' | 'composer' | 'status' | 'practice' | 'lastPlayed'
    sortDir: 'desc',      // 'asc' | 'desc'
    // Both only matter below the breakpoint where .pt-librarybar and
    // .pt-librarytabs appear: a wide screen lays out the filters and both panes
    // regardless, so neither of these has a rule to match there.
    filtersOpen: false,
    tab: 'journal',   // 'journal' | 'scores' — the visible pane on a phone
    baseUrl: '',
    dailyLogsByDate: [],
    // In-flight refreshPracticeViews(), shared by concurrent callers.
    refreshingPractice: null,
    lastPlayedByScore: {},
    aggregatesByScore: {},

    async init() {
      // Mark this visitor as a returning user so the landing page (/) can
      // redirect them straight here instead of showing the pitch each time.
      try {
        localStorage.setItem('arabesque:returning', '1')
      } catch {
        // localStorage unavailable (private mode): no marker, no redirect — fine.
      }

      for (const key of [...FILTER_KEYS, 'searchQuery']) {
        this.$watch(key, () => this.syncUrl())
      }

      // Narrowing the list means you want to see it. The search box is the one
      // narrowing control reachable from the journal pane — it sits in the
      // header, above both — so it is the only one that has to say so here.
      this.$watch('searchQuery', () => this.showScoresIfNarrowed())

      // Folding the filters away with the pane keeps the two switches from
      // making four states out of two: coming back to the list always shows it
      // the way opening it does.
      this.$watch('tab', (value) => {
        if (value !== 'scores') this.filtersOpen = false
      })

      // "/" focuses the search input (GitHub / YouTube convention). Skip when
      // the user is already typing somewhere so the slash isn't swallowed.
      document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
        if (e.target instanceof Element &&
            e.target.matches('input, textarea, select, [contenteditable="true"]')) return
        const search = document.querySelector('input[type="search"]')
        if (!search) return
        e.preventDefault()
        search.focus()
        search.select()
      })

      midi.setCallbacks({
        onNotePlayed: (_, midiNote) => this.handleSearchNote(midiNote),
      })
      midi.connectMIDI({ silent: true, autoSelectFirst: true })

      // Reaching this page via history.back() (e.g. the MIDI "highest key"
      // shortcut) can restore it from the browser's back/forward cache: a
      // frozen snapshot from before the user practiced, with init() never
      // re-running. Refresh just the practice-derived data so the journal
      // and status pills reflect what was just played.
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) this.refreshPracticeViews()
      })

      // The journal's rows are laid out from today's date, and the "Pratiqué"
      // column is relative to it.
      onDayChange(() => this.refreshPracticeViews())

      const [scoresResponse, fingerprintsResponse] = await Promise.all([
        fetch('data/scores.json'),
        fetch('data/fingerprints.json'),
        practiceTracker.init(),
      ])
      const data = await scoresResponse.json()
      this.baseUrl = data.baseUrl

      const fpData = await fingerprintsResponse.json()
      fingerprints = fpData.fingerprints

      await this.refreshPracticeData()

      this.scores = data.scores

      // Restore filters from URL once the scores are in: the <select>
      // dropdowns show their value through :selected on each <option>, and
      // those are rendered by an x-for over periodOptions / composerOptions,
      // which depend on this.scores. $nextTick gives that x-for a chance to
      // flush, so the restored value has an option to land on.
      //
      // Set directly rather than through pickFilter: a URL says what its sender
      // was looking at, and resolving it would rewrite the address bar on load
      // — and resolve differently per profile, since statuses are read from the
      // reader's own practice data. A dead combination gets the empty-state
      // panel and its way out instead.
      await this.$nextTick()
      const params = new URLSearchParams(window.location.search)
      for (const key of FILTER_KEYS) this[key] = params.get(urlParam(key)) || ''
      this.searchQuery = params.get('q') || ''
      // Synchronously, rather than leaving it to the $watch above: that flushes
      // on a microtask, which is a frame of the wrong pane on first paint.
      this.showScoresIfNarrowed()

      await this.reloadDailyLogs()

      // The library is where synced data shows up (journal, status pills), so
      // it syncs on open and on tab focus, and redraws whatever came down.
      initAutoSync({ storage, practiceTracker }, {
        syncOnOpen: true,
        onSynced: (summary) => {
          if (summary.pulled) this.refreshPracticeViews()
          if (summary.profilesChanged) this.profiles = listProfiles()
        },
      })
    },

    // Everything on this page derived from practice data, redrawn together.
    // The two reads are independent, and each walks the whole session store —
    // no reason to pay for them one after the other. Three triggers can ask for
    // this (a bfcache restore, a sync that pulled, the day turning over) and a
    // resume the next morning fires more than one of them, so callers arriving
    // while a refresh is in flight share it rather than walking the store again.
    refreshPracticeViews() {
      this.refreshingPractice ??= Promise.all([
        this.refreshPracticeData(),
        this.reloadDailyLogs(),
      ]).finally(() => {
        this.refreshingPractice = null
      })
      return this.refreshingPractice
    },

    // Recomputes lastPlayedByScore/aggregatesByScore/sessionCountByFile from
    // storage. Safe to call more than once (each map is rebuilt from
    // scratch), unlike the rest of init() which registers listeners.
    async refreshPracticeData() {
      this.lastPlayedByScore = {}
      this.aggregatesByScore = {}
      collectionAggregates.clear()
      sessionCountByFile = {}

      const [sessions, aggregates] = await Promise.all([storage.getSessions(), storage.getAllAggregates()])

      for (const session of sessions) {
        const existing = this.lastPlayedByScore[session.scoreId]
        if (!existing || session.startedAt > existing) {
          this.lastPlayedByScore[session.scoreId] = session.startedAt
        }
        if (session.scoreId.startsWith(this.baseUrl)) {
          const file = session.scoreId.slice(this.baseUrl.length)
          sessionCountByFile[file] = (sessionCountByFile[file] ?? 0) + 1
        }
      }

      // Aggregates power the status filter, status pills, and practice-focus banner.
      for (const agg of aggregates) {
        if (!agg || (agg.practiceDays || []).length === 0) continue
        this.aggregatesByScore[agg.scoreId] = agg
      }
    },

    handleSearchNote(midiNote) {
      if (fingerprints.length === 0) return

      clearTimeout(searchResetTimer)

      let maxPos = 0
      let leader = null
      let leaderSessions = -1

      for (const fp of fingerprints) {
        const pos = matchPointers[fp.file] ?? 0
        const advanced = pos < fp.notes.length && fp.notes[pos] === midiNote
        const currentPos = advanced ? pos + 1 : pos

        if (advanced) matchPointers[fp.file] = currentPos

        if (currentPos > maxPos) {
          maxPos = currentPos
          leader = fp
          leaderSessions = sessionCountByFile[fp.file] ?? 0
        } else if (currentPos === maxPos && currentPos > 0) {
          const count = sessionCountByFile[fp.file] ?? 0
          if (count > leaderSessions) {
            leader = fp
            leaderSessions = count
          } else if (count === leaderSessions) {
            leader = null
          }
        }
      }

      if (maxPos >= MIN_MATCH && leader !== null) {
        window.location.href = scorePageUrl(this.baseUrl + leader.file)
        return
      }

      searchResetTimer = setTimeout(() => this.resetNoteSearch(), 3000)
    },

    resetNoteSearch() {
      matchPointers = {}
      clearTimeout(searchResetTimer)
    },

    get searchResults() {
      if (!this.searchQuery) return this.scores
      const regexes = this.searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean).map((w) => new RegExp(`\\b${w}`))
      return this.scores.filter((score) => {
        const text = `${score.title} ${score.composer}`.toLowerCase()
        return regexes.every((r) => r.test(text))
      })
    },

    // The scores a given set of filter values leaves, the search box always
    // having its say — `this` is itself a valid selection, since the component
    // carries statusFilter & co. as own properties.
    // Does this score answer every filter the selection sets?
    matchesSelection(score, selection) {
      return FILTER_KEYS.every((key) => !selection[key] || FILTER_MATCHERS[key](this, score, selection[key]))
    },

    // Whether any score at all answers a selection. Short-circuits, where
    // matching() builds the whole list — and resolvedSelection asks this of
    // every option of every facet on every render.
    hasMatch(selection) {
      return this.searchResults.some((score) => this.matchesSelection(score, selection))
    },

    // The scores a given set of filter values leaves, the search box always
    // having its say — `this` is itself a valid selection, since the component
    // carries statusFilter & co. as own properties.
    matching(selection) {
      return this.searchResults.filter((score) => this.matchesSelection(score, selection))
    },

    // The filters that clicking `value` on `key` would leave standing. The pick
    // itself always survives; of the others, as few as possible are released.
    //
    // Picking a filter says what you want to see, so it is the filters already
    // set that give way — greying the pick out instead would leave you to work
    // out which of the others was in the way, and clear it yourself. But only
    // the ones actually in the way: releasing them in a fixed order would let
    // "Baroque", clicked under Déchiffrage + Chopin, drop the status too, when
    // only the composer conflicted. Fewest first, so a release is never wider
    // than the conflict; declaration order breaks ties between equal-sized
    // ones. Clearing a filter only widens the list, so it releases nothing.
    resolvedSelection(key, value) {
      const base = Object.fromEntries(FILTER_KEYS.map((k) => [k, k === key ? value : this[k]]))
      if (!value || this.hasMatch(base)) return base

      const others = FILTER_KEYS.filter((k) => k !== key && base[k])
      let widest = base
      for (const combo of releaseCombinations(others)) {
        widest = { ...base, ...Object.fromEntries(combo.map((k) => [k, ''])) }
        if (this.hasMatch(widest)) return widest
      }
      // Nothing left to release: the search box is the one narrowing the list,
      // and it is never released — what was typed is not the app's to discard.
      return widest
    },

    get filteredScores() {
      const dir = this.sortDir === 'asc' ? 1 : -1
      return this.matching(this).toSorted((a, b) => {
        const va = this.sortKey(a), vb = this.sortKey(b)
        if (this.sortBy === 'status') return ((STATUS_RANK[va] ?? -1) - (STATUS_RANK[vb] ?? -1)) * dir
        if (typeof va === 'number') return (va - vb) * dir
        return (va || '').localeCompare(vb || '', locale()) * dir
      })
    },

    sortKey(score) {
      switch (this.sortBy) {
        case 'title':      return score.title
        case 'composer':   return score.composer
        case 'status':     return this.getStatusFor(score)
        case 'practice':   return this.getPracticeTimeFor(score)
        default:           return this.lastPlayedByScore[this.getScoreUrl(score)] || ''
      }
    },

    toggleSort(column) {
      if (this.sortBy === column) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
        return
      }
      this.sortBy = column
      // Text columns sort A→Z by default; numeric/date columns biggest/most-recent first.
      this.sortDir = (column === 'title' || column === 'composer') ? 'asc' : 'desc'
    },

    // The narrow-screen sort control, which replaces the sortable table headers
    // once the rows are cards. lastPlayed has no column of its own but is the
    // default order, so it has to be offered somewhere.
    get sortOptions() {
      return [
        { value: 'lastPlayed', label: t('library.sortLastPlayed') },
        { value: 'title',      label: t('library.colTitle') },
        { value: 'composer',   label: t('library.colComposer') },
        { value: 'status',     label: t('library.colStatus') },
        { value: 'practice',   label: t('library.colPractice') },
      ]
    },

    // A filter or a search is a request for the list, wherever it came from —
    // a link, or the search box while the journal is showing.
    showScoresIfNarrowed() {
      if (this.activeFilterCount > 0 || this.searchQuery) this.tab = 'scores'
    },

    get tabs() {
      return [
        { value: 'journal', label: t('library.tabJournal') },
        { value: 'scores', label: t('library.tabScores') },
      ]
    },

    // Badge on the "Filtrer" button: what is still narrowing the list while the
    // filters themselves are folded away. Search is not one of them — its input
    // stays visible, so it needs no reminder.
    get activeFilterCount() {
      return FILTER_KEYS.filter((key) => this[key]).length
    },

    sortArrow(column) {
      if (this.sortBy !== column) return ''
      return this.sortDir === 'asc' ? ' ▲' : ' ▼'
    },

    // The way out when the filters and the search leave nothing on screen. The
    // search box goes with them: it narrows the list the same way, and leaving
    // it on would keep the list empty.
    clearFilters() {
      for (const key of FILTER_KEYS) this[key] = ''
      this.searchQuery = ''
    },

    // Clicking the same value clears the filter — natural toggle for pills —
    // and any other filter that had nothing in common with the new one is
    // released with it, so a pick always lands on something. See
    // resolvedSelection.
    pickFilter(key, value) {
      const selection = this.resolvedSelection(key, this[key] === value ? '' : value)
      for (const k of FILTER_KEYS) this[k] = selection[k]
    },

    setStatusFilter(status)     { this.pickFilter('statusFilter', status) },
    setComposerFilter(composer) { this.pickFilter('composerFilter', composer) },
    setPeriodFilter(period)     { this.pickFilter('periodFilter', period) },
    setFocusFilter(focus)       { this.pickFilter('focusFilter', focus) },

    // How many scores picking `value` on `key` would put on screen — the one
    // question every count in the filter bar answers. '' is "Tous": the filter
    // cleared, the others as they are.
    countFor(key, value) {
      return this.matching(this.resolvedSelection(key, value)).length
    },

    syncUrl() {
      const params = new URLSearchParams()
      for (const key of FILTER_KEYS) {
        if (this[key]) params.set(urlParam(key), this[key])
      }
      if (this.searchQuery)    params.set('q', this.searchQuery)
      const qs = params.toString()
      const url = qs ? `?${qs}` : window.location.pathname
      window.history.replaceState(null, '', url)
    },

    // The options of one filter, each carrying the number of scores clicking it
    // would actually put on screen — which is the count against the filters
    // that would survive the click, not against the whole library and not
    // against filters the click is about to release. A filtered library used to
    // advertise counts from the whole library and then answer with an empty
    // table; no option shown here is ever a dead end.
    //
    // `values` is what the library itself can offer, so a status nobody has
    // reached is not listed at all rather than listed at nought.
    facetOptions(key, values, label = (value) => value) {
      return values.map((value) => ({ value, label: label(value), count: this.countFor(key, value) }))
    },

    // Of `values`, the ones some score in the library answers — asked through
    // FILTER_MATCHERS, so a filter's one entry there still wires up everything
    // about it. A status nobody has reached is not offered at all rather than
    // offered at nought, and a score can answer several focus chips at once,
    // which is why this is a pass and not a Set of one value per score.
    offered(key, values) {
      const match = FILTER_MATCHERS[key]
      return values.filter((value) => this.scores.some((score) => match(this, score, value)))
    },

    // The values apart from the counts: the markup's x-show guards ask only
    // whether a facet is worth showing, and Alpine evaluates every binding as
    // its own effect — asking facetOptions there would resolve conflicts and
    // count every option a second time, doubling the whole filter bar's work.
    get composerValues() {
      const all = [...new Set(this.scores.map((s) => s.composer).filter(Boolean))]
      return all.sort((a, b) => a.localeCompare(b, locale()))
    },
    get periodValues() { return this.offered('periodFilter', PERIODS) },
    get focusValues()  { return this.offered('focusFilter', FOCUS_VALUES) },

    get statusOptions() {
      return this.facetOptions('statusFilter', this.offered('statusFilter', STATUS_ORDER), statusLabel)
    },

    get composerOptions() {
      return this.facetOptions('composerFilter', this.composerValues)
    },

    get periodOptions() {
      return this.facetOptions('periodFilter', this.periodValues, periodLabel)
    },

    // Each focus chip filters the table to an actionable subset — the user
    // can immediately see which pieces match, unlike a passive count banner.
    matchesFocus(score, focus) {
      const agg = this.aggregateFor(score)
      if (!agg) return false
      const measures = Object.values(agg.measures || {})
      if (focus === 'reinforce') {
        return measures.some((m) => (m.totalAttempts || 0) >= 2 && (m.errorRate || 0) > 0.4)
      }
      if (focus === 'near-mastery') {
        if (agg.status !== 'perfectionnement' || measures.length === 0) return false
        const clean = measures.filter((m) => (m.cleanAttempts || 0) >= STATUS_THRESHOLDS.perfectionnement.cleanAttempts).length
        return clean / measures.length >= 0.8
      }
      if (focus === 'stale') {
        return !!agg.lastPlayedAt && Date.now() - new Date(agg.lastPlayedAt).getTime() > STALE_MS
      }
      return false
    },

    get focusOptions() {
      return this.facetOptions('focusFilter', this.focusValues, focusLabel)
    },

    // Under the filtered list: what the pieces on screen still have to clear to
    // earn the status above theirs. Narrowing to a status is asking what that
    // status means, and the answer was nowhere in the app. The numbers come
    // from STATUS_THRESHOLDS, the same object computeScoreStatus() judges by.
    // Null when the filter names no next status — nothing selected, or
    // Répertoire, which is the top.
    get statusCriteria() {
      // "Proches du répertoire" is a subset of Perfectionnement, so it asks the
      // same question about the same next step.
      const from = this.focusFilter === 'near-mastery' ? 'perfectionnement' : this.statusFilter
      // With no filter `from` is '', so STATUS_RANK[from] is undefined and the
      // index NaN — the lookup yields undefined and the getter returns null.
      const target = STATUS_ORDER[STATUS_RANK[from] + 1]
      if (!target) return null

      const { cleanAttempts, measureRatio, practiceDays, timesCompleted } = STATUS_THRESHOLDS[target]
      const items = [
        measureRatio === 1
          ? t('criteria.cleanMeasuresAll', { n: cleanAttempts })
          : t('criteria.cleanMeasures', { percent: Math.round(measureRatio * 100), n: cleanAttempts }),
        tn('criteria.completed', timesCompleted),
      ]
      if (practiceDays) items.push(t('criteria.practiceDays', { n: practiceDays }))

      return { heading: t('criteria.heading', { status: statusLabel(target) }), items }
    },

    // A collection ("recueil", e.g. les 20 exercices de Hanon) is a single
    // library row whose entry has `parts` instead of `file`. Practice data
    // stays keyed per part file; the row aggregates it and opening the row
    // resumes the last-played part.
    isCollection(score) { return Array.isArray(score.parts) },

    lastPlayedPartOf(score) {
      let best = null
      for (const part of score.parts) {
        const at = this.lastPlayedByScore[this.baseUrl + part.file]
        if (at && (!best || at > best.at)) best = { part, at }
      }
      return best?.part
    },

    getScoreUrl(score) {
      const file = this.isCollection(score)
        ? (this.lastPlayedPartOf(score) ?? score.parts[0]).file
        : score.file
      return this.baseUrl + file
    },

    aggregateFor(score) {
      if (!this.isCollection(score)) return this.aggregatesByScore[this.getScoreUrl(score)]
      // Synthesized from the parts, and remembered: the filter bar asks what
      // every option would show, so this used to be rebuilt some five hundred
      // times per render — pooling the measures of all twenty Hanon exercises
      // each time, for an object thrown away immediately. It only changes when
      // the practice data does, and refreshPracticeData drops the cache.
      if (collectionAggregates.has(score)) return collectionAggregates.get(score)
      const built = this.synthesizeCollectionAggregate(score)
      collectionAggregates.set(score, built)
      return built
    },

    // Times summed, dates maxed, measures pooled (keys namespaced by part —
    // focus chips only look at the values). No status: statuses live per
    // exercise, not per recueil.
    synthesizeCollectionAggregate(score) {
      let agg = null
      for (const part of score.parts) {
        const partAgg = this.aggregatesByScore[this.baseUrl + part.file]
        if (!partAgg) continue
        agg ??= { totalPracticeTimeMs: 0, timesCompleted: 0, timesCompletedOneHand: 0, lastPlayedAt: null, lastCompletedAt: null, measures: {} }
        agg.totalPracticeTimeMs += partAgg.totalPracticeTimeMs || 0
        agg.timesCompleted += partAgg.timesCompleted || 0
        agg.timesCompletedOneHand += partAgg.timesCompletedOneHand || 0
        for (const key of ['lastPlayedAt', 'lastCompletedAt']) {
          if (partAgg[key] && (!agg[key] || partAgg[key] > agg[key])) agg[key] = partAgg[key]
        }
        for (const [index, measure] of Object.entries(partAgg.measures || {})) {
          agg.measures[`${part.file}:${index}`] = measure
        }
      }
      return agg
    },
    // The stored status is the tracker's verdict from the last time the piece
    // was played — for a row graded before the practice floor existed, that
    // verdict predates the rule. Applying the floor here as well retires those
    // badges on sight, instead of waiting for a piece nobody plays to be played
    // again, and saves a migration over everyone's aggregates.
    getStatusFor(score) {
      const aggregate = this.aggregateFor(score)
      return hasMinimumPractice(aggregate) ? aggregate.status : null
    },
    getPracticeTimeFor(score)  { return this.aggregateFor(score)?.totalPracticeTimeMs || 0 },

    // Returns '' (not "0×") for never-completed scores, so Alpine x-show
    // can hide the sub-line entirely instead of leaving an empty row. Runs
    // played with one hand are counted apart: they are not the piece played
    // in full, and they don't move "last played in full".
    getPracticeSubline(score) {
      const agg = this.aggregateFor(score)
      const last = agg?.lastCompletedAt || agg?.lastPlayedAt
      const times = agg?.timesCompleted || 0
      const oneHand = agg?.timesCompletedOneHand || 0
      const parts = []
      if (times > 0) parts.push(t('library.timesPlayed', { n: times }))
      if (oneHand > 0) parts.push(t('library.timesPlayedOneHand', { n: oneHand }))
      if (last) parts.push(formatRelativeDate(last))
      return parts.join(' · ')
    },

    formatDuration,
    formatDate,
    statusLabel,
    scorePageUrl,
    ...journalEntryHelpers,

    // Enriches the shared feedback submission (see headerMenu) with aggregate,
    // non-identifying usage stats — how much the reporter actually practises,
    // without revealing which scores.
    feedbackContext() {
      const aggs = Object.values(this.aggregatesByScore)
      return {
        stats: {
          scores_total: this.scores.length,
          scores_practiced: aggs.length,
          total_practice_time_ms: aggs.reduce((sum, a) => sum + (a.totalPracticeTimeMs || 0), 0),
        },
      }
    },

    getTotalPracticeTimeForDate(dateEntry) {
      return dateEntry.log.reduce((sum, entry) => sum + entry.totalPracticeTimeMs, 0)
    },

    async reloadDailyLogs() {
      const dates = Array.from({ length: DAYS_TO_SHOW }, (_, i) => {
        const date = new Date()
        date.setDate(date.getDate() - i)
        return date
      })
      const logs = await practiceTracker.getDailyLogs(dates)
      this.dailyLogsByDate = dates.map((date, i) => ({ date, log: logs[i] }))
    },
  }
}
