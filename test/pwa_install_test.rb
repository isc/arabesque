require_relative 'test_helper'

# The install offer waits in the ⚙️ menu instead of interrupting from a banner —
# so what needs a browser is that the entry appears exactly when the browser has
# something to offer, and goes when it doesn't. The manifest that makes Chrome
# offer anything in the first place is a static file, checked without a browser
# in test/js/swShell.test.js.
#
# The manifest is served for the whole origin, so an iPhone visitor to
# arabesque.app now gets a real icon and a standalone window from Safari's "add
# to home screen" too, where before they got a screenshot thumbnail. That is
# deliberate and harmless next to the App Store app: both can coexist, and the
# native wrapper's WKWebView ignores the <link> entirely.
class PwaInstallTest < CapybaraTestBase
  # Headless Chromium never fires beforeinstallprompt — it needs the real
  # install heuristics — so the event is synthesised. What is under test is the
  # app's handling of it, not Chrome's decision to send it.
  FAKE_PROMPT = <<~JS.freeze
    const event = new Event('beforeinstallprompt')
    event.prompt = () => { window.__prompted = true; return Promise.resolve() }
    window.dispatchEvent(event)
  JS

  INSTALL_ENTRY = '📲 Installer l’application'.freeze

  def setup
    page.driver.set_cookie('test-env', 'true')
    visit '/library.html'
  end

  def test_the_menu_offers_the_install_only_while_there_is_one_to_offer
    # The menu stays open throughout: @click.outside does not fire from a
    # script, so the entry can be watched appearing and going in place.
    open_menu
    assert_no_selector '.pt-menu-item', text: 'Installer',
                       wait: 1 # Nothing to install until the browser says so.

    page.execute_script(FAKE_PROMPT)
    assert_selector '.pt-menu-item', text: 'Installer'

    click_on INSTALL_ENTRY
    assert page.evaluate_script('window.__prompted === true'), 'the entry did not reach prompt()'
    assert_no_selector '.pt-popover', visible: true

    # The event is single-use, so the entry goes with it rather than sitting
    # there doing nothing.
    open_menu
    assert_no_selector '.pt-menu-item', text: 'Installer', wait: 1
  end
end
