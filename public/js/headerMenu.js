// Shared header chrome — the ⚙️ menu and its modals, identical on every page.
//
// Both the library (libraryApp) and the score page (midiApp) get the exact same
// menu (load a score, what's new, feedback, a link to the data page, language)
// and the same changelog + feedback modals. To keep a single source of truth
// without a build step or HTML-include mechanism, the markup lives here as
// strings and is injected by mountHeaderMenu() before Alpine boots; the Alpine
// state + methods come from the headerMenu() mixin both components spread in.
//
// NOTE: markup-as-strings is a deliberate departure from this project's
// markup-in-HTML convention, forced by the no-build-step constraint. If a
// bundler is ever added, this should become a proper partial/component.
//
// Page-specific seam (kept out of here): feedbackContext() — extra,
// non-identifying context merged into a report (practice stats on the library,
// current score on the score page).
import { CHANGELOG } from './changelog.js'
import { feedbackEnabled, buildBaseContext, submitFeedback } from './feedback.js'
import { getLang, locale } from './i18n.js'
import { INSTALL_AVAILABLE_EVENT, installAvailable, promptInstall } from './installPrompt.js'

const CHANGELOG_SEEN_KEY = 'arabesque:changelog-seen'
const CHANGELOG_DATE_FORMATTER = new Intl.DateTimeFormat(locale(), {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function headerMenu() {
  const latest = CHANGELOG[0]?.date
  let seen
  try {
    seen = localStorage.getItem(CHANGELOG_SEEN_KEY)
  } catch {
    seen = null
  }

  return {
    menuOpen: false,
    toggleMenu() {
      this.menuOpen = !this.menuOpen
    },
    closeMenu() {
      this.menuOpen = false
    },

    // --- Install (Android / desktop Chrome) ---
    // Read once here for the value the menu is built with; the binding on the
    // anchor below keeps it current. See installPrompt.js for the timing.
    canInstall: installAvailable(),
    install() {
      this.closeMenu()
      promptInstall()
    },

    // --- Changelog ("Nouveautés") ---
    changelog: CHANGELOG,
    showChangelogModal: false,
    hasUnseenChangelog: !!latest && seen !== latest,

    openChangelog() {
      this.menuOpen = false
      this.showChangelogModal = true
      // Opening the changelog clears the "unseen" flag until the next entry.
      if (latest) {
        try {
          localStorage.setItem(CHANGELOG_SEEN_KEY, latest)
        } catch {
          /* localStorage unavailable: the dot just stays until next visit */
        }
      }
      this.hasUnseenChangelog = false
    },

    formatChangelogDate(iso) {
      const [y, m, d] = iso.split('-').map(Number)
      return CHANGELOG_DATE_FORMATTER.format(new Date(y, m - 1, d))
    },

    // Entries carry their items per language ({ fr: [...], en: [...] }),
    // falling back to English when a translation is missing.
    changelogItems(entry) {
      return entry.items?.[getLang()] ?? entry.items?.en ?? []
    },

    // --- Feedback ---
    feedbackEnabled,
    showFeedbackModal: false,
    feedback: { message: '', email: '', category: '' },
    feedbackStatus: 'idle', // 'idle' | 'sending' | 'sent' | 'error'
    feedbackError: '',

    openFeedback() {
      this.feedback = { message: '', email: '', category: '' }
      this.feedbackStatus = 'idle'
      this.feedbackError = ''
      this.menuOpen = false
      this.showFeedbackModal = true
    },

    async sendFeedback() {
      const message = this.feedback.message.trim()
      if (!message || this.feedbackStatus === 'sending') return
      this.feedbackStatus = 'sending'
      this.feedbackError = ''
      try {
        await submitFeedback({
          message,
          email: this.feedback.email,
          category: this.feedback.category,
          context: { ...buildBaseContext(), ...(this.feedbackContext?.() ?? {}) },
        })
        this.feedbackStatus = 'sent'
      } catch (err) {
        console.error('Feedback error:', err)
        this.feedbackStatus = 'error'
        this.feedbackError = err.message || String(err)
      }
    },
  }
}

// The ⚙️ trigger + popover. Replaces a [data-menu-slot] placeholder so it lands
// exactly where each page wants it in the header.
const TRIGGER_HTML = `
<div class="pt-popover-anchor"
     @${INSTALL_AVAILABLE_EVENT}.window="canInstall = $event.detail"
     @click.outside="closeMenu()">
  <button type="button" class="pt-icon-button pt-changelog-btn" :aria-pressed="menuOpen" :aria-label="$t('menu.open')" @click="toggleMenu()">
    ⚙️
    <span class="pt-changelog-dot" x-show="hasUnseenChangelog" aria-hidden="true"></span>
  </button>
  <div class="pt-popover" x-show="menuOpen" x-cloak>
    <div class="pt-popover__section">
      <a href="score.html" class="pt-menu-item" @click="closeMenu()" x-text="$t('library.loadScore')">📄 Charger une partition</a>
      <button type="button" class="pt-menu-item" x-show="canInstall" @click="install()" x-text="$t('menu.install')">📲 Installer l'application</button>
      <button type="button" class="pt-menu-item" @click="openChangelog()">
        <span x-text="$t('library.changelog')">✨ Nouveautés</span>
        <span class="pt-menu-dot" x-show="hasUnseenChangelog" aria-hidden="true"></span>
      </button>
      <button type="button" class="pt-menu-item" x-show="feedbackEnabled" @click="openFeedback()" x-text="$t('library.feedback')">💬 Avis</button>
      <a href="practice.html" class="pt-menu-item" @click="closeMenu()" x-text="$t('menu.practice')">📅 Assiduité</a>
      <a href="data.html" class="pt-menu-item" @click="closeMenu()" x-text="$t('menu.data')">🗂 Données</a>
      <a href="support.html" class="pt-menu-item" @click="closeMenu()" x-text="$t('menu.support')">🛟 Assistance</a>
      <a href="privacy.html" class="pt-menu-item" @click="closeMenu()" x-text="$t('menu.privacy')">🔒 Confidentialité</a>
    </div>
    <hr />
    <div class="pt-popover__section">
      <h4 x-text="$t('menu.language')">Langue</h4>
      <div class="pt-langswitch" role="group" aria-label="Language">
        <button type="button" data-set-lang="fr">FR</button>
        <button type="button" data-set-lang="en">EN</button>
      </div>
    </div>
  </div>
</div>`

// The changelog + feedback dialogs, appended to <body> (inside the page's
// <html x-data> root, so the bindings resolve against the component).
const MODALS_HTML = `
<dialog class="pt-changelog-dialog" :open="showChangelogModal">
  <article>
    <header>
      <p><strong x-text="$t('library.changelog')">✨ Nouveautés</strong></p>
      <button :aria-label="$t('common.close')" rel="prev" @click="showChangelogModal = false"></button>
    </header>
    <div class="pt-modal-body">
      <template x-for="entry in changelog" :key="entry.date">
        <section class="pt-changelog-entry">
          <h4 x-text="formatChangelogDate(entry.date)"></h4>
          <ul>
            <template x-for="(item, i) in changelogItems(entry)" :key="i">
              <li x-text="item"></li>
            </template>
          </ul>
        </section>
      </template>
    </div>
  </article>
</dialog>
<dialog :open="showFeedbackModal">
  <article>
    <header>
      <p><strong x-text="$t('feedback.title')">💬 Votre avis</strong></p>
      <button :aria-label="$t('common.close')" rel="prev" @click="showFeedbackModal = false"></button>
    </header>
    <div class="pt-modal-body">
    <template x-if="feedbackStatus === 'sent'">
      <div>
        <p x-text="$t('feedback.thanks')">Merci, c'est bien reçu !</p>
        <footer>
          <button type="button" @click="showFeedbackModal = false" x-text="$t('common.close')">Fermer</button>
        </footer>
      </div>
    </template>
    <template x-if="feedbackStatus !== 'sent'">
      <form @submit.prevent="sendFeedback()">
        <p class="pt-feedback-intro" x-text="$t('feedback.intro')"></p>
        <label>
          <span x-text="$t('feedback.categoryLabel')">Type</span>
          <select x-model="feedback.category" :disabled="feedbackStatus === 'sending'">
            <option value="" x-text="$t('feedback.categoryNone')">—</option>
            <option value="bug" x-text="$t('feedback.categoryBug')">Bug</option>
            <option value="idea" x-text="$t('feedback.categoryIdea')">Idée</option>
            <option value="score" x-text="$t('feedback.categoryScore')">Partition</option>
            <option value="other" x-text="$t('feedback.categoryOther')">Autre</option>
          </select>
        </label>
        <label>
          <span x-text="$t('feedback.messageLabel')">Message</span>
          <textarea x-model="feedback.message" rows="6" maxlength="5000" required :disabled="feedbackStatus === 'sending'" :placeholder="$t('feedback.messagePlaceholder')"></textarea>
        </label>
        <label>
          <span x-text="$t('feedback.emailLabel')">E-mail (facultatif)</span>
          <input type="email" x-model="feedback.email" maxlength="320" :disabled="feedbackStatus === 'sending'" :placeholder="$t('feedback.emailPlaceholder')" />
          <small x-text="$t('feedback.emailHint')"></small>
        </label>
        <small class="pt-feedback-privacy" x-text="$t('feedback.privacy')"></small>
        <p x-show="feedbackStatus === 'error'" role="alert" class="pt-feedback-error">
          <span x-text="$t('feedback.error')">L'envoi a échoué.</span>
          <span x-text="feedbackError"></span>
        </p>
        <footer>
          <button type="submit" :aria-busy="feedbackStatus === 'sending'" :disabled="!feedback.message.trim() || feedbackStatus === 'sending'" x-text="$t('feedback.send')">Envoyer</button>
        </footer>
      </form>
    </template>
    </div>
  </article>
</dialog>`

// Inject the shared chrome. Must run BEFORE Alpine boots (so it processes the
// x-* bindings) and before initAlpineI18n() (so the FR/EN buttons get wired).
export function mountHeaderMenu() {
  const slot = document.querySelector('[data-menu-slot]')
  if (slot) slot.outerHTML = TRIGGER_HTML
  document.body.insertAdjacentHTML('beforeend', MODALS_HTML)
}
