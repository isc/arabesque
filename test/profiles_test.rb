require_relative 'test_helper'
require 'json'

# Several people on one device (public/js/profiles.js): each profile has a
# practice history of its own, chosen from the library, managed from the data
# page.
class ProfilesTest < CapybaraTestBase
  FIXTURE = File.expand_path('fixtures/initial-backup.json', __dir__)

  def setup
    page.driver.set_cookie('test-env', 'true')
  end

  def test_each_profile_keeps_a_practice_history_of_its_own
    visit '/data.html'
    accept_alert { attach_file 'backup-import', FIXTURE, make_visible: true }

    # Alone on the device, nobody is asked who they are.
    visit '/library.html'
    assert_text 'Bibliothèque'
    assert_no_selector '.pt-profile-chip'

    visit '/data.html'
    fill_in 'Prénom', with: 'Charlie'
    click_button 'Ajouter un profil'
    assert_field 'Nom', with: 'Charlie'

    # The chooser: a tile per profile, the one picked becomes current.
    visit '/library.html'
    find('.pt-profile-chip', text: 'Moi').click
    within('dialog[open]') { click_button 'Charlie' }
    assert_selector '.pt-profile-chip', text: 'Charlie'

    # Charlie starts from nothing, and the account is not Charlie's to sign into.
    visit '/data.html'
    assert_text 'La synchronisation entre appareils suit le premier profil, Moi.'
    assert_no_button 'Recevoir un lien de connexion'
    accept_alert { click_button '📤 Exporter sauvegarde' }
    exported = wait_for_download('arabesque-backup-charlie-*.json')
    assert_empty JSON.parse(File.read(exported))['sessions']
    File.delete(exported)

    # Back on the first profile, the history is where it was.
    click_button 'Activer'
    assert_button 'Recevoir un lien de connexion', disabled: :all
    accept_alert { click_button '📤 Exporter sauvegarde' }
    exported = wait_for_download('arabesque-backup-2*.json')
    assert_equal JSON.parse(File.read(FIXTURE))['sessions'].length,
                 JSON.parse(File.read(exported))['sessions'].length
    File.delete(exported)

    # Deleting Charlie, with a warning first.
    click_button 'Supprimer'
    assert_text 'Tout ce que Charlie a joué sur cet appareil sera effacé'
    click_button 'Oui, supprimer Charlie'
    assert_no_field 'Nom', with: 'Charlie'

    visit '/library.html'
    assert_text 'Bibliothèque'
    assert_no_selector '.pt-profile-chip'
  end
end
