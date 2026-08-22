// ZIP file magic bytes (PK..)
const ZIP_MAGIC_BYTES = [0x50, 0x4b, 0x03, 0x04]

function isZipFile(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer, 0, 4)
  return ZIP_MAGIC_BYTES.every((byte, i) => bytes[i] === byte)
}

export function isMusicXml(content) {
  return content.includes('score-partwise') || content.includes('score-timewise')
}

async function extractXmlFromMxl(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // Read META-INF/container.xml to find the main XML file
  const containerFile = zip.file('META-INF/container.xml')
  if (containerFile) {
    const containerXml = await containerFile.async('text')
    const containerDoc = new DOMParser().parseFromString(containerXml, 'text/xml')
    const fullPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
    const mainFile = fullPath && zip.file(fullPath)
    if (mainFile) {
      return mainFile.async('text')
    }
  }

  // Fallback: look for any root-level .xml file that looks like MusicXML
  for (const [filename, file] of Object.entries(zip.files)) {
    if (filename.endsWith('.xml') && !filename.includes('/')) {
      const content = await file.async('text')
      if (isMusicXml(content)) {
        return content
      }
    }
  }

  throw new Error('No valid MusicXML file found in archive')
}

// Turn raw bytes into MusicXML text, transparently unzipping compressed .mxl
// archives (which start with the ZIP magic bytes) and decoding plain .xml
// otherwise. Shared by URL loading and local file/drop imports.
export async function arrayBufferToXml(arrayBuffer) {
  if (isZipFile(arrayBuffer)) {
    return extractXmlFromMxl(arrayBuffer)
  }

  // Not a ZIP, treat as plain XML text
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(arrayBuffer)
}

export async function loadMxlAsXml(url) {
  return arrayBufferToXml(await fetchScoreBytes(url))
}

// score.html starts the download from its <head>, before OSMD and the module
// graph are even fetched; by the time this runs the bytes are usually already
// there. Consumed once, then dropped so a score's worth of ArrayBuffer isn't
// pinned for the session. A prefetch that failed resolves to null and is simply
// retried here, so a transient error doesn't outlive the request that caused it.
async function fetchScoreBytes(url) {
  const prefetch = window.__scorePrefetch
  if (prefetch?.url === url) {
    window.__scorePrefetch = null
    const bytes = await prefetch.promise
    if (bytes) return bytes
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  return response.arrayBuffer()
}
