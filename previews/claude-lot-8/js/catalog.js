// The score catalog, data/scores.json, and the one rule for reading it: a
// listed file is filed under `baseUrl + file`, the string every session,
// aggregate and fingering of it is keyed by. A collection is one entry that
// lists its parts, each a file of its own and each filed apart.
//
// Read once per page, and again after a read that failed. `byUrl` holds the
// rule's answer for every listed file: the entry listing it (the
// collection's, for a part), its place among the parts, and its name — a part
// goes by its own title, under its collection's composer. That name is the
// one the library and the journal show, whatever the file itself says: the
// two disagree on a quarter of the catalog.
let catalog = null

export function loadCatalog() {
  catalog ??= fetch('data/scores.json')
    .then((response) => response.json())
    .then((data) => ({ ...data, byUrl: indexByUrl(data) }))
    .catch((error) => {
      catalog = null
      throw error
    })
  return catalog
}

export function isCollection(score) {
  return Array.isArray(score.parts)
}

// What an entry stands for, a file each: a collection's parts, or the entry
// itself. Both carry a `title` and a `file`.
export function partsOf(score) {
  return isCollection(score) ? score.parts : [score]
}

export function fileUrl({ baseUrl }, file) {
  return baseUrl + file
}

function indexByUrl(data) {
  const byUrl = new Map()
  for (const score of data.scores) {
    partsOf(score).forEach(({ title, file }, index) => {
      byUrl.set(fileUrl(data, file), { score, index, name: { title, composer: score.composer } })
    })
  }
  return byUrl
}
