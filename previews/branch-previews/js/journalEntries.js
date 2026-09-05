// The practice-journal entry line — one score practised on one day — shared by
// the library sidebar and the calendar's day panel.
//
// Both render the same thing from the same source (a getDailyLog() row), so the
// markup lives here once. Same markup-as-strings device as headerMenu.js, and
// for the same reason: no build step, so no HTML-include mechanism. See the
// note there.
//
// Each page marks the spot with an element carrying the Alpine expression that
// yields the rows, and mountJournalEntries() swaps the block in before Alpine
// boots:
//
//   <div data-journal-entries="dateEntry.log"></div>
//
// The component behind it must expose scorePageUrl(), formatDuration() and the
// journalEntryHelpers below.
import { playthroughGroups } from './hands.js'
import { withRunKind } from './utils.js'
import { tn } from './i18n.js'

// Alpine expressions read the component's scope, not this module's, so the
// helpers the markup calls are spread into both pages' data.
export const journalEntryHelpers = {
  playthroughGroups,

  // "Joué 3× en entier · main droite" — one line per hand selection and per
  // kind of run, so a day spent on the right hand alone doesn't read as the
  // piece played whole, and a run to the metronome isn't mistaken for a free
  // one.
  playedFullLabel(group) {
    const n = group.playthroughs.length
    return withRunKind(tn('journal.playedFull', n), group)
  },
}

const ENTRIES_HTML = (rows) => `
<div class="pt-journal__entries">
  <template x-for="entry in ${rows}" :key="entry.scoreId">
    <div class="pt-journal__entry">
      <a :href="scorePageUrl(entry.scoreId)" x-text="(entry.scoreTitle || $t('journal.untitled')) + ' · ' + entry.composer"></a>
      <small>
        <span x-text="formatDuration(entry.totalPracticeTimeMs)"></span>
        <template x-for="group in playthroughGroups(entry.fullPlaythroughs)" :key="group.key">
          <span> · <span x-text="playedFullLabel(group)"></span></span>
        </template>
        <span x-show="entry.fullPlaythroughs.length === 0"> · <span x-text="$tn('journal.measuresCount', entry.measuresWorked.length)"></span></span>
        <span x-show="entry.measuresReinforced.length > 0"> · <span x-text="$tn('journal.reinforcedCount', entry.measuresReinforced.length)"></span></span>
      </small>
    </div>
  </template>
</div>`

// Must run BEFORE Alpine boots, so it processes the x-* bindings.
//
// Recurses into <template> content: it is a separate document fragment that
// querySelectorAll does not reach into, and the library's slot sits inside the
// journal's own x-for template.
export function mountJournalEntries(root = document) {
  for (const slot of root.querySelectorAll('[data-journal-entries]')) {
    const block = document.createElement('div')
    block.innerHTML = ENTRIES_HTML(slot.getAttribute('data-journal-entries'))
    slot.replaceWith(...block.childNodes)
  }
  for (const template of root.querySelectorAll('template')) mountJournalEntries(template.content)
}
