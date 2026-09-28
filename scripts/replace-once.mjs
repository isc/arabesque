// A generated line written into a checked-in file, in place of the marker that
// stands there in the repository — how stamp-version.mjs writes the build
// version and the precache list, and how changelog.mjs writes the pending
// entries. Exactly one match is the whole point: a marker that has drifted or
// been duplicated must stop the deploy, loudly, rather than silently ship a
// file with the old value still in it.
//
// The replacement goes in as written. Handed to String#replace as a string,
// its `$'`, `$&` and `$$` would be read as patterns — and it carries free
// text: a changelog entry holding `$'` would splice the rest of changelog.js
// into a string literal, and every page importing the file would fail to load.
import { readFileSync, writeFileSync } from 'node:fs'

export function replaceOnce(file, pattern, replacement) {
  try {
    writeFileSync(file, replacedOnce(readFileSync(file, 'utf8'), pattern, replacement, file))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

// The same on text in hand, throwing rather than stopping the process: `where`
// names the text in the error.
export function replacedOnce(text, pattern, replacement, where = 'text') {
  const count = (text.match(new RegExp(pattern.source, pattern.flags + 'g')) ?? []).length
  if (count !== 1) throw new Error(`${where}: expected exactly one ${pattern}, found ${count}`)
  return text.replace(pattern, () => replacement)
}
