import { describe, it, expect } from 'vitest'
import { readBuildRoot, samePageIn } from '../../public/js/previews.js'

const SITE = 'https://arabesque.app/'
const url = (path) => new URL(path, SITE)

describe('which build a page belongs to', () => {
  it('is production at the root of the site', () => {
    const { slug, siteRoot } = readBuildRoot(url('/'))
    expect(slug).toBeNull()
    expect(siteRoot.href).toBe(SITE)
  })

  it('is a preview under previews/<slug>/, whose site is the root above it', () => {
    const { slug, siteRoot } = readBuildRoot(url('/previews/claude-funny-golick-fbef83/'))
    expect(slug).toBe('claude-funny-golick-fbef83')
    expect(siteRoot.href).toBe(SITE)
  })

  it('is not a preview for previews/ itself', () => {
    expect(readBuildRoot(url('/previews/')).slug).toBeNull()
  })
})

describe('the same page in another build', () => {
  const preview = url('/previews/a-branch/')
  const production = url('/')

  it('keeps the piece open on the score page, and its query whole', () => {
    const page = url('/previews/a-branch/score.html?url=scores%2FBWV_847.mxl#m12')
    expect(samePageIn(production, page, preview)).toBe(`${SITE}score.html?url=scores%2FBWV_847.mxl#m12`)
  })

  it('goes from production to a preview, and from one preview to another', () => {
    expect(samePageIn(preview, url('/library.html?q=bach'), production)).toBe(`${SITE}previews/a-branch/library.html?q=bach`)
    expect(samePageIn(url('/previews/other/'), url('/previews/a-branch/data.html'), preview)).toBe(
      `${SITE}previews/other/data.html`,
    )
  })
})
