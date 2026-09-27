// Run before every test file (vitest.config.js).
//
// The suite is written in English, the language i18n falls back to. Node 21
// and later have a navigator whose language follows the OS locale, so from a
// French shell i18n picked French and every test reading an English string
// failed — while CI, on an English runner, stayed green. Pinned here rather
// than in each file, so a new test is right on every machine without knowing
// any of this. A test that wants French stores the choice, as
// loopRangeText.test.js does: i18n reads that first.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
}
