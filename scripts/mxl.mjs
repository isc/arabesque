// Reading and writing the `.mxl` archives most of `public/scores/` is made of,
// with nothing but `node:zlib`. An `.mxl` is a ZIP holding one MusicXML file
// (named by `META-INF/container.xml`) plus whatever else the engraver put
// there, and the browser opens it with JSZip — but JSZip is a page dependency,
// not a `node_modules` one, and the Ruby side of `scripts/` shells out to
// `unzip`, which is not installed everywhere this repository is checked out.
// Rather than add a dependency for one maintenance script, this reads the
// central directory itself: a hundred lines against a format that has not
// changed since 1993, for archives an engraver wrote and we rewrite one entry
// of.
//
// `writeArchive` is deterministic — fixed DOS timestamp, fixed deflate level —
// so rewriting an archive with the same contents produces the same bytes. That
// is what lets `import-fingerings.mjs` promise a second run changes nothing:
// the file it would write is byte-for-byte the file already there.
//
// Not handled, deliberately: Zip64 (a score is kilobytes, not gigabytes),
// encryption, and multi-disk archives. Each fails loudly rather than quietly
// producing a broken score.
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib'
// The app's own test for "is this the score?", so the two agree on a
// score-timewise file as well as a score-partwise one.
import { isMusicXml } from '../public/js/mxlLoader.js'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const EOCD_MIN_SIZE = 22
const STORED = 0
const DEFLATED = 8
// 1980-01-01 as a DOS date. Zero is not a legal date and some tools say so;
// a constant one keeps the output byte-stable across runs and machines.
const DOS_EPOCH_DATE = 0x0021

function findEndOfCentralDirectory(buffer) {
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record')
}

// Every entry as { name, data }, in the order the central directory lists them.
// Sizes are read from the central directory rather than from the local header,
// because an archive written in one pass leaves them at zero there and puts the
// real ones in a trailing data descriptor.
export function readArchive(buffer) {
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  if (cursor === 0xffffffff || count === 0xffff) throw new Error('Zip64 archives are not supported')

  const entries = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) throw new Error('corrupt ZIP: bad central directory header')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`corrupt ZIP: bad local header for ${name}`)
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    if (method !== STORED && method !== DEFLATED) throw new Error(`unsupported compression in ${name}`)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    entries.push({ name, data: method === DEFLATED ? inflateRawSync(raw) : Buffer.from(raw) })

    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function localHeader(name, data, compressed) {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_SIG, 0)
  header.writeUInt16LE(20, 4) // version needed to extract: 2.0, i.e. deflate
  header.writeUInt16LE(0, 6) // no flags: sizes are here, not in a data descriptor
  header.writeUInt16LE(DEFLATED, 8)
  header.writeUInt16LE(0, 10) // time
  header.writeUInt16LE(DOS_EPOCH_DATE, 12)
  header.writeUInt32LE(crc32(data), 14)
  header.writeUInt32LE(compressed.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(Buffer.byteLength(name), 26)
  header.writeUInt16LE(0, 28) // no extra field
  return header
}

// Bytes 6..30 of a central header repeat the local one field for field, so it
// is handed the header already written rather than the three values it would
// take to compute the same CRC a second time.
function centralHeader(local, offset) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_SIG, 0)
  header.writeUInt16LE(20, 4) // version made by
  local.copy(header, 6, 4, 30)
  header.writeUInt16LE(0, 32) // comment length
  header.writeUInt16LE(0, 34) // disk number
  header.writeUInt16LE(0, 36) // internal attributes
  header.writeUInt32LE(0, 38) // external attributes
  header.writeUInt32LE(offset, 42)
  return header
}

// The archive `entries` describe, every entry deflated. Same input, same bytes.
export function writeArchive(entries) {
  const body = []
  const directory = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(data, { level: 9 })
    const local = localHeader(name, data, compressed)
    body.push(local, nameBuffer, compressed)
    directory.push(centralHeader(local, offset), nameBuffer)
    offset += 30 + nameBuffer.length + compressed.length
  }

  const directoryBytes = Buffer.concat(directory)
  const end = Buffer.alloc(EOCD_MIN_SIZE)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...body, directoryBytes, end])
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

const isZip = (buffer) => buffer.subarray(0, 4).equals(ZIP_MAGIC)

// Which entry of an `.mxl` holds the score: what `META-INF/container.xml`
// points at, or else the first root-level `.xml` that looks like MusicXML.
// Mirrors extractXmlFromMxl() in public/js/mxlLoader.js, which is how the app
// itself decides — a score the browser reads from one entry must not be
// rewritten into another.
export function scoreEntry(entries) {
  const container = entries.find((entry) => entry.name === 'META-INF/container.xml')
  const rootfile = container && /<rootfile[^>]*\bfull-path=["']([^"']*)["']/.exec(container.data.toString('utf8'))?.[1]
  const named = rootfile && entries.find((entry) => entry.name === rootfile)
  if (named) return named

  const fallback = entries.find(
    (entry) =>
      entry.name.endsWith('.xml') &&
      !entry.name.includes('/') &&
      isMusicXml(entry.data.toString('utf8')),
  )
  if (!fallback) throw new Error('no MusicXML entry found in archive')
  return fallback
}

// The MusicXML text of a score file, whether it is a zipped `.mxl` or a plain
// `.xml`/`.musicxml`, plus the `write` that puts an edited text back in the
// same shape. Read and write are one call so the archive's other entries — the
// container, the engraver's own metadata — survive the round trip untouched.
export function openScore(buffer) {
  if (!isZip(buffer)) {
    return { xml: buffer.toString('utf8'), write: (xml) => Buffer.from(xml, 'utf8') }
  }
  const entries = readArchive(buffer)
  const entry = scoreEntry(entries)
  return {
    xml: entry.data.toString('utf8'),
    write: (xml) =>
      writeArchive(
        entries.map((other) => (other === entry ? { name: entry.name, data: Buffer.from(xml, 'utf8') } : other)),
      ),
  }
}
