import { describe, it, expect, vi } from 'vitest'

// The ⚙️ menu both pages spread into their component, a fresh object a call.
// installPrompt.js, which it imports, listens on window as it loads.
vi.stubGlobal('window', new EventTarget())
const { headerMenu } = await import('../../public/js/headerMenu.js')

describe('Escape on the ⚙️ menu', () => {
  // The library used to close everything at once and the score page a layer at
  // a time; both go through this now.
  it('closes the menu first, then a modal it opened, and says when there was nothing', () => {
    const menu = headerMenu()
    menu.showChangelogModal = true
    menu.menuOpen = true

    expect(menu.closeMenuLayer()).toBe(true)
    expect([menu.menuOpen, menu.showChangelogModal]).toEqual([false, true])
    expect(menu.closeMenuLayer()).toBe(true)
    expect(menu.showChangelogModal).toBe(false)
    expect(menu.closeMenuLayer()).toBe(false)
  })

  it('takes the feedback picture away with the form', () => {
    const menu = headerMenu()
    menu.showFeedbackModal = true
    menu.feedbackShot = 'data:image/webp;base64,xx'

    expect(menu.closeMenuLayer()).toBe(true)
    expect([menu.showFeedbackModal, menu.feedbackShot]).toEqual([false, null])
  })
})
