// Shared Playwright helpers for capturing the Arabesque app states that
// feed the landing hero video. See ../README.md for the full workflow.
import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const ASSETS = path.resolve(ROOT, '../composition/assets')
export const WORKDIR = path.resolve(ROOT, '.work') // userdata + recorded clips (gitignored)

export const BASE = process.env.PT_BASE || 'http://localhost:4567'
export const VIEWPORT = { width: 1280, height: 800 }

// Playwright's bundled Chromium is used by default. Set PT_CHROMIUM to point at
// a specific binary (e.g. an already-downloaded ms-playwright cache) if
// `npx playwright install chromium` is unavailable on your network.
const EXECUTABLE_PATH = process.env.PT_CHROMIUM || undefined

export async function launch({ record = false } = {}) {
  const ctx = await chromium.launchPersistentContext(path.join(WORKDIR, 'userdata'), {
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    executablePath: EXECUTABLE_PATH,
    ...(record ? { recordVideo: { dir: path.join(WORKDIR, 'clip'), size: VIEWPORT } } : {}),
  })
  // Activate the in-app mock MIDI keyboard (isTestEnv() === test-env cookie).
  await ctx.addCookies([{ name: 'test-env', value: '1', url: BASE }])
  // Capture the UI in a specific language (PT_LANG=fr|en) by seeding the same
  // localStorage key the app reads. Runs before any app script on every page.
  const captureLang = process.env.PT_LANG
  if (captureLang) {
    await ctx.addInitScript((lang) => {
      try {
        localStorage.setItem('pt-lang', lang)
      } catch {
        /* ignore */
      }
    }, captureLang)
  }
  // Expose one mock-MIDI helper to page context so the feedback and training
  // captures share the same dispatch/timing instead of duplicating it.
  await ctx.addInitScript(() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const send = (status, midi, vel) =>
      window.dispatchEvent(new CustomEvent('mock-midi-input', { detail: { data: [status, midi, vel] } }))
    window.__ptMidi = {
      sleep,
      // Play a list of MIDI note numbers in sequence (note-on then note-off).
      async play(pitches) {
        for (const m of pitches) {
          send(0x90, m, 92)
          await sleep(60)
          send(0x80, m, 0)
          await sleep(45)
        }
      },
    }
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}

// Open a score page (note: load WITHOUT a leading slash so scoreUrl matches the
// session scoreIds stored as "scores/..." — that's how the library links them).
export async function openScore(page, fileNoSlash) {
  await page.goto(`${BASE}/score.html?url=${fileNoSlash}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!document.querySelector('#score svg'), { timeout: 20000 })
  await page.waitForTimeout(800)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
